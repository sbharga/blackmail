// Opaque signaling plus the explicitly authorized Bob/Diana demo reconnect credential.
// Informal messages never enter this store.
import { randomBytes, randomUUID } from 'node:crypto';
import { demoPeerFor } from '../extension/demo-peers.js';
export class PeerSignals {
  constructor({ command, now = Date.now } = {}) { this.command = command; this.now = now; this.memory = new Map(); }
  key(sender, recipient) { return `blackmail:signal:${sender}:${recipient}`; }
  async demoLink(userId, contactId) {
    if (demoPeerFor(userId) !== contactId) throw new Error('Demo pairing is limited to Bob and Diana.');
    const key = 'blackmail:demo-link:v1:test2:test4', ttl = 7 * 24 * 60 * 60 * 1000;
    const fresh = () => ({ id: randomUUID(), secret: randomBytes(32).toString('hex'), expiresAt: this.now() + ttl, confirmed: true });
    if (this.command) {
      await this.command('SET', key, JSON.stringify(fresh()), 'PX', ttl, 'NX');
      const result = await this.command('GET', key);
      if (!result) throw new Error('Demo pairing unavailable. Retry shortly.');
      return JSON.parse(result);
    }
    const existing = this.memory.get(key);
    if (existing?.expiresAt > this.now()) return existing;
    const link = fresh(); this.memory.set(key, link); return link;
  }
  async put(sender, recipient, packet) {
    const key = this.key(sender, recipient), record = { packet, expiresAt: this.now() + 90000 };
    if (this.command) await this.command('SET', key, JSON.stringify(record), 'PX', 90000);
    else this.memory.set(key, record);
  }
  async get(sender, recipient) {
    const key = this.key(sender, recipient);
    const raw = this.command ? await this.command('GET', key) : null;
    const record = this.command ? (raw ? JSON.parse(raw) : null) : this.memory.get(key);
    if (!record || record.expiresAt <= this.now()) { this.memory.delete(key); return null; }
    return record.packet;
  }
}
