import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCOPES,
  formatUserCode,
  readDeviceCode,
  readPoll,
} from '../src/core/device-flow.ts';

/* ------------------------------------------------------------ the request */

test('the scope asked for is the narrower one by default', () => {
  // A public solutions repository is the common case, and asking for private
  // repositories as well when they are not needed is exactly the over-reach the
  // fine-grained token path exists to avoid.
  assert.equal(SCOPES.public, 'public_repo');
  assert.equal(SCOPES.private, 'repo');
});

/* --------------------------------------------------------- the device code */

test('GitHub’s device code is read into something the page can show', () => {
  const code = readDeviceCode(
    {
      device_code: 'dev-1',
      user_code: 'abcd-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    },
    1_000,
  );

  assert.equal(code.deviceCode, 'dev-1');
  assert.equal(code.userCode, 'abcd-1234');
  assert.equal(code.expiresAt, 1_000 + 900_000);
});

test('a poll interval below GitHub’s floor is raised, not obeyed', () => {
  // Polling faster than five seconds earns a `slow_down` and then a ban, so a
  // server that says 1 does not get 1.
  assert.equal(readDeviceCode({ device_code: 'd', user_code: 'u', interval: 1 }, 0).interval, 5);
  assert.equal(readDeviceCode({ device_code: 'd', user_code: 'u' }, 0).interval, 5);
});

test('an answer with no code is no code, not a half-built one', () => {
  assert.equal(readDeviceCode({ error: 'unauthorized_client' }, 0), undefined);
  assert.equal(readDeviceCode({ device_code: 'd' }, 0), undefined);
});

/* --------------------------------------------------------------- the polls */

test('waiting for the user is not an error', () => {
  // This is the normal answer for as long as somebody is still typing the code
  // into github.com — surfacing it as a failure would end the flow every time.
  assert.deepEqual(readPoll({ error: 'authorization_pending' }), { state: 'pending' });
});

test('slow_down raises the interval rather than failing', () => {
  assert.deepEqual(readPoll({ error: 'slow_down', interval: 10 }), {
    state: 'slow-down',
    interval: 10,
  });
  // Still floored, even when GitHub asks for less than the floor.
  assert.equal(readPoll({ error: 'slow_down', interval: 2 }).interval, 5);
});

test('the token is read when it arrives', () => {
  assert.deepEqual(readPoll({ access_token: 'gho_x', token_type: 'bearer' }), {
    state: 'token',
    token: 'gho_x',
  });
});

test('a build with no client id is told what to do instead', () => {
  // GitHub words this one `unauthorized_client`, which tells a user nothing.
  const outcome = readPoll({ error: 'unauthorized_client' });
  assert.equal(outcome.state, 'failed');
  assert.match(outcome.error, /fine-grained token/);
});

test('cancelling on GitHub is reported as cancelling, not as breakage', () => {
  assert.match(readPoll({ error: 'access_denied' }).error, /cancelled/);
  assert.match(readPoll({ error: 'expired_token' }).error, /expired/);
});

test('an unknown error is quoted rather than swallowed', () => {
  const outcome = readPoll({ error: 'device_flow_disabled', error_description: 'Device flow is off' });
  assert.equal(outcome.state, 'failed');
  assert.equal(outcome.error, 'Device flow is off');
});

test('an empty answer fails loudly instead of polling forever', () => {
  assert.equal(readPoll({}).state, 'failed');
});

/* ---------------------------------------------------------------- the code */

test('the code is shown the way GitHub’s own page asks for it', () => {
  assert.equal(formatUserCode('abcd-1234'), 'ABCD-1234');
});
