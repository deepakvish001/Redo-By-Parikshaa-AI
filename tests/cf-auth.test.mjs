import assert from 'node:assert/strict';
import test from 'node:test';

import {
  apiSignature,
  describeAuthFailure,
  hasCredentials,
  readSignedInHandle,
  readUserInfo,
  signablePairs,
  signedParams,
} from '../src/core/cf-auth.ts';

/* ------------------------------------------------------------- signatures */

test('the signed parameters are ordered exactly as Codeforces specifies', () => {
  // Sorted by name, then by value for the duplicates. A signature computed over
  // any other order is simply wrong, and the server does not say so.
  assert.equal(
    signablePairs({ handles: 'a;b', apiKey: 'key', time: '100' }),
    'apiKey=key&handles=a;b&time=100',
  );
});

test('the signature hashes the string Codeforces says it hashes', async () => {
  // The parameters from the API documentation's worked example — contest.hacks,
  // contestId 566, key `xxx`, secret `yyy`, time 1268210298, prefix 123456.
  //
  // The pinned value is SHA-512 of
  //   123456/contest.hacks?apiKey=xxx&contestId=566&time=1268210298#yyy
  // computed here, not copied from Codeforces — so what this pins is the string
  // that gets hashed and the shape of the result, which is where the mistakes
  // are. Whether the live server accepts it can only be settled by the server.
  const signature = await apiSignature(
    'contest.hacks',
    { contestId: '566', apiKey: 'xxx', time: '1268210298' },
    'yyy',
    '123456',
  );

  assert.equal(
    signature,
    '123456' +
      '11505091fcb50b87b1a8dcc7ce0f718a6ab8031fe3fca24c85d55a25c025f74f' +
      'a7f35ae9002074fc8d012bc72f77c373d1fbb83296ed50e4a8a25c3551967df3',
  );
});

test('the order the parameters were written in does not change the signature', async () => {
  const one = await apiSignature('user.info', { handles: 'a', apiKey: 'k', time: '1' }, 's', '000000');
  const two = await apiSignature('user.info', { time: '1', handles: 'a', apiKey: 'k' }, 's', '000000');
  assert.equal(one, two);
});

test('a signed call carries the key, the time and the signature', async () => {
  const params = await signedParams(
    'user.friends',
    { onlyOnline: 'false' },
    { key: 'k', secret: 's' },
    1_700_000_000_000,
    '000000',
  );

  assert.equal(params.apiKey, 'k');
  assert.equal(params.time, '1700000000', 'seconds, not milliseconds');
  assert.equal(params.onlyOnline, 'false');
  assert.match(params.apiSig, /^000000[0-9a-f]{128}$/);
  assert.equal(params.secret, undefined, 'the secret is hashed, never sent');
});

test('a half-filled credential pair is not a credential pair', () => {
  assert.equal(hasCredentials({ key: 'k', secret: 's' }), true);
  assert.equal(hasCredentials({ key: 'k', secret: '  ' }), false);
  assert.equal(hasCredentials({}), false);
});

/* ------------------------------------------------------------ user.info */

test('the handle comes back as Codeforces spells it', () => {
  const info = readUserInfo([{ handle: 'Tourist', rating: 3800, rank: 'legendary grandmaster' }]);
  assert.equal(info.handle, 'Tourist');
  assert.equal(info.rating, 3800);
});

test('an unrated user has no rating rather than a zero', () => {
  // Zero would render as "rated 0", which is a different claim from "unrated".
  assert.equal(readUserInfo([{ handle: 'newbie' }]).rating, undefined);
});

test('no such user is an error, not an empty profile', () => {
  assert.match(readUserInfo([]).handleError, /no such user/i);
});

/* ------------------------------------------- the session in this browser */

const SIGNED_IN = `<html><body><div class="lang-chooser">
<a href="/profile/deepak">deepak</a> | <a href="/logout?csrf=abc">Logout</a></div>
<div class="recent"><a href="/profile/tourist">tourist</a> posted</div></body></html>`;

const SIGNED_OUT = `<html><body><div class="lang-chooser">
<a href="/enter">Enter</a> | <a href="/register">Register</a></div>
<div class="recent"><a href="/profile/tourist">tourist</a> posted</div></body></html>`;

test('the signed-in handle is read from the header, not the recent actions', () => {
  // A signed-out page is full of profile links too. The logout link is what
  // distinguishes the header's one from everybody else's.
  assert.equal(readSignedInHandle(SIGNED_IN), 'deepak');
});

test('a signed-out page reports signed out', () => {
  assert.equal(readSignedInHandle(SIGNED_OUT), undefined);
});

test('signed in with an unreadable handle is not the same as signed out', () => {
  // `''` means "signed in, handle unknown"; `undefined` means "signed out".
  // Collapsing the two would tell somebody Submit will fail when it will work.
  assert.equal(readSignedInHandle('<a href="/logout?csrf=x">Logout</a>'), '');
});

/* ---------------------------------------------------------------- errors */

test('a rejected signature says the clock is a suspect', () => {
  // A clock a few minutes out fails identically to a wrong secret, and somebody
  // who has just pasted the secret correctly will otherwise keep re-pasting it.
  assert.match(describeAuthFailure('apiSig: Signature is incorrect'), /clock/);
});

test('an unknown key points at where keys are revoked', () => {
  assert.match(describeAuthFailure('apiKey: Incorrect API key'), /settings\/api/);
});
