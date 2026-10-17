import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageView } from '../extension/message-view.js';
const formal = [{ sender_id:'alice',client_message_id:'one',body_formal:'Please review this.',created_at:'2026-10-17T12:00:00Z' }];
const original = { mine:true,messageId:'one',text:'hey check this!',createdAt:Date.parse('2026-10-17T12:00:01Z') };
test('Formal hides originals; BlackMail replaces the matching record without duplicate bubbles', () => {
  const normal=messageView(formal,[original],'alice','formal');
  assert.equal(normal.length,1);assert.equal(normal[0].text,'Please review this.');assert.equal(normal[0].private,false);
  const blackmail=messageView(formal,[original,{...original}],'alice','blackmail');
  assert.equal(blackmail.length,1);assert.equal(blackmail[0].text,'hey check this!');assert.equal(blackmail[0].private,true);
});
test('BlackMail falls back to formal after refresh; an original arriving before polling is shown once', () => {
  assert.equal(messageView(formal,[],'alice','blackmail')[0].text,'Please review this.');
  assert.equal(messageView([],[original],'alice','formal').length,0);
  assert.equal(messageView([],[original,{...original}],'alice','blackmail').length,1);
});
test('a peer original cannot substitute for a message sent by the local user', () => {
  const rows=messageView(formal,[{...original,mine:false}],'alice','blackmail');
  assert.equal(rows.length,2);assert.equal(rows[0].text,'Please review this.');assert.equal(rows[0].private,false);
});
