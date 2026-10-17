import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverMessage } from '../extension/message-delivery.js';

test('disconnected send writes formal only and never exposes the original', async () => {
  const calls = [];
  const result = await deliverMessage({ connected: false, original: 'private', formal: 'approved', aiReady: false,
    sendFormal: async text => calls.push(['formal', text]), sendOriginal: async text => calls.push(['private', text]) });
  assert.deepEqual(calls, [['formal', 'approved']]); assert.equal(result.informal, false);
});
test('connected send requires AI review and commits formal before P2P', async () => {
  const calls = [];
  const options = { connected: true, original: 'raw draft', formal: 'AI reviewed', aiReady: false,
    sendFormal: async text => calls.push(['formal', text]), sendOriginal: async text => calls.push(['private', text]) };
  await assert.rejects(deliverMessage(options), /Nebius/); assert.deepEqual(calls, []);
  assert.deepEqual(await deliverMessage({ ...options, aiReady: true }), { informal: true });
  assert.deepEqual(calls, [['formal', 'AI reviewed'], ['private', 'raw draft']]);
});
test('formal failure prevents informal send; P2P failure reports partial success without a second formal write', async () => {
  let privateCalls = 0, formalCalls = 0;
  const options = { connected: true, original: 'raw', formal: 'approved', aiReady: true,
    sendFormal: async () => { throw Error('backend unavailable'); }, sendOriginal: async () => { privateCalls++; } };
  await assert.rejects(deliverMessage(options), /backend/); assert.equal(privateCalls, 0);
  const result = await deliverMessage({ ...options, sendFormal: async () => { formalCalls++; }, sendOriginal: async () => { throw Error('channel closed'); } });
  assert.equal(formalCalls, 1); assert.deepEqual(result, { informal: false, privateError: 'channel closed' });
});
