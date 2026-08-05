import assert from 'node:assert/strict';
import test from 'node:test';

import { getFileContent, verifyAccess } from '../src/core/github.ts';

const CONFIG = {
  enabled: true,
  token: 'github_pat_test',
  owner: 'octocat',
  repo: 'solutions',
  branch: 'main',
  commitMessage: 'solve: {title}',
};

/** Replaces global fetch for one test, restoring it afterwards. */
function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => handler(String(url), init ?? {});
  return () => {
    globalThis.fetch = original;
  };
}

function failure(status, body, headers = {}) {
  return new Response(body, { status, headers });
}

test('a 403 quotes GitHub back rather than guessing the cause', async () => {
  const restore = stubFetch(async () =>
    failure(403, JSON.stringify({ message: 'Resource not accessible by personal access token' })),
  );

  try {
    await assert.rejects(
      () => getFileContent(CONFIG, 'README.md'),
      (error) => {
        assert.match(error.message, /Contents: read and write/);
        assert.match(error.message, /Resource not accessible by personal access token/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('a spent rate limit is not reported as a missing permission', async () => {
  // Both come back as 403; only the headers tell them apart, and the fixes are
  // completely different — wait, versus go and edit the token.
  const reset = Math.floor(Date.now() / 1000) + 600;
  const restore = stubFetch(async () =>
    failure(403, JSON.stringify({ message: 'API rate limit exceeded' }), {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(reset),
    }),
  );

  try {
    await assert.rejects(
      () => getFileContent(CONFIG, 'README.md'),
      (error) => {
        assert.match(error.message, /rate limit/i);
        assert.doesNotMatch(error.message, /Contents: read and write/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('SSO-gated organisations get the authorisation instruction', async () => {
  const restore = stubFetch(async () =>
    failure(
      403,
      JSON.stringify({
        message: 'Resource protected by organization SAML enforcement. You must grant access.',
      }),
    ),
  );

  try {
    await assert.rejects(
      () => getFileContent(CONFIG, 'README.md'),
      (error) => {
        assert.match(error.message, /authorise it for the organisation/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('a 404 on a path is absence, not an error', async () => {
  const restore = stubFetch(async () => failure(404, JSON.stringify({ message: 'Not Found' })));

  try {
    assert.equal(await getFileContent(CONFIG, 'missing.md'), undefined);
  } finally {
    restore();
  }
});

test('verifyAccess reports a branch that does not exist', async () => {
  const restore = stubFetch(async (url) => {
    if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'octocat' }));
    if (url.endsWith('/repos/octocat/solutions')) {
      return new Response(
        JSON.stringify({
          full_name: 'octocat/solutions',
          default_branch: 'master',
          permissions: { push: true },
        }),
      );
    }
    // The configured branch is "main"; this repository only has "master".
    return failure(404, JSON.stringify({ message: 'Branch not found' }));
  });

  try {
    const info = await verifyAccess(CONFIG);
    assert.equal(info.canPush, true);
    assert.equal(info.branchExists, false);
    assert.equal(info.defaultBranch, 'master');
  } finally {
    restore();
  }
});

test('verifyAccess passes when the branch is there', async () => {
  const restore = stubFetch(async (url) => {
    if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'octocat' }));
    if (url.endsWith('/repos/octocat/solutions')) {
      return new Response(
        JSON.stringify({
          full_name: 'octocat/solutions',
          default_branch: 'main',
          permissions: { push: true },
        }),
      );
    }
    return new Response(JSON.stringify({ name: 'main' }));
  });

  try {
    const info = await verifyAccess(CONFIG);
    assert.equal(info.branchExists, true);
  } finally {
    restore();
  }
});
