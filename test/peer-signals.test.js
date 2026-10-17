import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeerSignals } from '../server/peer-signals.js';
import { createMessaging } from '../server/supabase.js';
import { createReconnect, sealSignal, openSignal, connectionLabel } from '../extension/peer-reconnect.js';
import { DEMO_PAIR_IDS } from '../extension/demo-peers.js';

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
test('Bob/Diana share one private demo link, scoped to exact IDs and expiring after seven days', async () => {
  let clock=1000;const store=new PeerSignals({now:()=>clock});const [bob,diana]=DEMO_PAIR_IDS;
  const first=await store.demoLink(bob,diana),other=await store.demoLink(diana,bob);
  assert.deepEqual(first,other);assert.match(first.secret,/^[a-f0-9]{64}$/);
  await assert.rejects(store.demoLink('alice',bob),/limited/);
  clock+=7*24*60*60*1000+1;assert.notEqual((await store.demoLink(bob,diana)).id,first.id);
});
test('demo credential endpoint verifies JWT identity and does not grant other accounts access', async () => {
  const [bob,diana]=DEMO_PAIR_IDS;let user=bob,calls=0;
  const app=createMessaging({url:'https://test.supabase.co',key:'sb_publishable_test_key_123456',peerSignals:{demoLink:async(a,b)=>{calls++;assert.equal(a,bob);assert.equal(b,diana);return {id:'private-demo-link'};}},fetchImpl:async url=>new Response(JSON.stringify(url.includes('/user')?{id:user}:[{id:diana}]))});
  const path='/api/messaging/peer-signals/demo-link',token=`Bearer ${'a'.repeat(40)}`;
  assert.equal((await app.handle(path,null,{contactId:diana})).status,401);
  assert.equal((await app.handle(path,token,{contactId:diana,senderId:'spoof'})).status,200);
  user='10000000-0000-4000-8000-000000000001';
  assert.equal((await app.handle(path,token,{contactId:diana})).status,403);assert.equal(calls,1);
});
test('empty-browser Bob/Diana demo reconnects automatically without manual tokens', async () => {
  const [bob,diana]=DEMO_PAIR_IDS;let phase='Disconnected';const store=new PeerSignals({now:()=>1000});
  const make=owner=>createReconnect({snapshot:()=>({state:phase}),onControl:()=>{},control:async()=>{},reset:()=>{phase='Disconnected';},offer:async()=>{phase='Handshaking';return 'auto-offer';},answer:async token=>{assert.equal(token,'auto-offer');return 'auto-answer';},finalize:async token=>{assert.equal(token,'auto-answer');phase='Connected';}},
    {storage:storage(),now:()=>1000,request:async(route,body)=>{
      if(route.endsWith('demo-link'))return {link:await store.demoLink(owner,body.contactId)};
      if(route.endsWith('write')){await store.put(owner,body.contactId,body.packet);return {ok:true};}
      return {packet:await store.get(body.contactId,owner)};
    }});
  const a=make(diana),b=make(bob);a.select(diana,bob);b.select(bob,diana);
  await a.tick();await b.tick();await a.tick();
  assert.equal(phase,'Connected');assert.equal(a.snapshot().remembered,true);assert.equal(b.snapshot().remembered,true);
});
test('another tab wake request does not tear down a healthy peer connection', async () => {
  const store=storage(),secret='ab'.repeat(32);let offers=0;
  store.setItem('blackmail.peer-link:a:b',JSON.stringify({id:'known',secret,expiresAt:1000+7*24*60*60*1000,confirmed:true}));
  const packet=await sealSignal({kind:'wake',id:'another-tab',pairId:'known',at:1000},secret);
  const reconnect=createReconnect({snapshot:()=>({state:'Connected'}),onControl:()=>{},control:async()=>{},offer:async()=>{offers++;return 'unwanted';}},
    {storage:store,now:()=>1000,request:async()=>({packet})});
  reconnect.select('a','b');await reconnect.tick();assert.equal(offers,0);
});
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
