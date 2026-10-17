// In-memory simulation only. Real encrypted passes live in the Compose workspace.
const pair = (a, b) => [a, b].sort().join(':');
export function createDemo(now = Date.now) {
  let sequence = 0;
  const threads = new Map();
  const thread = (a, b) => {
    const key = pair(a, b);
    if (!threads.has(key)) threads.set(key, []);
    return threads.get(key);
  };
  const send = (author, recipient, original, formal, shared = false) => {
    const message = { id: ++sequence, author, recipient, original, formal, shared, expiresAt: now() + 300000, revoked: false };
    thread(author, recipient).push(message);
    return message;
  };
  send('Alice', 'Bob', 'bob this deadline is eating me alive 😭 can we push the demo to friday?', 'Could we move the demo deadline to Friday? I need a little more time to prepare.', true);
  send('Bob', 'Alice', 'yeah totally, friday works! send me what you have and we’ll figure it out', 'Friday works for me. Please send your current progress so we can review the remaining work together.', true);
  send('Alice', 'Maya', 'hey maya your slides look so good!! wanna run through them after lunch?', 'Your slides look great, Maya. Would you like to rehearse the presentation after lunch?', true);
  return {
    thread, send,
    originalFor(message, viewer) {
      if (viewer !== message.author && viewer !== message.recipient) return null;
      if (message.revoked || message.expiresAt <= now()) return null;
      return message.author === viewer || message.shared ? message.original : null;
    },
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
