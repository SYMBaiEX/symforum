import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getFunctionName } from 'convex/server';
import { start, ACTIVITY_QUERY, ACTIVITY_URL } from './activity-live-source.mjs';
import '../../apps/forum/public/broadcast/desk.js';
const desk=globalThis.SymfDesk;
const now=Date.now();
function snapshot(patch={}) { return {policy:desk.LIVE_POLICY,counts:{forum:35,telegram:5,x:1},events:[{id:'tg:opaque:state',agentSlug:'nyx',agentName:'NyX',platform:'telegram',action:'telegram-request',status:'delivered',at:now,url:null,...patch}]}; }
test('normal addressed Telegram reply is included without message, sender or private link',()=>{
 const raw=snapshot();raw.prompt='PRIVATE';raw.counts.owner='PRIVATE';raw.events[0].senderId='PRIVATE';raw.events[0].body='PRIVATE';
 const safe=desk.projectLive(raw,now);assert.ok(safe);assert.equal(safe.events[0].url,null);assert.equal(safe.events[0].status,'delivered');assert.equal(JSON.stringify(safe).includes('PRIVATE'),false);
});
test('holds and queued work never become confirmed posts or deliveries',()=>{
 for(const status of ['queued','running','held','failed','skipped'])assert.equal(desk.projectLive(snapshot({status}),now).events[0].status,status);
 for(const patch of [{status:'published'},{action:'evidence-review',status:'published'},{platform:'x',action:'x-draft',status:'published'},{action:'evidence-review',status:'delivered'}])assert.equal(desk.projectLive(snapshot(patch),now),null);
});
test('only canonical names, valid phases and exact public proof URLs pass',()=>{
 for(const patch of [{agentSlug:'unknown',agentName:undefined},{agentName:'PRIVATE PERSON'},{url:'https://t.me/symforum/85/123'},{url:'https://evil.example/'},{action:'telegram-community',url:'https://t.me/symforum/13/123'},{at:now+6000},{status:'success'},{id:'unsafe/private'}])assert.equal(desk.projectLive(snapshot(patch),now),null);
 assert.ok(desk.projectLive(snapshot({action:'telegram-community',url:'https://t.me/symforum/296/123'}),now));
 assert.ok(desk.projectLive(snapshot({platform:'forum',action:'forum-reply',status:'published',url:'https://forum.symbaiex.com/projects/public-post#post-abc123'}),now));
 assert.ok(desk.projectLive(snapshot({platform:'x',action:'x-draft',status:'completed'}),now));
 const stale=snapshot({at:now-86400001});assert.equal(desk.projectLive(stale,now).events.length,0);
});
test('official subscription stays anonymous, reconnects without polling and tears down once',async()=>{
 const clients=[];class FakeClient{
  constructor(url,options){assert.equal(url,ACTIVITY_URL);assert.equal(options.logger,false);clients.push(this);this.connected=true;this.unsubs=0;this.closes=0;}
  onUpdate(query,args,onData,onError){assert.equal(getFunctionName(query),ACTIVITY_QUERY);assert.deepEqual(args,{});this.onData=onData;this.onError=onError;return()=>this.unsubs++;}
  subscribeToConnectionState(cb){this.onConnection=cb;return()=>this.unsubs++;}
  connectionState(){return{isWebSocketConnected:this.connected};}
  close(){this.closes++;return Promise.resolve();}
 }
 const doc=new EventTarget();doc.hidden=false;const root=new EventTarget();root.dataset={};const received=[];root.addEventListener('symf:activity-feed',e=>received.push(e.detail));
 const close=start(root,{Client:FakeClient,document:doc,project:desk.projectLive});assert.equal(clients.length,1);clients[0].onData(snapshot());assert.equal(root.dataset.activityConnection,'live');assert.equal(received.length,1);
 clients[0].connected=false;clients[0].onConnection({isWebSocketConnected:false});assert.equal(root.dataset.activityConnection,'reconnecting');clients[0].onError(Error('PRIVATE PROVIDER BODY'));assert.equal(root.dataset.activityConnection,'unavailable');
 doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(clients[0].closes,1);assert.equal(clients[0].unsubs,2);
 doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(clients.length,2);clients[0].onData(snapshot());assert.equal(received.length,1);clients[1].onData(snapshot());assert.equal(received.length,2);
 close();close();assert.equal(clients[1].closes,1);assert.equal(clients[1].unsubs,2);
});
test('footer is one-line metadata with a Telegram logo and no redundant label',async()=>{
 const html=await readFile(new URL('../../apps/forum/public/broadcast/index.html',import.meta.url),'utf8');
 const footer=html.slice(html.indexOf('<footer class="an-station-dock"'));
 assert.doesNotMatch(footer,/Official · Solana|<small>Telegram<\/small>/);assert.match(footer,/an-telegram-logo/);
 assert.match(html,/wss:\/\/strong-bee-384\.convex\.cloud/);
 const code=await readFile(new URL('./activity-live-source.mjs',import.meta.url),'utf8');assert.doesNotMatch(code,/\.mutation\(|\.action\(|\.setAuth\(|setInterval\(|fetch\(/);
});
