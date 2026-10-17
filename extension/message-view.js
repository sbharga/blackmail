// Originals remain in memory; correlate them with the durable formal record.
export function messageView(formal, originals, userId, mode = 'formal') {
  const key = (mine, id) => `${mine}:${id}`;
  const privateById = new Map(originals.filter(m => m.messageId).map(m => [key(m.mine, m.messageId), m]));
  const matched = new Set();
  const rows = formal.map(m => {
    const mine = m.sender_id === userId, id = key(mine, m.client_message_id);
    const original = privateById.get(id); if (original) matched.add(id);
    return { text: mode === 'blackmail' && original ? original.text : m.body_formal,
      mine, at: new Date(m.created_at).getTime(), private: mode === 'blackmail' && Boolean(original) };
  });
  if (mode === 'blackmail') {
    const added = new Set();
    for (const m of originals) {
      const id = m.messageId ? key(m.mine, m.messageId) : m;
      if (matched.has(id) || added.has(id)) continue;
      added.add(id); rows.push({ text: m.text, mine: m.mine, at: m.createdAt, private: true });
    }
  }
  return rows.sort((a,b) => a.at - b.at);
}
