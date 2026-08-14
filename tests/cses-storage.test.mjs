import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimCsesFinalResult,
  getFreshPendingCsesSubmission,
  savePendingCsesSubmission,
} from '../src/core/storage.ts';

/**
 * A filesystem-backed implementation of the narrow Chrome storage API this
 * test exercises. Unlike the adapter tests' in-memory message mocks, it keeps
 * the real storage module's values across a fresh module load.
 */
async function installFileBackedChromeStorage() {
  const directory = await mkdtemp(join(tmpdir(), 'redo-cses-storage-'));
  const filename = join(directory, 'storage.json');
  await writeFile(filename, '{}');
  const previousChrome = globalThis.chrome;

  async function readValues() {
    return JSON.parse(await readFile(filename, 'utf8'));
  }

  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          const values = await readValues();
          return { [key]: values[key] };
        },
        async set(patch) {
          const values = await readValues();
          await writeFile(filename, JSON.stringify({ ...values, ...structuredClone(patch) }));
        },
        async remove(key) {
          const values = await readValues();
          delete values[key];
          await writeFile(filename, JSON.stringify(values));
        },
      },
    },
  };

  return {
    readValues,
    async dispose() {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('CSES worker storage persists claims, serializes duplicates, prunes stale source, and keeps another task', async () => {
  const storage = await installFileBackedChromeStorage();
  const now = Date.UTC(2026, 7, 14, 12, 0, 0);
  const first = {
    taskId: '1068', submittedAt: now, filename: 'first.cpp', language: 'C++', code: 'first source',
  };
  const second = {
    taskId: '1193', submittedAt: now, filename: 'second.py', language: 'Python', code: 'second source',
  };
  const stale = {
    taskId: 'stale', submittedAt: now - 15 * 60_000 - 1, filename: 'old.cpp', language: 'C++', code: 'old source',
  };

  try {
    await savePendingCsesSubmission(first, now);
    await savePendingCsesSubmission(second, now);
    await savePendingCsesSubmission(stale, now);

    const rejected = await claimCsesFinalResult({
      taskId: '1068', resultPath: '/problemset/result/rejected-fixture/', verdict: 'Wrong Answer', accepted: false,
    }, now);
    const acceptedResult = {
      taskId: '1068', resultPath: '/problemset/result/accepted-fixture/', verdict: 'Accepted', accepted: true,
    };
    const claims = await Promise.all([
      claimCsesFinalResult(acceptedResult, now),
      claimCsesFinalResult(acceptedResult, now),
    ]);
    const accepted = claims.find((claim) => claim.recorded);
    const duplicate = claims.find((claim) => !claim.recorded);

    assert.deepEqual(rejected, { recorded: true });
    assert.deepEqual(accepted, { recorded: true, attempts: 2, pending: first });
    assert.deepEqual(duplicate, { recorded: false });
    assert.deepEqual(await getFreshPendingCsesSubmission('1193', now), second);
    assert.equal(await getFreshPendingCsesSubmission('stale', now), undefined);

    const persisted = await storage.readValues();
    assert.deepEqual(persisted.pendingCsesSubmissions, { 1193: second });
    assert.deepEqual(persisted.csesFinalResultState.failedAttempts, {});
    assert.equal(Object.keys(persisted.csesFinalResultState.seenResultFingerprints).length, 2);
    assert.ok(Object.keys(persisted.csesFinalResultState.seenResultFingerprints).every((key) => /^[a-f0-9]{64}$/.test(key)));
    assert.doesNotMatch(JSON.stringify(persisted.csesFinalResultState), /accepted-fixture|first source/);

    const reloadedStorage = await import(`../src/core/storage.ts?cses-final-state-${Date.now()}`);
    assert.deepEqual(await reloadedStorage.claimCsesFinalResult(acceptedResult, now), { recorded: false });
  } finally {
    await storage.dispose();
  }
});
