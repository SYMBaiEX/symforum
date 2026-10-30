const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = {module:{exports:{}},setTimeout,clearTimeout,AbortController,Date,Map,Set,URL};
vm.runInNewContext(fs.readFileSync('apps/forum/public/broadcast/feed.js','utf8'),context);
const api=context.SymfForumFeed;
const now=1793144000000;
const board={slug:'projects',status:'active',viewAccess:'public',kind:'board',name:'Projects'};
const thread={categorySlug:'projects',slug:'public-discussion',status:'active',createdAt:now-1000,title:'A public discussion',author:'Suki',replyCount:2};
const overview=(threads=[thread],categories=[board])=>({categories,newestThreads:threads});
const detail={category:board,thread:{...thread,body:'An attributed complete agent post.',updatedAt:now-500,authorIsAgent:true,authorUsername:'suki'}};
test('only active public boards and threads are eligible',()=>{
 assert.equal(api.candidates(overview(),now).length,1);
 for(const status of ['pending','deleted','locked']) assert.equal(api.candidates(overview([{...thread,status}]),now).length,0);
 for(const viewAccess of ['staff','members','private']) assert.equal(api.candidates(overview([thread],[{...board,viewAccess}]),now).length,0);
 assert.equal(api.candidates(overview([thread],[{...board,status:'deleted'}]),now).length,0);
});
test('reject future/stale posts and malformed slugs; deduplicate',()=>{
 for(const createdAt of [NaN,now+1,now-8*86400000]) assert.equal(api.candidates(overview([{...thread,createdAt}]),now).length,0);
 for(const slug of ['../../private','https://evil.example','<script>','bad?secret=x']) assert.equal(api.candidates(overview([{...thread,slug}]),now).length,0);
 assert.equal(api.candidates(overview([thread,thread]),now).length,1);
});
test('six-item bound and board diversity',()=>{
 const many=Array.from({length:30},(_,i)=>({...thread,slug:'post-'+i}));
 const alternate={...board,slug:'research',name:'Research'};
 many.push({...thread,slug:'research-post',categorySlug:'research',createdAt:now-2000});
 const selected=api.candidates(overview(many,[board,alternate]),now);
 assert.equal(selected.length,6); assert.equal(selected[1].categorySlug,'research');
});
test('detail recheck binds public category, first-party agent identity and complete root text',()=>{
 const t=api.candidates(overview(),now)[0];
 const item=api.normalize(t,detail,now);
 assert.equal(item.url,'https://forum.symbaiex.com/projects/public-discussion');
 assert.equal(item.author,'Suki');assert.equal(item.replyCount,2);
 for(const altered of [{slug:'other'},{categorySlug:'private'},{title:'Changed'},{createdAt:0},{updatedAt:now+1},{body:''},{authorIsAgent:false},{authorIsAgent:undefined},{authorUsername:'member'},{authorUsername:'Suki-copy'},{status:'deleted'}]) assert.equal(api.normalize(t,{...detail,thread:{...detail.thread,...altered}},now),null);
 for(const viewAccess of ['members','staff'])assert.equal(api.normalize(t,{...detail,category:{...board,viewAccess}},now),null);
 assert.equal(item.body,detail.thread.body);assert.equal('email' in item,false);
 assert.equal(api.candidates(overview([{...thread,author:'ordinary-member'}]),now).length,0);
});
test('anonymous reader calls only overview and root-only getThread, bounded to seven reads',async()=>{
 const calls=[];
 const fetcher=async(url,opts)=>{calls.push({url,opts});const {path,args}=JSON.parse(opts.body);if(path==='forum:getThread')assert.equal(args.pageSize,1);return{ok:true,text:async()=>JSON.stringify({status:'success',value:path==='forum:overview'?overview():detail})};};
 const result=await api.load(fetcher,now);assert.equal(result.items.length,1);assert.equal(calls.length,2);
 for(const call of calls){assert.equal(call.opts.credentials,'omit');assert.equal(call.opts.headers.Authorization,undefined);assert.equal(call.url,'https://strong-bee-384.convex.cloud/api/query');assert.ok(['forum:overview','forum:getThread'].includes(JSON.parse(call.opts.body).path));}
 assert.equal(api.INTERVAL,300000);
});
test('HTTP failures, empty feeds and oversized responses fail closed without retry',async()=>{
 let calls=0;
 await assert.rejects(()=>api.load(async()=>{calls++;return{ok:false};},now));assert.equal(calls,1);
 await assert.rejects(()=>api.load(async()=>({ok:true,text:async()=>JSON.stringify({status:'success',value:overview([])})}),now));
 await assert.rejects(()=>api.load(async()=>({ok:true,text:async()=>'x'.repeat(1000001)}),now));
});
test('hosted snapshots reject stale timestamps, unsafe links and duplicates',()=>{
 const item=api.normalize(api.candidates(overview(),now)[0],detail,now);
 const snapshot={items:[item],mode:'live',refreshedAt:now,policy:api.POLICY};
 assert.equal(api.validSnapshot(snapshot,now),true);
 for(const altered of [{policy:undefined},{policy:'public-v1'},{refreshedAt:now-16*60000},{refreshedAt:now+60000},{mode:'snapshot'},{items:[]},{items:[item,item]},{items:[{...item,url:'javascript:alert(1)'}]},{items:[{...item,categorySlug:'private'}]},{items:[{...item,authorIsAgent:false}]},{items:[{...item,authorUsername:'member'}]}]) assert.equal(api.validSnapshot({...snapshot,...altered},now),false);
});
test('reading edition removes embed markup and pages all readable words in order',()=>{
 const body='[b]A heading[/b]\n\n'+('Verified prose and analysis. '.repeat(70))+'\n[url=https://example.com/source]Original report[/url]\n[sourcecards=Related]\nRelated post|https://forum.symbaiex.com/projects/example|Other\n[/sourcecards]';
 const pages=api.pages(body);assert.ok(pages.length>2);assert.ok(pages.every(p=>p.length<=390));
 assert.equal(pages.join(' '),api.readingText(body).replace(/\s+/g,' '));
 assert.ok(pages.join(' ').includes('Original report (example.com)'));assert.ok(!pages.join(' ').includes('[sourcecards'));
});
