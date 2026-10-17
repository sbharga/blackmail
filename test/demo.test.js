import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../extension/demo-state.js';

test('demo pass grants original access; revoke preserves formal record', () => {
  let clock = 1000;
  const demo = createDemo(() => clock);
  const message = demo.send('Alice', 'Bob', 'bro send it friday', 'Please send it on Friday.');
  assert.equal(demo.originalFor(message, 'Alice'), 'bro send it friday');
  assert.equal(demo.originalFor(message, 'Bob'), null);
  assert.equal(demo.share(message, 'Bob'), false);
  assert.equal(demo.share(message, 'Alice'), true);
  assert.equal(demo.originalFor(message, 'Bob'), 'bro send it friday');
  assert.equal(demo.originalFor(message, 'Maya'), null);
  assert.equal(demo.revoke(message, 'Bob'), false);
  assert.equal(demo.revoke(message, 'Alice'), true);
  assert.equal(demo.originalFor(message, 'Alice'), null);
  assert.equal(demo.originalFor(message, 'Bob'), null);
  assert.equal(message.formal, 'Please send it on Friday.');
  const expiring = demo.send('Bob', 'Alice', 'ok!', 'That works for me.', true);
  clock = expiring.expiresAt;
  assert.equal(demo.originalFor(expiring, 'Alice'), null);
  assert.equal(demo.share(expiring, 'Bob'), false);
  assert.equal(expiring.formal, 'That works for me.');
  assert.equal(demo.thread('Alice', 'Bob'), demo.thread('Bob', 'Alice'));
  assert.equal(demo.thread('Bob', 'Maya').length, 0);
});
