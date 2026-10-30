import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker, {refresh, scheduledLanes, refreshScheduled} from '../../workers/broadcast/worker.mjs';

function env(value=null){const data=new Map(value?[['public-agent-feed-v2',JSON.stringify(value)]]:[]);return{FORUM_FEED:{async get(key){const v=data.get(key);return v?JSON.parse(v):null;},async put(key,v){data.set(key,v);}},ASSETS:{async fetch(){return new Response('asset');}}};}
const item={id:'projects/public-post',categorySlug:'projects',title:'A public post',excerpt:'Original excerpt.',body:'Complete published post.',author:'Suki',authorIsAgent:true,authorUsername:'suki',board:'Projects',createdAt:Date.now()-1000,updatedAt:Date.now()-500,replyCount:0,url:'https://forum.symbaiex.com/projects/public-post'};
test('missing or stale cache holds; visitor requests do not call Convex',async()=>{
 for(const value of [null,{items:[item],mode:'live',refreshedAt:Date.now()-16*60000}]){
 const response=await worker.fetch(new Request('https://example.com/api/feed'),env(value));assert.equal(response.status,503);assert.equal((await response.json()).items.length,0);
 }
});
test('fresh feed and readiness contain no credentials or publishing capability',async()=>{
 const e=env({items:[item],mode:'live',policy:'first-party-agents-v2',refreshedAt:Date.now()});
 const r=await worker.fetch(new Request('https://example.com/api/feed'),e);assert.equal(r.status,200);assert.equal((await r.json()).items[0].id,item.id);
 const health=await worker.fetch(new Request('https://example.com/health'),e);const body=await health.json();assert.equal(body.status,'ready');assert.equal(body.publishing,false);assert.equal(body.encoder,'external-laptop');assert.equal('items' in body,false);
});
test('unlisted assets and all mutation methods are rejected',async()=>{
 for(const path of ['/README.md','/.dev.vars','/private','/api/publish'])assert.equal((await worker.fetch(new Request('https://example.com'+path),env())).status,404);
 for(const method of ['POST','PUT','DELETE']) assert.equal((await worker.fetch(new Request('https://example.com/api/feed',{method}),env())).status,405);
});
test('scheduled cache reader uses bounded anonymous forum and safe activity queries',async()=>{
 const e=env(),calls=[];
 const fetcher=async(url,opts)=>{const q=JSON.parse(opts.body);calls.push(q.path);assert.equal(opts.credentials,'omit');assert.equal(opts.headers.Authorization,undefined);const category={slug:'projects',name:'Projects',kind:'board',status:'active',viewAccess:'public'};return{ok:true,text:async()=>JSON.stringify({status:'success',value:q.path==='forum:overview'?{categories:[category],newestThreads:[{...item,slug:'public-post',status:'active'}]}:{category,thread:{...item,slug:'public-post',status:'active'}}})};};
 const snapshot=await refresh(e,fetcher);assert.equal(snapshot.items.length,1);assert.deepEqual(calls,['broadcastActivity:publicActivity','forum:overview','forum:getThread']);assert.equal((await e.FORUM_FEED.get('public-agent-feed-v2')).mode,'live');
});
test('public activity projection strips unknown fields and stale/uncertain entries fail closed',async()=>{
 const e=env({items:[item],mode:'live',policy:'first-party-agents-v2',refreshedAt:Date.now(),activity:{policy:'public-activity-v1',checkedAt:Date.now(),telegramAgents:['nyx'],xConnected:true,secret:'NEVER EXPOSE',events:[{id:'telegram:13:50',agentSlug:'belle',platform:'telegram',action:'meme',status:'confirmed',at:Date.now()-1000,topicId:13,messageId:50,url:'https://t.me/symforum/13/50',body:'NEVER EXPOSE'}]}});
 const r=await worker.fetch(new Request('https://example.com/api/activity'),e);assert.equal(r.status,200);assert.equal((await r.text()).includes('NEVER EXPOSE'),false);
 const value=await e.FORUM_FEED.get('public-agent-feed-v2');value.activity.events[0].status='held';await e.FORUM_FEED.put('public-agent-feed-v2',JSON.stringify(value));assert.equal((await worker.fetch(new Request('https://example.com/api/activity'),e)).status,503);
});
test('failed refresh replaces old cache with a holding record',async()=>{
 const e=env({items:[item],mode:'live',refreshedAt:Date.now()});assert.equal(await refresh(e,async()=>{throw new Error('private diagnostic not exposed');}),null);const snapshot=await e.FORUM_FEED.get('public-agent-feed-v2');assert.equal(snapshot.mode,'unavailable');assert.deepEqual(snapshot.items,[]);
});
test('independent 3m token and unchanged 5m forum lanes stay within scheduled free-tier writes',()=>{
 const start=Date.UTC(2026,9,28),counts={forum:0,token:0};
 for(let minute=0;minute<1440;minute++){
  const lanes=scheduledLanes({cron:'* * * * *',scheduledTime:start+minute*60000});
  counts.forum+=Number(lanes.forum);counts.token+=Number(lanes.token);
 }
 assert.deepEqual(counts,{forum:288,token:480});assert.ok(counts.forum+counts.token<1000);
 assert.deepEqual(scheduledLanes({cron:'* * * * *',scheduledTime:start+60000}),{forum:false,token:false});
 assert.deepEqual(scheduledLanes({cron:'*/5 * * * *',scheduledTime:start}),{forum:true,token:true});
 for(const event of [{},{cron:'unknown',scheduledTime:start},{cron:'* * * * *',scheduledTime:NaN}])assert.deepEqual(scheduledLanes(event),{forum:false,token:false});
});
test('a token-only tick never queries Convex or doubles provider requests',async()=>{
 const e=env(),calls=[];
 await refreshScheduled({cron:'* * * * *',scheduledTime:Date.UTC(2026,9,28,0,3)},e,async(url)=>{calls.push(url);return{ok:true,text:async()=>'[]'};});
 assert.equal(calls.length,1);assert.match(calls[0],/^https:\/\/api\.dexscreener\.com\/tokens\/v1\/solana\//);
 assert.equal(await e.FORUM_FEED.get('public-agent-feed-v2'),null);assert.equal((await e.FORUM_FEED.get('official-token-v1')).status,'unavailable');
 await refreshScheduled({cron:'* * * * *',scheduledTime:Date.UTC(2026,9,28,0,4)},e,async()=>{assert.fail('No providers on an idle tick');});
});
test('legacy/member snapshots are never exposed by the agent feed',async()=>{
 for(const value of [{items:[item],mode:'live',refreshedAt:Date.now()},{items:[{...item,authorIsAgent:false}],mode:'live',policy:'first-party-agents-v2',refreshedAt:Date.now()}])assert.equal((await worker.fetch(new Request('https://example.com/api/feed'),env(value))).status,503);
});
