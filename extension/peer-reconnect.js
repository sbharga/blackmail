const WEEK = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW = 5 * 60 * 1000;
export function connectionLabel(state, link) {
  if (state === 'Connected') return link.remembered ? 'Connected · link saved' : link.storageAvailable === false ? 'Connected · browser storage unavailable' : 'Connected · saving link…';
  if (link.remembered) return 'Reconnecting · link saved';
  if (state === 'Handshaking') return 'Connecting…';
  return 'Not paired · set up once';
}
const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g), x => parseInt(x, 16));
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = text => Uint8Array.from(atob(text), x => x.charCodeAt(0));
export async function sealSignal(value, secret) {
  const key = await crypto.subtle.importKey('raw', unhex(secret), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: hex(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
}
export async function openSignal(packet, secret) {
  const key = await crypto.subtle.importKey('raw', unhex(secret), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(packet.iv) }, key, unb64(packet.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
export function createReconnect(session, { request, storage = localStorage, now = Date.now, notice = () => {} }) {
  let owner = null, contact = null, pair = null, run = 0, busy = false, pending = null, wakeAt = 0, pausedUntil = 0, wasReady = false, storageAvailable = null;
  const key = () => `blackmail.peer-link:${owner}:${contact}`;
  const leader = () => owner < contact;
  function persist() {
    try { storage.setItem(key(), JSON.stringify(pair)); storageAvailable = true; }
    catch { storageAvailable = false; notice('Browser storage unavailable. Peer link cannot survive refresh.'); }
  }
  function load() {
    try {
      const value = JSON.parse(storage.getItem(key()) || 'null');
      if (value && /^[a-f0-9]{64}$/.test(value.secret) && typeof value.id === 'string' &&
          Number.isFinite(value.expiresAt) && value.expiresAt > now() && value.expiresAt <= now() + WEEK + CLOCK_SKEW) { storageAvailable = true; return value; }
      storage.removeItem(key());
    } catch { storageAvailable = false; }
    return null;
  }
  function remember(value) {
    if (!owner || !contact || !['Connected', 'Handshaking'].includes(session.snapshot().state)) return;
    if (value?.kind === 'remember' && !leader() && typeof value.id === 'string' && value.id.length <= 100 &&
        typeof value.secret === 'string' && /^[a-f0-9]{64}$/.test(value.secret) && Number.isFinite(value.expiresAt) && value.expiresAt > now() && value.expiresAt <= now() + WEEK + CLOCK_SKEW) {
      pair = { id: value.id, secret: value.secret, expiresAt: value.expiresAt, confirmed: true };
      persist(); session.control({ kind: 'remember-ack', id: pair.id }).catch(() => {});
      notice('Peer link remembered for seven days in this browser.');
    } else if (value?.kind === 'remember-ack' && leader() && pair?.id === value.id) {
      pair.confirmed = true; persist(); notice('Peer link remembered for seven days in this browser.');
    }
  }
  session.onControl(remember);
  async function ready() {
    if (!owner || !contact || session.snapshot().state !== 'Connected') return;
    if (!wasReady && pair?.confirmed) notice('Connected. Your remembered peer link was restored.');
    wasReady = true;
    pausedUntil = 0; pending = null;
    if (!pair || pair.expiresAt <= now()) pair = null;
    if (leader()) {
      if (!pair) { pair = { id: crypto.randomUUID(), secret: hex(crypto.getRandomValues(new Uint8Array(32))), expiresAt: now() + WEEK, confirmed: false }; persist(); }
      if (!pair.confirmed) await session.control({ kind: 'remember', id: pair.id, secret: pair.secret, expiresAt: pair.expiresAt });
    }
  }
  async function publish(value, target, credential) {
    const packet = await sealSignal({ ...value, pairId: credential.id, at: now() }, credential.secret);
    await request('peer-signals/write', { contactId: target, packet });
  }
  async function offer(target, credential, currentRun) {
    if (pending) return;
    wasReady = false;
    pending = { id: crypto.randomUUID(), until: now() + 80000 };
    const id = pending.id;
    const token = await session.offer();
    if (currentRun !== run) return;
    await publish({ kind: 'offer', id, token }, target, credential);
    notice('Reconnecting your remembered peer link…');
  }
  async function tick() {
    if (busy || !owner || !contact) return;
    busy = true; const currentRun = run, target = contact;
    try {
      await ready();
      if (currentRun !== run) return;
      if (!pair || pair.expiresAt <= now()) {
        if (pair) { try { storage.removeItem(key()); } catch {} pair = null; notice('Peer link expired. Exchange new tokens.'); }
        return;
      }
      if (!pair.confirmed || now() < pausedUntil) return;
      const credential = pair;
      const result = await request('peer-signals/read', { contactId: target });
      if (currentRun !== run || credential !== pair) return;
      let value = null;
      if (result.packet) { try { value = await openSignal(result.packet, credential.secret); } catch { /* Old/untrusted signal cannot reconnect this link. */ } }
      if (currentRun !== run) return;
      if (value && value.pairId === pair.id && typeof value.id === 'string' && value.at <= now() + 10000 && value.at > now() - 90000 && value.id !== pair.seen) {
        pair.seen = value.id; persist();
        if (value.kind === 'wake' && leader() && !pending) await offer(target, credential, currentRun);
        else if (value.kind === 'offer' && !leader() && typeof value.token === 'string') {
          wasReady = false;
          const answer = await session.answer(value.token);
          if (currentRun !== run) return;
          await publish({ kind: 'answer', id: crypto.randomUUID(), offerId: value.id, token: answer }, target, credential);
          notice('Reconnecting your remembered peer link…');
        } else if (value.kind === 'answer' && leader() && value.offerId === pending?.id && typeof value.token === 'string') {
          await session.finalize(value.token); if (currentRun === run) pending = null;
        }
      }
      if (currentRun !== run) return;
      if (pending && pending.until <= now()) { pending = null; session.reset(contact); }
      if (session.snapshot().state === 'Disconnected') {
        wasReady = false;
        if (leader()) await offer(target, credential, currentRun);
        else if (now() >= wakeAt) { wakeAt = now() + 15000; await publish({ kind: 'wake', id: crypto.randomUUID() }, target, credential); }
      }
    } catch { if (currentRun === run) notice('Waiting for your peer or connection service. Formal sending remains available.'); }
    finally { busy = false; }
  }
  return {
    tick, ready: () => ready().catch(() => {}),
    select(userId, contactId) { run++; owner = userId; contact = contactId; pending = null; wakeAt = pausedUntil = 0; wasReady = false; storageAvailable = null; pair = owner && contact ? load() : null; },
    manual() { run++; pausedUntil = now() + 120000; pending = null; wasReady = false; },
    forget() { run++; if (owner && contact) { try { storage.removeItem(key()); } catch {} } pair = null; pending = null; pausedUntil = Infinity; session.reset(contact); notice('Remembered link removed from this browser.'); },
    snapshot: () => ({ remembered: Boolean(storageAvailable && pair?.confirmed && pair.expiresAt > now()), expiresAt: pair?.expiresAt, storageAvailable }),
  };
}
