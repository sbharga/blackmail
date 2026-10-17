import { api, serverNow, createPass, openPass, probePass, revokePass, addToHistory } from './app.js';
import { createDemo } from './demo-state.js';

const $ = id => document.getElementById(id);
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };

let demo = createDemo(serverNow);
let person = 'Alice';
let current = { kind: 'direct', with: 'Bob' };   // selected conversation
let revealed = false;                            // Formal (false) vs Original (true)
let draftRevision = 0;
let polishPending = false;
const plainCache = new Map();                    // messageId -> { text } | { dead:true } | { loading:true }
const notice = text => { $('demo-status').textContent = text; };
const secondsLeft = at => Math.max(0, Math.ceil((at - serverNow()) / 1000));
const fmtLeft = at => { const s = secondsLeft(at); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const avatarClass = name => `avatar a-${name.toLowerCase()}`;

// ---- conversation model (derived from demo state; identities see different threads) ----
const DIRECTS = { Alice: ['Bob', 'Maya'], Bob: ['Alice'], Maya: ['Alice'] };
function conversationsFor(name) {
  const list = (DIRECTS[name] || []).map(w => ({ kind: 'direct', with: w, title: w }));
  for (const g of demo.groups()) if (g.members.includes(name)) list.push({ kind: 'group', id: g.id, title: g.name, members: g.members });
  return list;
}
const messagesOf = conv => conv.kind === 'group' ? demo.groupThread(conv.id) : demo.thread(person, conv.with);
const sameConv = (a, b) => a && b && a.kind === b.kind && (a.kind === 'group' ? a.id === b.id : a.with === b.with);

// Can the current viewer read the original right now?
const canView = m => m.members.includes(person) && !m.revoked && m.expiresAt > serverNow() && (m.author === person || m.shared);

// ---- render: sidebar ----
function renderSidebar() {
  $('me-avatar').textContent = person[0];
  $('me-avatar').className = avatarClass(person);
  $('me-name').textContent = person;
  const list = $('conversation-list'); list.replaceChildren();
  for (const conv of conversationsFor(person)) {
    const msgs = messagesOf(conv);
    const last = msgs[msgs.length - 1];
    const btn = el('button', `ms-conv${sameConv(conv, current) ? ' active' : ''}`);
    btn.setAttribute('aria-pressed', String(sameConv(conv, current)));
    const av = el('span', conv.kind === 'group' ? 'avatar a-group' : avatarClass(conv.with), conv.kind === 'group' ? '⚡' : conv.with[0]);
    const meta = el('span', 'meta');
    const row1 = el('span', 'row1'); row1.append(el('span', 'cname', conv.title), el('span', 'ctime', last ? fmtLeft(last.expiresAt) : ''));
    const prev = el('span', 'cprev');
    prev.append(el('span', 'lk', '🔒'), el('span', '', last ? last.formal : 'No messages yet'));
    meta.append(row1, prev);
    btn.append(av, meta);
    btn.addEventListener('click', () => { current = conv; revealed = false; $('chat-draft').value = ''; closePreview(); notice(''); render(); });
    list.append(btn);
  }
}

// ---- render: thread header ----
function renderHeader() {
  const conv = current;
  const av = $('peer-avatar'), sub = $('peer-sub');
  if (conv.kind === 'group') {
    av.textContent = '⚡'; av.className = 'avatar a-group';
    $('peer-name').textContent = conv.title;
    sub.textContent = `${conv.members.length} people · ${conv.members.join(', ')}`;
  } else {
    av.textContent = conv.with[0]; av.className = avatarClass(conv.with);
    $('peer-name').textContent = conv.with;
    sub.textContent = 'Companion thread · formal on the record';
  }
  $('draft-label').textContent = `Write as ${person}`;
}

// ---- render: messages ----
function renderLog() {
  const log = $('chat-log');
  const prev = log.scrollTop;
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  log.replaceChildren();
  log.classList.toggle('revealed', revealed);
  const msgs = messagesOf(current);
  if (!msgs.length) { log.append(el('p', 'empty', `Say something to start this thread.`)); return; }
  log.append(el('div', 'daysep', 'TODAY'));
  for (const m of msgs) log.append(renderBubble(m));
  log.scrollTop = nearBottom ? log.scrollHeight : prev;
}

function renderBubble(m) {
  const outgoing = m.author === person;
  const wrap = el('div', `msg ${outgoing ? 'me' : 'them'}`);
  if (!outgoing) wrap.append(el('span', 'sender', m.author));
  const dead = m.revoked || m.expiresAt <= serverNow();
  const bubble = el('div', `bubble${revealed ? ' dual' : ''}${revealed && dead ? ' dead' : ''}`);

  let text = m.formal, showOrig = false;
  if (revealed) {
    if (dead) { text = m.formal; }
    else if (!canView(m)) { text = `🔒 ${m.author} hasn’t shared the original yet — only the formal version is on the record.`; }
    else if (m.vault) {
      const cached = plainCache.get(m.id);
      if (cached?.text !== undefined) { text = cached.text; showOrig = true; }
      else if (cached?.dead) { text = m.formal; }
      else { text = 'Unlocking from the vault…'; if (!cached?.loading) unlock(m); }
    } else { text = m.original ?? m.formal; showOrig = true; }
  }

  if (showOrig) bubble.append(el('span', 'orig-label', '🔓 Original voice'));
  bubble.append(el('div', 'btext', text));

  if (revealed && canView(m) && !dead) {
    if (showOrig) bubble.append(el('span', 'expirychip', `⏱ auto-locks in ${fmtLeft(m.expiresAt)}`));
  } else if (revealed && dead) {
    bubble.append(el('span', 'deadnote', `🔒 original ${m.revoked ? 'revoked' : 'expired'} · only the formal record remains`));
  } else if (!revealed && m.vault) {
    bubble.append(el('span', 'lockchip', '🔒 original sealed to the vault · flip to Original'));
  } else if (!revealed) {
    bubble.append(el('span', 'lockchip', '🔒 formal record · stays after revocation'));
  }

  const stamp = el('div', 'stamp');
  stamp.append(el('span', '', m.vault ? 'sealed to vault' : 'demo sample'));
  if (outgoing && !m.revoked && m.expiresAt > serverNow()) {
    if (!m.shared && current.kind !== 'group') {
      const share = el('button', 'inline-action', 'Share pass');
      share.addEventListener('click', () => { demo.share(m, person); notice('Pass shared. Switch identity (⇄) to read it as them.'); render(); });
      stamp.append(share);
    }
    const rev = el('button', 'inline-action', 'Revoke');
    rev.addEventListener('click', () => revokeMessage(m));
    stamp.append(rev);
  }
  wrap.append(bubble, stamp);
  return wrap;
}

// ---- real vault: unlock one message's original ----
async function unlock(m) {
  plainCache.set(m.id, { loading: true });
  try {
    const opened = await openPass(m.vault.id, m.vault.access, m.vault.secret);
    plainCache.set(m.id, { text: opened.text });
  } catch { plainCache.set(m.id, { dead: true }); }
  if (revealed) renderLog();
}

async function revokeMessage(m) {
  demo.revoke(m, person);
  plainCache.delete(m.id);
  if (m.vault) { try { await revokePass(m.vault.id, m.vault.owner); } catch {} }
  notice('Original revoked. The formal record is unaffected.');
  render();
}

// ---- send: create a real encrypted pass, fall back to simulation if offline ----
async function sendMessage(original, formal) {
  const msg = current.kind === 'group'
    ? demo.sendGroup(person, current.id, original, formal, true)
    : demo.send(person, current.with, original, formal, true);
  try {
    const sealed = await createPass(original);
    msg.vault = { id: sealed.id, access: sealed.access, secret: sealed.secret, owner: sealed.owner };
    msg.expiresAt = sealed.expiresAt;
    addToHistory({ id: sealed.id, owner: sealed.owner, expiresAt: sealed.expiresAt, formal, createdAt: Date.now(), revoked: false });
    notice('Sealed to the live vault. Formal version is on the record; flip to Original to pull it back.');
  } catch {
    notice('Server offline — message kept locally in this simulation. Start the vault to seal for real.');
  }
  render();
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}

// ---- view toggle ----
function setMode() {
  $('decrypt').setAttribute('aria-pressed', String(revealed));
  $('opt-formal').classList.toggle('active', !revealed);
  $('opt-original').classList.toggle('active', revealed);
  $('reveal-banner').classList.toggle('show', revealed);
}
function render() { renderSidebar(); renderHeader(); setMode(); renderLog(); }

function closePreview() { draftRevision++; $('chat-preview').classList.add('hidden'); $('chat-formal').value = ''; }

// ---- events ----
$('decrypt').addEventListener('click', () => { revealed = !revealed; setMode(); renderLog(); });
$('switch-person').addEventListener('click', () => {
  const order = ['Alice', 'Bob', 'Maya'];
  person = order[(order.indexOf(person) + 1) % order.length];
  const convs = conversationsFor(person);
  if (!convs.some(c => sameConv(c, current))) current = convs[0];
  revealed = false; $('chat-draft').value = ''; closePreview();
  notice(`Viewing as ${person}. Simulated identity switch — passes are still real.`);
  render();
});
$('chat-draft').addEventListener('input', () => {
  closePreview();
  const t = $('chat-draft'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 110) + 'px';
});
$('chat-review').addEventListener('click', () => {
  if (!$('chat-draft').value.trim()) { notice('Write a message first.'); return; }
  if ($('chat-preview').classList.contains('hidden')) {
    $('chat-formal').value = $('chat-draft').value;
    $('chat-preview').classList.remove('hidden');
    notice('Review or Polish the formal version. Both versions need your okay.');
  }
  $('chat-formal').focus();
});
$('chat-polish').addEventListener('click', async () => {
  if (polishPending) return;
  const text = $('chat-draft').value;
  if (!text.trim()) { notice('Write a message first.'); return; }
  const revision = ++draftRevision;
  polishPending = true; $('chat-polish').disabled = true; notice('Polishing with Nebius…');
  try {
    const result = await api('/api/rewrite', { text });
    if (revision !== draftRevision) { notice('Draft changed. Polish again when ready.'); return; }
    $('chat-formal').value = result.text; $('chat-preview').classList.remove('hidden');
    notice('Review both versions, then seal & send.');
  } catch (error) { notice(error.message); }
  finally { polishPending = false; $('chat-polish').disabled = false; }
});
$('chat-send').addEventListener('click', async () => {
  const original = $('chat-draft').value, formal = $('chat-formal').value;
  if (!original.trim() || !formal.trim()) { notice('Both versions need text.'); return; }
  $('chat-send').disabled = true;
  try { await sendMessage(original, formal); $('chat-draft').value = ''; $('chat-draft').style.height = 'auto'; closePreview(); }
  finally { $('chat-send').disabled = false; }
});
$('chat-cancel').addEventListener('click', () => { closePreview(); notice('Preview closed. Draft kept.'); });
$('demo-reset').addEventListener('click', () => {
  demo = createDemo(serverNow); person = 'Alice'; current = { kind: 'direct', with: 'Bob' }; revealed = false;
  plainCache.clear(); $('chat-draft').value = ''; closePreview();
  notice('Demo reset. Real vault messages you created stay under Your passes until they expire.');
  render();
});

// ---- live tick: countdowns, auto-lock on expiry, liveness probe for revealed vault messages ----
let probing = false;
setInterval(async () => {
  if ($('demo').classList.contains('hidden')) return;
  renderLog();
  if (!revealed || probing) return;
  probing = true;
  try {
    for (const m of messagesOf(current)) {
      if (m.vault && canView(m) && plainCache.get(m.id)?.text !== undefined) {
        try { await probePass(m.vault.id, m.vault.access); }
        catch { plainCache.set(m.id, { dead: true }); demo.revoke(m, m.author); }
      }
    }
  } finally { probing = false; }
}, 1500);

render();
