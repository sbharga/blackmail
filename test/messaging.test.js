import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessaging, isPublishableKey } from '../server/supabase.js';

const publicKey = 'sb_publishable_blackmail_test_key';
const token = 'a'.repeat(40);
const recipient = '10000000-0000-4000-8000-000000000002';
const requestId = '20000000-0000-4000-8000-000000000001';
test('messaging refuses privileged keys and fails closed when not configured', async () => {
  assert.equal(isPublishableKey('sb_secret_private_key'), false);
  const jwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.equal(isPublishableKey(jwt('service_role')), false);
  assert.equal(isPublishableKey(jwt('anon')), true);
  const app = createMessaging({ url: 'https://project.supabase.co', key: 'sb_secret_private_key' });
  assert.equal(app.enabled, false);
  assert.equal((await app.handle('/api/messaging/login', null, {})).status, 503);
});
test('formal delivery uses user JWT and an explicit payload allowlist', async () => {
  const calls = [];
  const app = createMessaging({ url: 'https://project.supabase.co', key: publicKey, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: requestId, body_formal: 'Please check the report.' }), { status: 200 });
  } });
  assert.equal((await app.handle('/api/messaging/send', null, {})).status, 401);
  assert.equal(calls.length, 0);
  const result = await app.handle('/api/messaging/send', `Bearer ${token}`, {
    recipientId: recipient, formal: ' Please check the report. ', clientMessageId: requestId,
    original: 'not for the formal channel', senderId: 'spoofed'
  });
  assert.equal(result.status, 201);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0].options.headers.apikey, publicKey);
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_recipient: recipient, p_body: 'Please check the report.', p_client_message_id: requestId });
  assert.equal(JSON.stringify(calls).includes('not for the formal channel'), false);
  assert.equal(JSON.stringify(calls).includes('spoofed'), false);
  assert.equal((await app.handle('/api/messaging/thread', `Bearer ${token}`, { contactId: 'bad-filter&select=*' })).status, 400);
});
test('signup normalizes username, supports email confirmation, and never returns passwords', async () => {
  const app = createMessaging({ url: 'https://project.supabase.co', key: publicKey, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://project.supabase.co/auth/v1/signup');
    assert.equal(options.headers.Authorization, undefined);
    const payload = JSON.parse(options.body);
    assert.equal(payload.data.username, 'alice_test');
    assert.equal(payload.data.display_name, 'Alice');
    return new Response(JSON.stringify({ user: { id: requestId } }));
  } });
  const result = await app.handle('/api/messaging/signup', null, { email: 'alice@example.invalid', password: 'synthetic-test-password', username: ' Alice_test ', displayName: ' Alice ' });
  assert.deepEqual(result, { status: 200, body: { needsConfirmation: true } });
  assert.equal((await app.handle('/api/messaging/signup', null, { email: 'alice@example.invalid', password: 'short', username: 'alice', displayName: 'Alice' })).status, 400);
});
test('refresh returns only session fields and provider failures do not leak credentials', async () => {
  const app = createMessaging({ url: 'https://project.supabase.co', key: publicKey, fetchImpl: async () => {
    return new Response(JSON.stringify({ access_token: token, refresh_token: 'refresh-token', expires_at: 2000000000, provider_token: 'must-not-be-returned' }));
  } });
  const result = await app.handle('/api/messaging/refresh', null, { refreshToken: 'refresh-token' });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body.session).sort(), ['access_token', 'expires_at', 'refresh_token']);
  const broken = createMessaging({ url: 'https://project.supabase.co', key: publicKey, fetchImpl: async () => { throw new Error('credential-internal-details'); } });
  const failure = await broken.handle('/api/messaging/contacts', `Bearer ${token}`, {});
  assert.equal(failure.status, 502);
  assert.equal(JSON.stringify(failure).includes('credential-internal-details'), false);
});
