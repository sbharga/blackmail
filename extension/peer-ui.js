import * as transport from './p2p.js';
import { serverNow } from './app.js';
import { createPeerSession } from './p2p-session.js';
export function setupPeerUI() {
  const $ = id => document.getElementById(id);
  let busy = false, contact = null;
  const status = text => { $('peer-status').textContent = text; };
  const session = createPeerSession(transport, render, serverNow);
  function render() {
    const current = session.snapshot();
    $('peer-state').textContent = `${current.state}${current.peer ? ` · peer ${current.peer}` : ''}`;
    for (const id of ['peer-offer', 'peer-answer', 'peer-finalize']) $(id).disabled = busy || !contact;
    document.dispatchEvent(new Event('blackmail-peer-change'));
  }
  function clearTokens() { for (const id of ['peer-output','peer-input']) $(id).value = ''; }
  for (const [id, action] of [
    ['peer-offer', async (wait) => { clearTokens(); $('peer-output').value = await wait(session.offer()); status('Send this offer to your contact. Keep this tab open.'); }],
    ['peer-answer', async (wait) => { const token = $('peer-input').value; $('peer-output').value = ''; $('peer-output').value = await wait(session.answer(token)); $('peer-input').value = ''; status('Send this answer back. Waiting for the other person to finish.'); }],
    ['peer-finalize', async (wait) => { await wait(session.finalize($('peer-input').value)); clearTokens(); status('Handshake applied. Waiting for an encrypted connection check.'); }],
    ['peer-copy', async (wait) => { if (!$('peer-output').value) throw new Error('Generate a token first.'); await navigator.clipboard.writeText($('peer-output').value); status('Token copied.'); }],
  ]) $(id).addEventListener('click', async () => {
    if (busy) return; busy = true; render(); const target = contact;
    const wait = async promise => { const result = await promise; if (target !== contact) throw new Error('Conversation changed.'); return result; };
    try { await action(wait); } catch (error) { if (target === contact) status(error.message); }
    finally { busy = false; render(); }
  });
  setInterval(() => session.tick(), 3000);
  render();
  return {
    snapshot: () => session.snapshot(),
    send: text => session.send(text),
    select(next) { contact = next; session.reset(next?.id || null); clearTokens(); status(next ? `Connect directly with @${next.username}.` : 'Select a contact first.'); },
  };
}
