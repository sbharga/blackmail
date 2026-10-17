import { hash, matches, prepareMessage } from './vault.js';

// Redis REST, compatible with Upstash. No provider SDK or client-side credentials.
export function redisCommand(url, token) {
  if (!url?.startsWith('https://') || !token) throw new Error('Redis HTTPS URL and token required.');
  return async (...command) => {
    const response = await fetch(url, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command), signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('Shared storage unavailable.');
    const data = await response.json();
    if (data.error) throw new Error('Shared storage request failed.');
    return data.result;
  };
}
export class RedisVault {
  constructor({ command, now = Date.now, ttlMs = 300_000 }) {
    this.command = command; this.now = now; this.ttlMs = ttlMs;
  }
  async create(payload) {
    const { id, owner, expiresAt, record } = prepareMessage(payload, this.now(), this.ttlMs);
    const result = await this.command('SET', `blackmail:message:${id}`, JSON.stringify(record), 'PX', this.ttlMs, 'NX');
    if (result !== 'OK') throw new Error('Could not create pass. Try again.');
    return { id, owner, expiresAt };
  }
  async read(id, access) {
    const raw = await this.command('GET', `blackmail:message:${id}`);
    if (!raw) return null;
    const item = JSON.parse(raw);
    if (item.expiresAt <= this.now() || !matches(access, item.accessHash)) return null;
    return { ciphertext: item.ciphertext, iv: item.iv, expiresAt: item.expiresAt };
  }
  async revoke(id, owner) {
    if (typeof owner !== 'string' || owner.length > 200) return false;
    const script = "local v=redis.call('GET',KEYS[1]); if not v then return 0 end; local m=cjson.decode(v); if m.ownerHash~=ARGV[1] then return 0 end; return redis.call('DEL',KEYS[1])";
    return (await this.command('EVAL', script, 1, `blackmail:message:${id}`, hash(owner))) === 1;
  }
  async allow(address) {
    const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],60000) end; return n";
    return (await this.command('EVAL', script, 1, `blackmail:rate:${hash(address)}:${Math.floor(this.now() / 60000)}`)) <= 180;
  }
}
