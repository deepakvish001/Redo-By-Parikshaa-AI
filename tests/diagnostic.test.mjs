import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseSession } from '../src/core/parikshaa.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

function makeJwt(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

const GOOD_TOKEN = makeJwt({
  iss: 'https://elzftqnehcmnouptaqee.supabase.co/auth/v1',
  sub: '31ca8659-b09f-4b24-921b-da64b58f2e57',
  exp: Math.floor(NOW / 1000) + 3600,
});

function makeStorage(entries) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (index) => keys[index] ?? null,
    getItem: (key) => entries[key] ?? null,
  };
}

test('a healthy session reports every check passing', () => {
  const result = diagnoseSession(
    makeStorage({
      'sb-elzftqnehcmnouptaqee-auth-token': JSON.stringify({
        access_token: GOOD_TOKEN,
        user: { id: 'u1', email: 'a@b.com' },
      }),
    }),
  );

  assert.deepEqual(result.matchedKeys, ['sb-elzftqnehcmnouptaqee-auth-token']);
  assert.equal(result.parsed, true);
  assert.equal(result.hasAccessToken, true);
  assert.equal(result.hasIssuer, true);
  assert.equal(result.hasUserId, true);
  assert.equal(result.issuer, 'https://elzftqnehcmnouptaqee.supabase.co');
  // Nothing sensitive travels with the report.
  assert.equal(JSON.stringify(result).includes(GOOD_TOKEN), false);
  assert.equal(JSON.stringify(result).includes('a@b.com'), false);
});

test('no session key at all is distinguishable, and lists what was there', () => {
  const result = diagnoseSession(
    makeStorage({ theme: 'dark', 'some-cache': '{}', 'another-key': '1' }),
  );

  assert.deepEqual(result.matchedKeys, []);
  assert.deepEqual(result.sampleKeys, ['theme', 'some-cache', 'another-key']);
  assert.equal(result.parsed, false);
  assert.equal(result.hasAccessToken, false);
});

test('a signed-out session is told apart from a missing one', () => {
  const result = diagnoseSession(
    makeStorage({ 'sb-ref-auth-token': JSON.stringify({ user: null }) }),
  );

  assert.deepEqual(result.matchedKeys, ['sb-ref-auth-token']);
  assert.equal(result.parsed, true);
  assert.equal(result.hasAccessToken, false);
  // A found-but-empty session must not report a sample key dump.
  assert.equal(result.sampleKeys, undefined);
});

test('unreadable contents are told apart from a signed-out session', () => {
  const result = diagnoseSession(makeStorage({ 'sb-ref-auth-token': 'not json at all' }));
  assert.deepEqual(result.matchedKeys, ['sb-ref-auth-token']);
  assert.equal(result.parsed, false);
});

test('a token without an issuer claim is identified precisely', () => {
  const result = diagnoseSession(
    makeStorage({
      'sb-ref-auth-token': JSON.stringify({ access_token: makeJwt({ sub: 'u1' }) }),
    }),
  );
  assert.equal(result.hasAccessToken, true);
  assert.equal(result.hasIssuer, false);
  assert.equal(result.hasUserId, true);
});

test('the legacy supabase.auth.token key is still recognised', () => {
  const result = diagnoseSession(
    makeStorage({ 'supabase.auth.token': JSON.stringify({ access_token: GOOD_TOKEN }) }),
  );
  assert.deepEqual(result.matchedKeys, ['supabase.auth.token']);
  assert.equal(result.hasIssuer, true);
});

test('sibling supabase keys are not mistaken for the session', () => {
  const result = diagnoseSession(
    makeStorage({
      'sb-ref-auth-token-user': '{}',
      'sb-ref-auth-token-code-verifier': 'abc',
    }),
  );
  assert.deepEqual(result.matchedKeys, []);
});

test('chunked sessions are matched and reassembled', () => {
  const raw = JSON.stringify({ access_token: GOOD_TOKEN });
  const result = diagnoseSession(
    makeStorage({
      'sb-ref-auth-token.0': raw.slice(0, 30),
      'sb-ref-auth-token.1': raw.slice(30),
    }),
  );
  assert.equal(result.matchedKeys.length, 2);
  assert.equal(result.parsed, true);
  assert.equal(result.hasAccessToken, true);
});
