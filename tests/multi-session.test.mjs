import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diagnoseSession,
  pickSession,
  readStoredSession,
  readStoredSessions,
} from '../src/core/parikshaa.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

const OLD_REF = 'lvnpvfxlmzbnylwkvgnq';
const LIVE_REF = 'elzftqnehcmnouptaqee';

function makeJwt(ref, { exp = Math.floor(NOW / 1000) + 3600, sub = 'user-1' } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({
    iss: `https://${ref}.supabase.co/auth/v1`,
    sub,
    exp,
  })}.sig`;
}

function session(ref, overrides = {}) {
  return JSON.stringify({
    access_token: makeJwt(ref, overrides),
    expires_at: overrides.exp ?? Math.floor(NOW / 1000) + 3600,
    user: { id: 'user-1', email: 'someone@example.com' },
    ...overrides.extra,
  });
}

function makeStorage(entries) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (index) => keys[index] ?? null,
    getItem: (key) => entries[key] ?? null,
  };
}

/**
 * The real report from a browser holding two Supabase projects' sessions.
 * Joining them yields `{…}{…}`, which used to read as one corrupt session.
 */
const TWO_PROJECTS = makeStorage({
  [`sb-${OLD_REF}-auth-token`]: session(OLD_REF),
  [`sb-${LIVE_REF}-auth-token`]: session(LIVE_REF),
});

test('two projects are read as two sessions, not one broken one', () => {
  const candidates = readStoredSessions(TWO_PROJECTS);

  assert.equal(candidates.length, 2);
  assert.equal(candidates.every((candidate) => candidate.session?.access_token), true);
  assert.deepEqual(candidates.map((candidate) => candidate.origin).sort(), [
    `https://${LIVE_REF}.supabase.co`,
    `https://${OLD_REF}.supabase.co`,
  ]);
});

test('the session matching the origin the page uses is chosen', () => {
  const chosen = pickSession(readStoredSessions(TWO_PROJECTS), `https://${LIVE_REF}.supabase.co`);
  assert.equal(chosen.origin, `https://${LIVE_REF}.supabase.co`);

  // The same storage, a different live project — the other session wins.
  const other = pickSession(readStoredSessions(TWO_PROJECTS), `https://${OLD_REF}.supabase.co`);
  assert.equal(other.origin, `https://${OLD_REF}.supabase.co`);
});

test('without a hint the longest-lived session is used', () => {
  const storage = makeStorage({
    [`sb-${OLD_REF}-auth-token`]: session(OLD_REF, { exp: Math.floor(NOW / 1000) + 60 }),
    [`sb-${LIVE_REF}-auth-token`]: session(LIVE_REF, { exp: Math.floor(NOW / 1000) + 7200 }),
  });
  assert.equal(pickSession(readStoredSessions(storage)).origin, `https://${LIVE_REF}.supabase.co`);
});

test('a stale project session is skipped when it holds no token', () => {
  const storage = makeStorage({
    [`sb-${OLD_REF}-auth-token`]: JSON.stringify({ user: null }),
    [`sb-${LIVE_REF}-auth-token`]: session(LIVE_REF),
  });
  const chosen = pickSession(readStoredSessions(storage), `https://${OLD_REF}.supabase.co`);
  // The preferred project has nothing usable, so the usable one is returned
  // rather than nothing at all.
  assert.equal(chosen.origin, `https://${LIVE_REF}.supabase.co`);
});

test('chunked keys still group with their own session, not across projects', () => {
  const live = session(LIVE_REF);
  const storage = makeStorage({
    [`sb-${OLD_REF}-auth-token`]: session(OLD_REF),
    [`sb-${LIVE_REF}-auth-token.0`]: live.slice(0, 40),
    [`sb-${LIVE_REF}-auth-token.1`]: live.slice(40),
  });

  const candidates = readStoredSessions(storage);
  assert.equal(candidates.length, 2);
  const chosen = pickSession(candidates, `https://${LIVE_REF}.supabase.co`);
  assert.equal(chosen.keys.length, 2);
  assert.equal(chosen.session.access_token, JSON.parse(live).access_token);
});

test('readStoredSession keeps working for the single-project case', () => {
  const storage = makeStorage({ [`sb-${LIVE_REF}-auth-token`]: session(LIVE_REF) });
  assert.equal(readStoredSession(storage).user.id, 'user-1');
});

test('the diagnostic reports both projects and which one the page uses', () => {
  const result = diagnoseSession(TWO_PROJECTS, `https://${LIVE_REF}.supabase.co`);

  assert.equal(result.candidateCount, 2);
  assert.equal(result.candidateOrigins.length, 2);
  assert.equal(result.preferredOrigin, `https://${LIVE_REF}.supabase.co`);
  assert.equal(result.parsed, true);
  assert.equal(result.hasAccessToken, true);
  assert.equal(result.issuer, `https://${LIVE_REF}.supabase.co`);
});

test('a page whose project has no stored session is diagnosable', () => {
  const result = diagnoseSession(
    makeStorage({ [`sb-${OLD_REF}-auth-token`]: session(OLD_REF) }),
    `https://${LIVE_REF}.supabase.co`,
  );
  assert.deepEqual(result.candidateOrigins, [`https://${OLD_REF}.supabase.co`]);
  assert.equal(result.preferredOrigin, `https://${LIVE_REF}.supabase.co`);
});
