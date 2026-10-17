import * as transport from './p2p.js';
import { createPeerSession } from './p2p-session.js';
export function setupPeerUI() {
  const $ = id => document.getElementById(id);
  let busy = false, contact = null;
  const status = text => { $('peer-status').textContent = text; };
  const session = createPeerSession(transport, render);
  function render() {
    const current = session.snapshot();
    $('peer-state').textContent = `${current.state}${current.peer ? ` · peer ${current.peer}` : ''}`;
    $('peer-send').disabled = busy || current.state !== 'Connected';
    for (const id of ['peer-offer', 'peer-answer', 'peer-finalize']) $(id).disabled = busy || !contact;
    const list = $('peer-log'); list.replaceChildren();
    for (const message of current.messages) {
      const item = document.createElement('p');
      const label = document.createElement('strong'); label.textContent = `${message.mine ? 'You' : contact.display_name} · Informal (P2P E2EE): `;
      item.append(label, document.createTextNode(message.text)); list.append(item);
    }
  }
  function clearTokens() { for (const id of ['peer-output','peer-input']) $(id).value = ''; }
  for (const [id, action] of [
    ['peer-offer', async (wait) => { clearTokens(); $('peer-output').value = await wait(session.offer()); status('Send this offer to your contact. Keep this tab open.'); }],
    ['peer-answer', async (wait) => { const token = $('peer-input').value; $('peer-output').value = ''; $('peer-output').value = await wait(session.answer(token)); $('peer-input').value = ''; status('Send this answer back. Waiting for the other person to finish.'); }],
    ['peer-finalize', async (wait) => { await wait(session.finalize($('peer-input').value)); clearTokens(); status('Handshake applied. Waiting for an encrypted connection check.'); }],
    ['peer-send', async (wait) => { await wait(session.send($('peer-draft').value)); $('peer-draft').value = ''; status('Sent over the encrypted channel. Formal inbox unchanged.'); }],
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
    select(next) { contact = next; session.reset(next?.id || null); clearTokens(); $('peer-draft').value = ''; status(next ? `Connect directly with @${next.username}.` : 'Select a contact first.'); },
  };
}
