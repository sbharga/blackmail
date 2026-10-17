// In-memory simulation of conversation structure (who is in a thread, which message is
// shared/revoked/expired). The actual encryption and storage are real: the chat UI attaches a
// live vault pass to each message it sends. This module stays synchronous so it is easy to test.
const pair = (a, b) => [a, b].sort().join(':');
export function createDemo(now = Date.now) {
  let sequence = 0;
  const threads = new Map();
  const groups = new Map();
  const thread = (a, b) => {
    const key = pair(a, b);
    if (!threads.has(key)) threads.set(key, []);
    return threads.get(key);
  };
  const send = (author, recipient, original, formal, shared = false) => {
    const message = { id: ++sequence, kind: 'direct', author, recipient, members: [author, recipient], original, formal, shared, expiresAt: now() + 300000, revoked: false };
    thread(author, recipient).push(message);
    return message;
  };
  const defineGroup = (id, name, members) => { groups.set(id, { id, name, members: [...members] }); threads.set(`group:${id}`, []); return groups.get(id); };
  const groupThread = id => threads.get(`group:${id}`) || threads.set(`group:${id}`, []).get(`group:${id}`);
  const sendGroup = (author, groupId, original, formal, shared = false) => {
    const group = groups.get(groupId);
    const members = group ? group.members : [author];
    const message = { id: ++sequence, kind: 'group', author, groupId, recipient: group ? group.name : groupId, members: [...members], original, formal, shared, expiresAt: now() + 300000, revoked: false };
    groupThread(groupId).push(message);
    return message;
  };
  // Can this viewer see the original behind a message right now?
  const visibleTo = (message, viewer) => {
    if (!message.members.includes(viewer)) return null;
    if (message.revoked || message.expiresAt <= now()) return null;
    return message.author === viewer || message.shared ? message.original : null;
  };

  // --- Seeded conversations (for visual context in the demo) ---
  send('Alice', 'Bob', 'bob this deadline is eating me alive 😭 can we push the demo to friday?', 'Could we move the demo deadline to Friday? I need a little more time to prepare.', true);
  send('Bob', 'Alice', 'yeah totally, friday works! send me what you have and we’ll figure it out', 'Friday works for me. Please send your current progress so we can review the remaining work together.', true);
  send('Alice', 'Maya', 'hey maya your slides look so good!! wanna run through them after lunch?', 'Your slides look great, Maya. Would you like to rehearse the presentation after lunch?', true);
  defineGroup('launch', 'Launch Week ⚡', ['Alice', 'Bob', 'Maya']);
  sendGroup('Alice', 'launch', 'ok team we are SO close, i can taste the demo 🏆 standup in 5?', 'We’re almost there, team. Shall we do a quick standup in five minutes?', true);
  sendGroup('Bob', 'launch', 'omw!! also the build is finally green, no more 2am crashes 🙏', 'On my way. Good news — the build is passing now, so the late-night failures are resolved.', true);
  sendGroup('Maya', 'launch', 'yesss 🎉 i reworked the logo slide, lmk if the new colors slap', 'The logo slide has been reworked with a new color direction — feedback welcome.', false);

  return {
    thread, send, defineGroup, groupThread, sendGroup,
    groups: () => [...groups.values()],
    originalFor(message, viewer) {
      // Preserved direct-message behavior (author or named recipient only).
      if (viewer !== message.author && viewer !== message.recipient) return null;
      if (message.revoked || message.expiresAt <= now()) return null;
      return message.author === viewer || message.shared ? message.original : null;
    },
    originalForMember: visibleTo,
    share(message, actor) {
      if (actor !== message.author || message.revoked || message.expiresAt <= now()) return false;
      message.shared = true; return true;
    },
    revoke(message, actor) {
      if (actor !== message.author) return false;
      message.revoked = true; message.original = null; message.shared = false;
      return true;
    }
  };
}
