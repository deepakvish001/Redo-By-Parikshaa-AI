import test from 'node:test';
import assert from 'node:assert/strict';
import {
  credentialsFromSession,
  decodeJwtPayload,
  isExpired,
  parikshaaLanguage,
  readStoredSession,
} from '../src/core/parikshaa.ts';
import { syncToParikshaa } from '../src/background/parikshaa-sync.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

function makeJwt(claims) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

const CLAIMS = {
  iss: 'https://elzftqnehcmnouptaqee.supabase.co/auth/v1',
  sub: '31ca8659-b09f-4b24-921b-da64b58f2e57',
  exp: Math.floor(NOW / 1000) + 3600,
};

/** Minimal Storage stand-in — the real one is only available in a browser. */
function makeStorage(entries) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (index) => keys[index] ?? null,
    getItem: (key) => entries[key] ?? null,
  };
}

test('LeetCode languages map onto Parikshaa editor languages', () => {
  assert.deepEqual(parikshaaLanguage('Python3'), { id: 'python', judge0Id: 71 });
  assert.deepEqual(parikshaaLanguage('C++'), { id: 'cpp', judge0Id: 54 });
  assert.deepEqual(parikshaaLanguage('Java'), { id: 'java', judge0Id: 62 });
  assert.deepEqual(parikshaaLanguage('TypeScript'), { id: 'typescript', judge0Id: 74 });
});

test('versioned Codeforces labels resolve without matching stray letters', () => {
  assert.deepEqual(parikshaaLanguage('GNU G++17 7.3.0'), { id: 'cpp', judge0Id: 54 });
  assert.deepEqual(parikshaaLanguage('PyPy 3-64'), { id: 'python', judge0Id: 71 });
  // "whitespace" contains a "c"; a substring match would wrongly call it C.
  assert.equal(parikshaaLanguage('Whitespace'), undefined);
  assert.equal(parikshaaLanguage(''), undefined);
});

test('a language Parikshaa cannot store returns nothing rather than guessing', () => {
  assert.equal(parikshaaLanguage('Erlang'), undefined);
  assert.equal(parikshaaLanguage('Racket'), undefined);
});

test('unsupported platforms receive the neutral LeetCode-only sync reason', async () => {
  const state = await syncToParikshaa(
    { platform: 'cses' },
    { parikshaa: { enabled: true } },
  );

  assert.deepEqual(state, {
    status: 'skipped',
    reason: 'Parikshaa problems are matched by LeetCode slug, so this platform is not synced.',
  });
  assert.doesNotMatch(state.reason, /Codeforces/);
});

test('JWT claims are decoded without verification', () => {
  const payload = decodeJwtPayload(makeJwt(CLAIMS));
  assert.equal(payload.sub, CLAIMS.sub);
  assert.equal(payload.iss, CLAIMS.iss);
  assert.equal(decodeJwtPayload('not-a-jwt'), undefined);
  assert.equal(decodeJwtPayload(''), undefined);
});

test('credentials derive the REST origin from the token itself', () => {
  const credentials = credentialsFromSession(
    {
      access_token: makeJwt(CLAIMS),
      expires_at: Math.floor(NOW / 1000) + 3600,
      user: { id: CLAIMS.sub, email: 'someone@example.com' },
    },
    'sb_publishable_example',
    NOW,
  );

  // No project id is hard-coded anywhere; it comes out of the issuer claim.
  assert.equal(credentials.url, 'https://elzftqnehcmnouptaqee.supabase.co');
  assert.equal(credentials.userId, CLAIMS.sub);
  assert.equal(credentials.email, 'someone@example.com');
  assert.equal(credentials.expiresAt, NOW + 3_600_000);
});

test('credentials are refused when a required piece is missing', () => {
  assert.equal(credentialsFromSession({ access_token: makeJwt(CLAIMS) }, '', NOW), undefined);
  assert.equal(credentialsFromSession({}, 'key', NOW), undefined);
  assert.equal(
    credentialsFromSession({ access_token: makeJwt({ sub: 'x' }) }, 'key', NOW),
    undefined,
  );
});

test('expiry leaves a margin so a request cannot expire mid-flight', () => {
  const base = { url: 'u', apiKey: 'k', accessToken: 't', userId: 'id', capturedAt: NOW };
  assert.equal(isExpired({ ...base, expiresAt: NOW + 3_600_000 }, NOW), false);
  assert.equal(isExpired({ ...base, expiresAt: NOW - 1 }, NOW), true);
  assert.equal(isExpired({ ...base, expiresAt: NOW + 10_000 }, NOW), true);
});

test('the stored session is read from the supabase-js localStorage entry', () => {
  const session = { access_token: 'abc', expires_at: 123, user: { id: 'u1' } };
  const storage = makeStorage({
    'sb-elzftqnehcmnouptaqee-auth-token': JSON.stringify(session),
    'unrelated-key': 'ignored',
  });
  assert.deepEqual(readStoredSession(storage), session);
});

test('a session split across numbered chunks is reassembled in order', () => {
  const session = { access_token: 'long-token', user: { id: 'u1' } };
  const raw = JSON.stringify(session);
  const storage = makeStorage({
    'sb-ref-auth-token.10': raw.slice(20),
    'sb-ref-auth-token.2': raw.slice(10, 20),
    'sb-ref-auth-token.1': raw.slice(0, 10),
  });
  // Numeric ordering matters: plain string sort would put ".10" before ".2".
  assert.deepEqual(readStoredSession(storage), session);
});

test('a base64-prefixed session value is decoded', () => {
  const session = { access_token: 'abc', user: { id: 'u1' } };
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`;
  assert.deepEqual(readStoredSession(makeStorage({ 'sb-ref-auth-token': encoded })), session);
});

test('a legacy currentSession wrapper is unwrapped', () => {
  const session = { access_token: 'abc', user: { id: 'u1' } };
  const storage = makeStorage({
    'sb-ref-auth-token': JSON.stringify({ currentSession: session, expiresAt: 1 }),
  });
  assert.deepEqual(readStoredSession(storage), session);
});

test('nothing stored means no session', () => {
  assert.equal(readStoredSession(makeStorage({})), undefined);
  assert.equal(readStoredSession(makeStorage({ 'sb-ref-auth-token': 'not json' })), undefined);
});
