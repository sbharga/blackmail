import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest();
const matches = (value, expected) => typeof value === 'string' && value.length < 200 && timingSafeEqual(hash(value), expected);
export class Vault {
  constructor({ now = Date.now, ttlMs = 300_000 } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.messages = new Map();
  }
  prune() {
    for (const [id, item] of this.messages) if (item.expiresAt <= this.now()) this.messages.delete(id);
  }
  create({ ciphertext, iv, access }) {
    this.prune();
    if (this.messages.size >= 1000) throw new Error('Vault full. Try again later.');
    if (typeof ciphertext !== 'string' || !/^[A-Za-z0-9+/=]{24,70000}$/.test(ciphertext) ||
        typeof iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(iv) ||
        typeof access !== 'string' || !/^[a-f0-9]{64}$/.test(access)) throw new Error('Invalid encrypted message.');
    const id = randomBytes(16).toString('hex');
    const owner = randomBytes(32).toString('hex');
    const expiresAt = this.now() + this.ttlMs;
    this.messages.set(id, { ciphertext, iv, accessHash: hash(access), ownerHash: hash(owner), expiresAt });
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
