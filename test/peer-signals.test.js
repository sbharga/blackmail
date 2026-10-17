import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeerSignals } from '../server/peer-signals.js';
import { createMessaging } from '../server/supabase.js';
import { createReconnect, sealSignal, openSignal, connectionLabel } from '../extension/peer-reconnect.js';

test('signaling packets are encrypted, authenticated and expire without storing informal text', async () => {
  const secret = 'ab'.repeat(32), packet = await sealSignal({ token: 'synthetic-SDP', kind: 'offer' }, secret);
  assert.equal(JSON.stringify(packet).includes('synthetic-SDP'), false);
  assert.equal((await openSignal(packet, secret)).token, 'synthetic-SDP');
  await assert.rejects(openSignal(packet, 'cd'.repeat(32)));
  let clock = 1000; const store = new PeerSignals({ now: () => clock });
  await store.put('a','b',packet); assert.deepEqual(await store.get('a','b'),packet);
  assert.equal(await store.get('b','a'), null); clock += 90001; assert.equal(await store.get('a','b'), null);
});
test('relay derives sender from JWT and rejects unrelated contacts', async () => {
  const owner = '10000000-0000-4000-8000-000000000001', contactId = '10000000-0000-4000-8000-000000000002';
  const calls = [], token = `Bearer ${'a'.repeat(40)}`;
  const app = createMessaging({ url:'https://test.supabase.co',key:'sb_publishable_test_key_123456',
    peerSignals:{ put: async (...args) => calls.push(args),get:async()=>null },
    fetchImpl:async url=>new Response(JSON.stringify(url.includes('/user')?{id:owner}:[{id:contactId}])) });
  const packet={iv:'ab'.repeat(12),ciphertext:'YWJj'};
  assert.equal((await app.handle('/api/messaging/peer-signals/write',null,{contactId,packet})).status,401);
  assert.equal((await app.handle('/api/messaging/peer-signals/write',token,{contactId,packet,senderId:contactId})).status,200);
  assert.deepEqual(calls[0],[owner,contactId,packet]);
  assert.equal((await app.handle('/api/messaging/peer-signals/read',token,{contactId:owner})).status,403);
  assert.equal((await app.handle('/api/messaging/peer-signals/read',token,{contactId:'10000000-0000-4000-8000-000000000003'})).status,403);
  assert.equal((await app.handle('/api/messaging/peer-signals/write',token,{contactId,packet:{...packet,iv:'bad'}})).status,400);
});
const storage = () => { const map=new Map();return { getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key) }; };
test('saved links tolerate small clock skew and pairing completes before the responder pong', async () => {
  let receiveA, receiveB; const sa=storage(),sb=storage();
  const a=createReconnect({snapshot:()=>({state:'Connected'}),onControl:fn=>{receiveA=fn;},control:async value=>receiveB(value)},
    {storage:sa,now:()=>10000,request:async()=>({})});
  const b=createReconnect({snapshot:()=>({state:'Handshaking'}),onControl:fn=>{receiveB=fn;},control:async value=>receiveA(value)},
    {storage:sb,now:()=>9000,request:async()=>({})});
  a.select('a','b');b.select('b','a');await a.ready();
  assert.equal(a.snapshot().remembered,true);assert.equal(b.snapshot().remembered,true);
  const restored=createReconnect({snapshot:()=>({state:'Disconnected'}),onControl:()=>{}},
    {storage:sa,now:()=>9500,request:async()=>({})});
  restored.select('a','b');assert.equal(restored.snapshot().remembered,true);
  assert.match(connectionLabel('Disconnected',restored.snapshot()),/Reconnecting/);
  assert.match(connectionLabel('Disconnected',{remembered:false}),/Not paired/);
});
test('blocked browser storage never claims that a peer link is saved', async () => {
  let receive;
  const reconnect=createReconnect({snapshot:()=>({state:'Connected'}),onControl:fn=>{receive=fn;},control:async value=>receive({kind:'remember-ack',id:value.id})},
    {storage:{getItem:()=>null,setItem:()=>{throw Error('blocked');},removeItem:()=>{}},now:()=>10000,request:async()=>({})});
  reconnect.select('a','b');await reconnect.ready();
  assert.equal(reconnect.snapshot().remembered,false);
  assert.match(connectionLabel('Connected',reconnect.snapshot()),/storage unavailable/);
});
test('seven-day peer credentials restore and automatically exchange fresh offer/answer after refresh', async () => {
  let clock=1000, phase='Connected', controlA, controlB;
  const signals = new Map(), sa=storage(), sb=storage();
  let currentA, currentB;
  const makeSession = side => ({
    snapshot:()=>({state:phase}),
    onControl:fn=>{if(side==='a')controlA=fn;else controlB=fn;},
    control:async value=>{(side==='a'?controlB:controlA)(value);},
    reset:()=>{phase='Disconnected';},
    offer:async()=>{phase='Handshaking';return 'fresh-offer';},
    answer:async offer=>{assert.equal(offer,'fresh-offer');return 'fresh-answer';},
    finalize:async answer=>{assert.equal(answer,'fresh-answer');phase='Connected';},
  });
  const make = (side,store) => createReconnect(makeSession(side), { storage:store,now:()=>clock,
    request:async(route,body)=>{if(route.endsWith('write'))signals.set(side,body.packet);return {packet:signals.get(side==='a'?'b':'a')||null};} });
  currentA=make('a',sa);currentB=make('b',sb);currentA.select('a','b');currentB.select('b','a');
  await currentA.ready();assert.equal(currentA.snapshot().remembered,true);assert.equal(currentB.snapshot().remembered,true);
  phase='Disconnected';currentA=make('a',sa);currentB=make('b',sb);currentA.select('a','b');currentB.select('b','a');
  assert.equal(currentA.snapshot().remembered,true);
  await currentA.tick();await currentB.tick();await currentA.tick();assert.equal(phase,'Connected');
  clock+=7*24*60*60*1000+1;
  const expired=make('a',sa);expired.select('a','b');assert.equal(expired.snapshot().remembered,false);
  currentB.forget();assert.equal(currentB.snapshot().remembered,false);
});
