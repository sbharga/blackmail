import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const matches = (value, expected) => typeof value === 'string' && value.length < 200 && timingSafeEqual(Buffer.from(hash(value), 'hex'), Buffer.from(expected, 'hex'));
export function prepareMessage({ ciphertext, iv, access }, now, ttlMs) {
  if (typeof ciphertext !== 'string' || !/^[A-Za-z0-9+/=]{24,70000}$/.test(ciphertext) ||
      typeof iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(iv) ||
      typeof access !== 'string' || !/^[a-f0-9]{64}$/.test(access)) throw new Error('Invalid encrypted message.');
  const id = randomBytes(16).toString('hex');
  const owner = randomBytes(32).toString('hex');
  const expiresAt = now + ttlMs;
  return { id, owner, expiresAt, record: { ciphertext, iv, accessHash: hash(access), ownerHash: hash(owner), expiresAt } };
}
export class Vault {
  constructor({ now = Date.now, ttlMs = 300_000 } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.messages = new Map();
  }
  prune() {
    for (const [id, item] of this.messages) if (item.expiresAt <= this.now()) this.messages.delete(id);
  }
  create(payload) {
    this.prune();
    if (this.messages.size >= 1000) throw new Error('Vault full. Try again later.');
    const { id, owner, expiresAt, record } = prepareMessage(payload, this.now(), this.ttlMs);
    this.messages.set(id, record);
    return { id, owner, expiresAt };
  }
  read(id, access) {
    this.prune();
    const item = this.messages.get(id);
    if (!item || !matches(access, item.accessHash)) return null;
    return { ciphertext: item.ciphertext, iv: item.iv, expiresAt: item.expiresAt };
  }
  revoke(id, owner) {
    this.prune();
    const item = this.messages.get(id);
    if (!item || !matches(owner, item.ownerHash)) return false;
    this.messages.delete(id);
    return true;
  }
}
