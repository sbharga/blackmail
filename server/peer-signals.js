// Short-lived opaque signaling only. No informal messages or pairing keys.
export class PeerSignals {
  constructor({ command, now = Date.now } = {}) { this.command = command; this.now = now; this.memory = new Map(); }
  key(sender, recipient) { return `blackmail:signal:${sender}:${recipient}`; }
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
