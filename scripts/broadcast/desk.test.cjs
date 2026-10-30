const {test}=require('node:test');const assert=require('node:assert/strict');
require('../../apps/forum/public/broadcast/desk.js');const d=globalThis.SymfDesk;
const now=Date.now();
test('stream log is a semantic compact table without reading controls or operational chrome',()=>{
 const fs=require('node:fs'),path=require('node:path');const html=fs.readFileSync(path.join(__dirname,'../../apps/forum/public/broadcast/index.html'),'utf8'),script=fs.readFileSync(path.join(__dirname,'../../apps/forum/public/broadcast/studio.js'),'utf8');
 assert.match(html,/<h2>Agent Activity<\/h2>/);assert.match(html,/<table class="an-log-table">/);assert.match(html,/<th scope="col">Status<\/th>/);
 for(const label of ['Forum Agents','Telegram Agents','X Agents'])assert.ok(html.includes(label));
 assert.doesNotMatch(html,/data-token-asof|drafts only/);
 assert.doesNotMatch(html+script,/data-reader-pause|data-reader-status|data-activity-check|data-activity-platforms|data-activity-coverage|Across the network|No private conversations|Full post · slow scroll/);
 assert.doesNotMatch(script,/\.innerHTML\s*=/);
});
const sample=()=>({policy:d.POLICY,checkedAt:now,telegramAgents:['suki','belle','nyx','lena-corwin','damon-pike'],xConnected:true,events:[{id:'telegram:296:12',agentSlug:'suki',platform:'telegram',action:'community-post',status:'confirmed',at:now-500,topicId:296,messageId:12,url:'https://t.me/symforum/296/12'}]});
test('reading holds at least45s, extends for full text and caps travel at12px/sec',()=>{
 assert.equal(d.duration('short post'),45000);const long=d.duration('word '.repeat(600),2000);assert.ok(long>=208000);assert.equal(d.position(0,long,2000),0);assert.equal(d.position(4000,long,2000),0);assert.equal(d.position(long-4000,long,2000),2000);assert.equal(d.position(long+1000,long,2000),2000);assert.ok(2000/(long/1000-8)<=12);assert.equal(d.clock(125000),'02:05');
});
test('only confirmed exact-topic, exact-community, allowlisted Telegram receipts qualify',()=>{
 assert.equal(d.valid(sample(),now),true);
 for(const patch of [{agentSlug:'unknown'},{platform:'x'},{status:'held'},{topicId:7},{url:'https://evil.example/12'},{at:now+1},{at:now-86400001},{messageId:0},{action:'private-reply'}]){const s=sample();s.events[0]={...s.events[0],...patch};assert.equal(d.valid(s,now),false);}
 const duplicate=sample();duplicate.events.push(duplicate.events[0]);assert.equal(d.valid(duplicate,now),false);
});
test('stale snapshots fail closed and projection drops every unexpected field',()=>{
 const s=sample();s.events[0].prompt='private';s.secret='private';const clean=d.project(s,now);assert.equal(JSON.stringify(clean).includes('private'),false);s.checkedAt=now-16*60000;assert.equal(d.project(s,now),null);
});
test('activity reader performs one anonymous query and rejects oversized or invalid response',async()=>{
 let calls=0;const value=await d.load(async(url,o)=>{calls++;assert.equal(o.credentials,'omit');assert.equal(o.headers.Authorization,undefined);assert.equal(JSON.parse(o.body).path,'broadcastActivity:publicActivity');return{ok:true,text:async()=>JSON.stringify({status:'success',value:sample()})};},now);assert.ok(value);assert.equal(calls,1);
 await assert.rejects(d.load(async()=>({ok:true,text:async()=>'x'.repeat(24001)}),now));
});
