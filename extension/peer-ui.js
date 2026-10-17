import * as transport from './p2p.js';
import { serverNow } from './app.js';
import { createReconnect, connectionLabel } from './peer-reconnect.js';
import { createPeerSession } from './p2p-session.js';
import { demoPeerFor } from './demo-peers.js';
export function setupPeerUI() {
  const $ = id => document.getElementById(id);
  let busy = false, contact = null;
  let owner = null, call = async () => { throw new Error('Sign in first.'); }, reconnect = null;
  const status = text => { $('peer-status').textContent = text; };
  const session = createPeerSession(transport, render, serverNow);
  reconnect = createReconnect(session, { request: (...args) => call(...args), now: serverNow, notice: text => { status(text); queueMicrotask(render); } });
  function render() {
    const current = session.snapshot();
    const remembered = reconnect?.snapshot();
    $('peer-state').textContent = contact ? connectionLabel(current.state, remembered || {}) : 'Select a contact';
    $('peer-expiry').textContent = demoPeerFor(owner) === contact?.id
      ? 'Diana–Bob demo pairing is automatic for these two accounts. Both must be online; no copy/paste setup needed.'
      : remembered?.remembered ? `Link saved in this browser until ${new Date(remembered.expiresAt).toLocaleDateString()}. Both people must be online to reconnect.` : 'Complete setup once and wait for “link saved” before refreshing.';
    $('peer-forget').textContent = demoPeerFor(owner) === contact?.id ? 'Disconnect this demo session' : 'Forget remembered link';
    for (const id of ['peer-offer', 'peer-answer', 'peer-finalize']) $(id).disabled = busy || !contact;
    document.dispatchEvent(new Event('blackmail-peer-change'));
    if (current.state === 'Connected') reconnect?.ready();
  }
  function clearTokens() { for (const id of ['peer-output','peer-input']) $(id).value = ''; }
  for (const [id, action] of [
    ['peer-offer', async (wait) => { reconnect.manual(); clearTokens(); $('peer-output').value = await wait(session.offer()); status('Send this offer to your contact. Keep this tab open.'); }],
    ['peer-answer', async (wait) => { reconnect.manual(); const token = $('peer-input').value; $('peer-output').value = ''; $('peer-output').value = await wait(session.answer(token)); $('peer-input').value = ''; status('Send this answer back. Waiting for the other person to finish.'); }],
    ['peer-finalize', async (wait) => { await wait(session.finalize($('peer-input').value)); clearTokens(); status('Handshake applied. Waiting for an encrypted connection check.'); }],
    ['peer-copy', async (wait) => { if (!$('peer-output').value) throw new Error('Generate a token first.'); await navigator.clipboard.writeText($('peer-output').value); status('Token copied.'); }],
    ['peer-forget', async () => { reconnect.forget(); clearTokens(); render(); }],
  ]) $(id).addEventListener('click', async () => {
    if (busy) return; busy = true; render(); const target = contact;
    const wait = async promise => { const result = await promise; if (target !== contact) throw new Error('Conversation changed.'); return result; };
    try { await action(wait); } catch (error) { if (target === contact) status(error.message); }
    finally { busy = false; render(); }
  });
  setInterval(() => session.tick(), 3000);
  setInterval(() => reconnect.tick(), 6000);
  render();
  return {
    snapshot: () => session.snapshot(),
    send: (text, messageId) => session.send(text, messageId),
    wake: () => reconnect.tick(),
    account(id, request) { owner = id; call = request; },
    select(next) {
      contact = next; reconnect.select(owner, next?.id || null); session.reset(next?.id || null); clearTokens();
      status(next ? (reconnect.snapshot().remembered ? 'Remembered link. Reconnecting when your peer is online…' : `Connect directly with @${next.username}.`) : 'Select a contact first.');
      reconnect.tick();
    },
  };
}
