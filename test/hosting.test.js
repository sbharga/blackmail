import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server/index.js';
import { RedisVault } from '../server/redis-vault.js';
import { hash } from '../server/vault.js';

test('Redis adapter shares encrypted records and sets five-minute TTL', async () => {
  const calls = [];
  const records = new Map();
  const command = async (...args) => {
    calls.push(args);
    if (args[0] === 'SET') { records.set(args[1], args[2]); return 'OK'; }
    if (args[0] === 'GET') return records.get(args[1]) || null;
    if (args[0] === 'EVAL') return 1;
    throw new Error('Unexpected command');
  };
  let clock = 1000;
  const sender = new RedisVault({ command, now: () => clock });
  const recipient = new RedisVault({ command, now: () => clock });
  const payload = { ciphertext: randomBytes(40).toString('base64'), iv: randomBytes(12).toString('base64'), access: randomBytes(32).toString('hex') };
  const item = await sender.create(payload);
  assert.deepEqual(calls[0].slice(3), ['PX', 300000, 'NX']);
  const stored = JSON.parse(calls[0][2]);
  assert.equal(stored.accessHash, hash(payload.access));
  assert.equal(stored.ownerHash, hash(item.owner));
  assert.equal(stored.access, undefined);
  assert.equal((await recipient.read(item.id, payload.access)).ciphertext, payload.ciphertext);
  assert.equal(await recipient.read(item.id, item.owner), null);
  clock = item.expiresAt;
  assert.equal(await recipient.read(item.id, payload.access), null);
  await sender.revoke(item.id, item.owner);
  const revoke = calls.at(-1);
  assert.equal(revoke[0], 'EVAL');
  assert.match(revoke[1], /ownerHash/);
  assert.deepEqual(revoke.slice(2), [1, `blackmail:message:${item.id}`, hash(item.owner)]);
});

test('hosted mode fails closed without shared storage', async t => {
  const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
  const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const server = createApp({ hosted: true, apiKey: '' });
  if (savedUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = savedUrl;
  if (savedToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = savedToken;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.ok, false);
  assert.equal(health.storage, 'unconfigured');
  const response = await fetch(base + '/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 503);
});
