import { api } from './app.js';
import { createDemo } from './demo-state.js';

const $ = id => document.getElementById(id);
const serverNow = Date.now; // Simulated passes use this device's clock only.
let demo = createDemo(serverNow);
let person = 'Alice';
let contact = 'Bob';
let view = 'normal';
let draftRevision = 0;
let polishPending = false;
const notice = text => { $('demo-status').textContent = text; };
const el = (tag, className, text) => {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text; return node;
};
function invalidatePreview() {
  draftRevision++;
  $('chat-preview').classList.add('hidden');
  $('chat-formal').value = '';
}
function render() {
  $('my-name').textContent = person;
  $('my-avatar').textContent = person[0];
  $('my-avatar').className = `avatar ${person.toLowerCase()}`;
  $('switch-person').textContent = `Switch to ${person === 'Alice' ? 'Bob' : 'Alice'} ↔`;
  $('draft-label').textContent = `Write as ${person}`;
  $('their-name').textContent = contact;
  $('their-avatar').textContent = contact[0];
  $('their-avatar').className = `avatar ${contact.toLowerCase()}`;
  const contacts = $('contact-list'); contacts.replaceChildren();
  for (const name of person === 'Alice' ? ['Bob', 'Maya'] : ['Alice', 'Maya']) {
    const button = el('button', `contact ${name === contact ? 'selected' : ''}`);
    button.setAttribute('aria-label', `Chat with ${name}`);
    button.setAttribute('aria-pressed', String(name === contact));
    const details = el('span', 'contact-details'); details.append(el('strong', '', name), el('small', '', name === 'Maya' ? 'Design teammate' : 'Hackathon teammate'));
    button.append(el('span', `avatar ${name.toLowerCase()}`, name[0]), details);
    button.addEventListener('click', () => {
      contact = name; $('chat-draft').value = ''; invalidatePreview(); notice(''); render();
    });
    contacts.append(button);
  }
  $('view-normal').setAttribute('aria-pressed', String(view === 'normal'));
  $('view-blackmail').setAttribute('aria-pressed', String(view === 'blackmail'));
  $('channel-note').textContent = view === 'normal'
    ? 'NORMAL · The formal record your usual app would receive.'
    : 'BLACKMAIL · Originals appear while a shared demo pass is valid.';
  $('chat-messages').classList.toggle('private-view', view === 'blackmail');
  renderMessages();
}
function renderMessages() {
  const list = $('chat-messages'); const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.replaceChildren();
  const messages = demo.thread(person, contact);
  if (!messages.length) list.append(el('p', 'empty-thread', `Start a conversation with ${contact}.`));
  for (const message of messages) {
    const outgoing = message.author === person;
    const row = el('article', `message-row ${outgoing ? 'outgoing' : 'incoming'}`);
    const bubble = el('div', 'message-bubble');
    const label = el('div', 'message-author', `${message.author}${outgoing ? ' · you' : ''}`);
    const original = demo.originalFor(message, person);
    const text = view === 'normal' ? message.formal : original;
    const expired = message.expiresAt <= serverNow();
    bubble.append(label, el('p', text === null ? 'locked-text' : '', text ?? (message.revoked ? 'Original revoked. The formal message is still in Normal view.' : expired ? 'Pass expired. The formal message is still in Normal view.' : `Original locked. ${message.author} hasn’t shared a demo pass yet.`)));
    const meta = el('div', 'message-meta');
    if (view === 'blackmail' && original !== null) {
      const countdown = el('span', 'demo-countdown'); countdown.dataset.expires = message.expiresAt;
      countdown.textContent = `${Math.max(0, Math.ceil((message.expiresAt - serverNow()) / 1000))}s · ${outgoing && !message.shared ? 'only you' : 'pass shared'}`;
      meta.append(countdown);
    } else if (view === 'normal') meta.append(el('span', '', 'Formal record · stays after revocation'));
    if (outgoing && !message.revoked && !expired) {
      if (!message.shared) {
        const share = el('button', 'message-action', `Share pass with ${message.recipient}`);
        share.addEventListener('click', () => { demo.share(message, person); notice(`Demo pass shared with ${message.recipient}. Switch perspective to see their view.`); renderMessages(); });
        meta.append(share);
      }
      const revoke = el('button', 'message-action', 'Revoke original');
      revoke.addEventListener('click', () => { demo.revoke(message, person); notice('Original revoked in this simulation. Formal record remains.'); renderMessages(); });
      meta.append(revoke);
    }
    bubble.append(meta); row.append(bubble); list.append(row);
  }
  if (nearBottom) list.scrollTop = list.scrollHeight;
}
$('switch-person').addEventListener('click', () => {
  const previous = person; person = person === 'Alice' ? 'Bob' : 'Alice'; contact = previous;
  $('chat-draft').value = ''; invalidatePreview(); notice(`Viewing as ${person}. This is a simulated identity switch.`); render();
});
for (const channel of ['normal', 'blackmail']) $('view-' + channel).addEventListener('click', () => { view = channel; render(); });
$('chat-draft').addEventListener('input', invalidatePreview);
$('chat-review').addEventListener('click', () => {
  if (!$('chat-draft').value.trim()) { notice('Write a message first.'); return; }
  if ($('chat-preview').classList.contains('hidden')) {
    $('chat-formal').value = $('chat-draft').value;
    $('chat-preview').classList.remove('hidden');
    notice('Edit the formal version below, or use Polish with AI. Both versions need your review.');
  }
  $('chat-formal').focus();
});
$('chat-polish').addEventListener('click', async () => {
  if (polishPending) return;
  const text = $('chat-draft').value;
  if (!text.trim()) { notice('Write a message first.'); return; }
  const revision = draftRevision;
  polishPending = true; $('chat-polish').disabled = true; notice('Polishing with Nebius…');
  try {
    const result = await api('/api/rewrite', { text });
    if (revision !== draftRevision) { notice('Conversation or draft changed. Polish again when ready.'); return; }
    $('chat-formal').value = result.text; $('chat-preview').classList.remove('hidden');
    notice('Review both versions, then send the demo message.');
  } catch (error) { notice(error.message); }
  finally { polishPending = false; $('chat-polish').disabled = false; }
});
$('chat-send').addEventListener('click', () => {
  const original = $('chat-draft').value; const formal = $('chat-formal').value;
  if (!original.trim() || !formal.trim()) { notice('Both versions need text.'); return; }
  demo.send(person, contact, original, formal);
  $('chat-draft').value = ''; invalidatePreview(); renderMessages();
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  notice('Demo message added. Share its pass so the recipient can see the original.');
});
$('chat-cancel').addEventListener('click', () => { invalidatePreview(); notice('Preview closed. Draft kept.'); });
$('demo-reset').addEventListener('click', () => {
  demo = createDemo(serverNow); person = 'Alice'; contact = 'Bob'; view = 'normal';
  $('chat-draft').value = ''; invalidatePreview(); notice('Demo reset. Real vault messages are unaffected.'); render();
});
let lastExpired = '';
setInterval(() => {
  if ($('demo').classList.contains('hidden')) return;
  const messages = demo.thread(person, contact);
  const expired = messages.filter(m => m.expiresAt <= serverNow()).map(m => m.id).join(',');
  if (expired !== lastExpired) { lastExpired = expired; renderMessages(); }
  for (const node of $('chat-messages').querySelectorAll('.demo-countdown')) {
    node.textContent = node.textContent.replace(/^\d+s/, `${Math.max(0, Math.ceil((Number(node.dataset.expires) - serverNow()) / 1000))}s`);
  }
}, 1000);
render();
