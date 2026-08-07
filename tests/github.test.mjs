import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { commitFiles, getFileContent, verifyAccess } from '../src/core/github.ts';

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

/**
 * A fake repository that behaves the way GitHub actually did.
 *
 * The important part is `contentsCacheLag`: reads through the Contents API are
 * served from a snapshot taken before the most recent writes, which is what
 * handed the old code a stale blob sha and made every retry fail identically.
 */
function fakeRepo({ contentsCacheLag = false } = {}) {
  const state = {
    head: 'commit-0',
    tree: 'tree-0',
    trees: new Map([['tree-0', new Map()]]),
    commits: new Map([['commit-0', { tree: 'tree-0' }]]),
    /** What the Contents API is willing to admit exists. */
    visible: new Map(),
    counter: 0,
    calls: [],
  };

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const handler = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = new URL(url).pathname;
    state.calls.push(`${method} ${path}`);
    const body = init.body ? JSON.parse(init.body) : undefined;

    if (method === 'GET' && path.includes('/git/ref/heads/')) {
      return json({ object: { sha: state.head } });
    }
    if (method === 'GET' && path.includes('/git/commits/')) {
      const sha = path.split('/').pop();
      return json({ tree: { sha: state.commits.get(sha).tree } });
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      const base = new Map(state.trees.get(body.base_tree ?? state.tree));
      for (const entry of body.tree) base.set(entry.path, entry.content);
      // Git trees are content-addressed: identical contents hash to the same
      // sha. The skip-empty-commit check depends on that, so the fake has to
      // reproduce it rather than mint a fresh id each time.
      const sha = `tree-${createHash('sha1')
        .update(JSON.stringify([...base.entries()].sort()))
        .digest('hex')
        .slice(0, 12)}`;
      state.trees.set(sha, base);
      return json({ sha });
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      const sha = `commit-${++state.counter}`;
      state.commits.set(sha, { tree: body.tree });
      return json({ sha, html_url: `https://github.com/o/r/commit/${sha}` });
    }
    if (method === 'PATCH' && path.includes('/git/refs/heads/')) {
      state.head = body.sha;
      state.tree = state.commits.get(body.sha).tree;
      // The Contents API only catches up later, if at all.
      if (!contentsCacheLag) state.visible = new Map(state.trees.get(state.tree));
      return json({ object: { sha: body.sha } });
    }
    if (method === 'GET' && path.includes('/contents/')) {
      const file = decodeURIComponent(path.split('/contents/')[1]);
      if (!state.visible.has(file)) return json({ message: 'Not Found' }, 404);
      return json({
        content: Buffer.from(state.visible.get(file), 'utf8').toString('base64'),
        encoding: 'base64',
        sha: 'stale-sha',
      });
    }
    return json({ message: `unhandled ${method} ${path}` }, 500);
  };

  return { state, handler };
}

test('all of a solve’s files land in one commit', async () => {
  const repo = fakeRepo();
  const restore = stubFetch(repo.handler);

  try {
    const result = await commitFiles(
      CONFIG,
      [
        { path: 'leetcode/easy/0001-two-sum/solution.java', content: 'class Solution {}' },
        { path: 'leetcode/easy/0001-two-sum/README.md', content: '# Two Sum' },
        { path: 'README.md', content: '# DSA Solutions' },
        { path: 'PROFILE.md', content: '# Coding profile' },
        { path: 'assets/profile.svg', content: '<svg/>' },
      ],
      'solve: Two Sum',
    );

    assert.match(result.commitUrl, /\/commit\//);

    const commits = repo.state.calls.filter((call) => call === 'POST /repos/octocat/solutions/git/commits');
    assert.equal(commits.length, 1, 'five files, one commit');

    const tree = repo.state.trees.get(repo.state.tree);
    assert.equal(tree.size, 5);
    assert.equal(tree.get('README.md'), '# DSA Solutions');
  } finally {
    restore();
  }
});

test('a lagging Contents cache no longer breaks the write', async () => {
  // This is the exact condition that produced "the branch kept moving while
  // committing README.md; gave up after 4 tries".
  const repo = fakeRepo({ contentsCacheLag: true });
  const restore = stubFetch(repo.handler);

  try {
    for (let i = 0; i < 3; i += 1) {
      await commitFiles(
        CONFIG,
        [
          { path: `problem-${i}/solution.java`, content: `class S${i} {}` },
          { path: 'README.md', content: `index after ${i}` },
        ],
        `solve: problem ${i}`,
      );
    }

    // No blob sha is ever read, so there is nothing for the cache to be stale
    // about.
    assert.ok(
      !repo.state.calls.some((call) => call.startsWith('GET') && call.includes('/contents/')),
      'the commit path must not depend on the Contents API',
    );
    assert.equal(repo.state.trees.get(repo.state.tree).get('README.md'), 'index after 2');
  } finally {
    restore();
  }
});

test('re-committing identical content adds no empty commit', async () => {
  const repo = fakeRepo();
  const restore = stubFetch(repo.handler);

  try {
    const files = [{ path: 'README.md', content: 'same' }];
    await commitFiles(CONFIG, files, 'first');
    const afterFirst = repo.state.head;

    await commitFiles(CONFIG, files, 'second');
    assert.equal(repo.state.head, afterFirst, 'an unchanged tree must not produce a commit');
  } finally {
    restore();
  }
});

test('a repository with no commits yet gets its first one', async () => {
  const restore = stubFetch(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = new URL(url).pathname;
    // No ref: the branch does not exist.
    if (path.includes('/git/ref/heads/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      assert.equal(init.body.includes('base_tree'), false, 'nothing to build on');
      return new Response(JSON.stringify({ sha: 'tree-1' }));
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      assert.deepEqual(JSON.parse(init.body).parents, [], 'the first commit has no parent');
      return new Response(JSON.stringify({ sha: 'commit-1', html_url: 'https://x/commit/1' }));
    }
    if (method === 'POST' && path.endsWith('/git/refs')) {
      assert.equal(JSON.parse(init.body).ref, 'refs/heads/main');
      return new Response(JSON.stringify({ object: { sha: 'commit-1' } }));
    }
    return new Response(JSON.stringify({ message: `unhandled ${method} ${path}` }), { status: 500 });
  });

  try {
    const result = await commitFiles(CONFIG, [{ path: 'README.md', content: 'hi' }], 'first');
    assert.equal(result.commitUrl, 'https://x/commit/1');
  } finally {
    restore();
  }
});

test('a branch that really did move is retried on the new head', async () => {
  const repo = fakeRepo();
  let refused = 0;
  const restore = stubFetch(async (url, init = {}) => {
    const path = new URL(url).pathname;
    // Someone else pushed between our read and our update — twice.
    if ((init.method ?? 'GET') === 'PATCH' && path.includes('/git/refs/heads/') && refused < 2) {
      refused += 1;
      return new Response(JSON.stringify({ message: 'Update is not a fast forward' }), {
        status: 422,
      });
    }
    return repo.handler(url, init);
  });

  try {
    const result = await commitFiles(CONFIG, [{ path: 'README.md', content: 'x' }], 'solve');
    assert.equal(refused, 2);
    assert.match(result.commitUrl, /\/commit\//);
  } finally {
    restore();
  }
});
