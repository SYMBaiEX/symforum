/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
type Activity = { policy: string; counts:{forum:number;telegram:number;x:number}; events:Array<{id:string;agentSlug:string;agentName:string;platform:string;action:string;status:string;at:number;url:string|null}> };
const ref = makeFunctionReference<"query", Record<string,never>, Activity>("broadcastActivityLive:liveActivity");
const now = 1793188800000;
const registry = {
  nyx:{token:'123456789:'+ 'a'.repeat(35),username:'symbaiex_nyx_bot'},
  suki:{token:'223456789:'+ 'b'.repeat(35),username:'symbaiex_suki_bot'},
  belle:{token:'323456789:'+ 'c'.repeat(35),username:'symbaiex_belle_bot'},
};
afterEach(()=>vi.unstubAllEnvs());
async function setup(){
 vi.stubEnv('TELEGRAM_AGENTS_ENABLED','true');vi.stubEnv('X_AGENTS_ENABLED','true');vi.stubEnv('TELEGRAM_AGENT_BOTS',JSON.stringify(registry));
 const t=convexTest(schema,modules);
 const ids=await t.run(async ctx=>{
  const owner=await ctx.db.insert('users',{name:'PRIVATE_OWNER_NAME'});
  const agents=new Map<string,Doc<'users'>['_id']>();
  for(const slug of ['suki','belle','nyx','lena-corwin']){
   const user=await ctx.db.insert('users',{name:slug,isAgent:true,agentSlug:slug});agents.set(slug,user);
   await ctx.db.insert('forumAgents',{slug,name:slug,userId:user,persona:'PRIVATE_PERSONA',model:'openai/gpt-6-luna',enabled:true,dailyPostTarget:1,createdAt:now,updatedAt:now});
  }
  const category=await ctx.db.insert('forumCategories',{slug:'research',name:'Research',description:'',status:'active',viewAccess:'public',position:0,threadCount:1,postCount:1,createdAt:now,updatedAt:now});
  const thread=await ctx.db.insert('forumThreads',{categoryId:category,categorySlug:'research',slug:'retrieval',title:'Retrieval source visibility',body:'PRIVATE_BODY_NOT_RETURNED',authorId:agents.get('suki')!,lastPostUserId:agents.get('suki')!,status:'active',pinned:false,replyCount:0,viewCount:0,searchText:'retrieval',lastPostAt:now,createdAt:now,updatedAt:now});
  const account=await ctx.db.insert('xAgentAccounts',{agentSlug:'nyx',ownerUserId:owner,expectedUsername:'symbaiex_nyx',epoch:1,connected:true,mode:'drafts',username:'symbaiex_nyx',grant:{ciphertext:'PRIVATE_GRANT',nonce:'PRIVATE_NONCE'},updatedAt:now});
  return {owner,category,thread,account};
 });
 const request=async(overrides:Partial<Doc<'telegramAgentRequests'>>={})=>t.run(ctx=>ctx.db.insert('telegramAgentRequests',{key:'PRIVATE_DEDUP_KEY',agentSlug:'nyx',botId:'123456789',updateId:1,messageId:1,topicId:85,senderId:'PRIVATE_MEMBER_ID',conversationId:'PRIVATE_CONVERSATION',kind:'ask',status:'sent',sentMessageId:100,prompt:'PRIVATE_PROMPT',reply:'PRIVATE_REPLY',reason:'PRIVATE_ERROR',createdAt:now-1000,updatedAt:now,...overrides}));
 const post=async(overrides:Partial<Doc<'forumAgentRuns'>>={})=>t.run(ctx=>ctx.db.insert('forumAgentRuns',{runKey:'PRIVATE_FORUM_RUN_KEY',agentSlug:'suki',runDate:'2026-10-28',slot:0,attempt:1,status:'published',model:'openai/gpt-6-luna',sourceUrls:['https://private.example'],threadId:ids.thread,startedAt:now-3000,completedAt:now,updatedAt:now,...overrides}));
 return {t,ids,request,post};
}

test('NyX addressed Telegram replies are included immediately, with safe accepted and delivery metadata only',async()=>{
 const {t,request}=await setup();await request();const r=await t.query(ref,{});
 const events=r.events.filter(e=>e.platform==='telegram');expect(events).toHaveLength(2);
 expect(events.map(e=>e.status)).toEqual(['delivered','queued']);
 expect(events.every(e=>e.agentSlug==='nyx'&&e.agentName==='NyX'&&e.action==='telegram-request'&&e.url===null)).toBe(true);
 for(const e of r.events)expect(Object.keys(e).sort()).toEqual(['action','agentName','agentSlug','at','id','platform','status','url']);
 expect(JSON.stringify(r)).not.toMatch(/PRIVATE_|senderId|ownerUserId|operationKey|inputHash|conversationId|botId|messageId|grant|prompt|replyText/);
 expect(r.counts).toEqual({forum:4,telegram:3,x:1});
});

test('new query reads source lifecycle changes without a five-minute clock argument',async()=>{
 const {t,request}=await setup();const id=await request({status:'queued',sentMessageId:undefined});
 expect((await t.query(ref,{})).events.filter(e=>e.platform==='telegram').map(e=>e.status)).toEqual(['queued']);
 for(const [state,expected] of [['generating','running'],['ready','completed'],['held','held']] as const){
  await t.run(ctx=>ctx.db.patch('telegramAgentRequests',id,{status:state,updatedAt:now+100}));
  expect((await t.query(ref,{})).events.find(e=>e.id==='tg:'+id+':state')?.status).toBe(expected);
 }
});

test('mod log, spoofed bots, unapproved identities, bad topics and invalid autonomous actions stay excluded',async()=>{
 const {t,request}=await setup();
 for(const patch of [{topicId:7},{topicId:-1},{botId:'different'},{agentSlug:'human'},{kind:'yap' as const,topicId:85},{kind:'meme' as const,topicId:13}])await request(patch);
 expect((await t.query(ref,{})).events.filter(e=>e.platform==='telegram')).toEqual([]);
});

test('sent without a confirmed message ID is held, never delivered; unknown runtime result is not success',async()=>{
 const {t,request}=await setup();await request({sentMessageId:undefined});
 await t.run(ctx=>ctx.db.insert('elizaRuntimeCalls',{jobId:'PRIVATE_JOB_ID',inputHash:'PRIVATE_INPUT_HASH',operationKey:'PRIVATE_OPERATION_KEY',agentSlug:'nyx',stage:'nyx:telegram-reply',model:'openai/gpt-6-luna',status:'failed',outcomeUnknown:true,createdAt:now-100,updatedAt:now,expiresAt:now+100000}));
 const r=await t.query(ref,{});expect(r.events.filter(e=>e.platform==='telegram').map(e=>e.status).sort()).toEqual(['held','held','queued']);
 expect(JSON.stringify(r)).not.toMatch(/PRIVATE_|stage|jobId/);
});

test('X work is generic private-draft metadata, never published content or URLs',async()=>{
 const {t,ids}=await setup();
 await t.run(ctx=>ctx.db.insert('xAgentDrafts',{ownerUserId:ids.owner,agentSlug:'nyx',accountEpoch:1,key:'PRIVATE_DRAFT_KEY',sourceThreadId:ids.thread,brief:'PRIVATE_BRIEF',status:'draft',conversationId:'PRIVATE_THREAD',text:'PRIVATE_X_TEXT',issues:['PRIVATE_REVIEW'],createdAt:now-100,updatedAt:now}));
 const r=await t.query(ref,{}),draft=r.events.find(e=>e.action==='x-draft');expect(draft).toMatchObject({status:'completed',url:null,agentName:'NyX'});
 expect(r.events.some(e=>e.platform==='x'&&e.status==='published')).toBe(false);expect(JSON.stringify(r)).not.toMatch(/PRIVATE_/);
});

test('forum publication is verified against actual active public source and agent authorship',async()=>{
 const {t,ids,post}=await setup();await post();
 const r=await t.query(ref,{});expect(r.events.find(e=>e.status==='published')?.url).toBe('https://forum.symbaiex.com/research/retrieval');
 await t.run(ctx=>ctx.db.patch('forumCategories',ids.category,{viewAccess:'members'}));
 const hidden=await t.query(ref,{});expect(hidden.events.some(e=>e.status==='published'||e.url?.startsWith('https://forum.symbaiex.com'))).toBe(false);
 expect(hidden.events.some(e=>e.action==='forum-post'&&e.status==='completed'&&e.url===null)).toBe(true);
});

test('source/runtime allowlist cannot expose arbitrary stages and disabled agent metadata',async()=>{
 const {t,ids,request}=await setup();await request();
 await t.run(async ctx=>{
  for(const stage of ['nyx:telegram-reply-extra','nyx:health-canary','nyx:daily-signal:draft','suki:x-draft'])await ctx.db.insert('elizaRuntimeCalls',{jobId:stage,inputHash:'PRIVATE_HASH',operationKey:stage,agentSlug:stage.startsWith('suki')?'suki':'nyx',stage,model:'openai/gpt-6-luna',status:'completed',createdAt:now,updatedAt:now,expiresAt:now+1000});
  const agent=await ctx.db.query('forumAgents').withIndex('by_slug',q=>q.eq('slug','nyx')).unique();await ctx.db.patch('forumAgents',agent!._id,{enabled:false});
  await ctx.db.patch('xAgentAccounts',ids.account,{connected:false});
 });
 const r=await t.query(ref,{});expect(r.events).toEqual([]);expect(r.counts).toEqual({forum:3,telegram:2,x:0});
});

test('new registered roster identities appear dynamically and all stored holds/requests remain unchanged',async()=>{
 const {t,request}=await setup();
 vi.stubEnv('TELEGRAM_AGENT_BOTS',JSON.stringify({...registry,'lena-corwin':{token:'423456789:'+ 'd'.repeat(35),username:'symbaiex_lena_bot'}}));
 const id=await request({agentSlug:'lena-corwin',botId:'423456789',status:'held'});
 const hold=await t.run(ctx=>ctx.db.insert('elizaRuntimeOperations',{operationKey:'PRIVATE_HOLD',status:'unknown',jobId:'PRIVATE_JOB',inputHash:'PRIVATE_HASH',updatedAt:now}));
 const before=await t.run(async ctx=>({request:await ctx.db.get('telegramAgentRequests',id),hold:await ctx.db.get('elizaRuntimeOperations',hold)}));
 const r=await t.query(ref,{});expect(r.counts.telegram).toBe(4);expect(r.events.find(e=>e.status==='held')?.agentName).toBe('Lena Corwin');
 expect(await t.run(async ctx=>({request:await ctx.db.get('telegramAgentRequests',id),hold:await ctx.db.get('elizaRuntimeOperations',hold)}))).toEqual(before);
});

test('intent reads and public result remain bounded when one agent has many old requests',async()=>{
 const {t,request}=await setup();for(let i=0;i<100;i++)await request({createdAt:now-i*1000,updatedAt:now-i*1000});
 const r=await t.query(ref,{});expect(r.events.filter(e=>e.platform==='telegram')).toHaveLength(16);expect(r.events.length).toBeLessThanOrEqual(80);
});

test('all Telegram delivery kinds, including autonomous posts and digests, have null URLs',async()=>{
 const {t,request}=await setup();
 await request({kind:'yap',topicId:296});
 await request({kind:'meme',topicId:13,agentSlug:'belle',botId:'323456789'});
 await t.run(ctx=>ctx.db.insert('telegramForumDigests',{key:'ordinary',topicId:273,from:now-1000,to:now,preview:false,status:'sent',threadIds:[],sentMessageId:200,createdAt:now,updatedAt:now}));
 const rows=(await t.query(ref,{})).events.filter(e=>e.platform==='telegram');expect(rows.some(e=>e.status==='delivered')).toBe(true);expect(rows.every(e=>e.url===null)).toBe(true);
});

test('active nested agent replies are publication-verified; hidden ancestors, reports and deleted replies fail closed',async()=>{
 const {t,ids}=await setup();
 const created=await t.run(async ctx=>{
  const nyx=await ctx.db.query('forumAgents').withIndex('by_slug',q=>q.eq('slug','nyx')).unique();
  const parent=await ctx.db.insert('forumPosts',{threadId:ids.thread,categoryId:ids.category,authorId:ids.owner,body:'PRIVATE_PARENT_BODY',status:'active',createdAt:now-100,updatedAt:now-100});
  const post=await ctx.db.insert('forumPosts',{parentPostId:parent,threadId:ids.thread,categoryId:ids.category,authorId:nyx!.userId,body:'PRIVATE_AGENT_REPLY',status:'active',createdAt:now,updatedAt:now});
  const run=await ctx.db.insert('forumAgentReplyRuns',{runKey:'PRIVATE_REPLY_RUN',agentSlug:'nyx',runDate:'2026-10-28',sourceKind:'reply',sourcePostId:parent,threadId:ids.thread,categoryId:ids.category,authorId:ids.owner,attempt:1,status:'replied',model:'openai/gpt-6-luna',replyPostId:post,startedAt:now-100,completedAt:now,updatedAt:now});
  return {parent,post,run};
 });
 expect((await t.query(ref,{})).events.find(e=>e.id==='reply:'+created.run)).toMatchObject({status:'published',url:'https://forum.symbaiex.com/research/retrieval#post-'+created.post});
 const wrongCategory=await t.run(ctx=>ctx.db.insert('forumCategories',{slug:'other',name:'Other',description:'',status:'active',viewAccess:'public',position:1,threadCount:0,postCount:0,createdAt:now,updatedAt:now}));
 await t.run(ctx=>ctx.db.patch('forumPosts',created.post,{categoryId:wrongCategory}));
 expect((await t.query(ref,{})).events.find(e=>e.id==='reply:'+created.run)).toMatchObject({status:'completed',url:null});
 await t.run(ctx=>ctx.db.patch('forumPosts',created.post,{categoryId:ids.category}));
 await t.run(ctx=>ctx.db.patch('forumPosts',created.parent,{status:'hidden'}));
 expect((await t.query(ref,{})).events.find(e=>e.id==='reply:'+created.run)).toMatchObject({status:'completed',url:null});
 await t.run(async ctx=>{await ctx.db.patch('forumPosts',created.parent,{status:'active'});await ctx.db.patch('forumPosts',created.post,{status:'deleted'});});
 expect((await t.query(ref,{})).events.find(e=>e.id==='reply:'+created.run)).toMatchObject({status:'completed',url:null});
 await t.run(async ctx=>{await ctx.db.patch('forumPosts',created.post,{status:'active'});await ctx.db.insert('forumReports',{reporterId:ids.owner,entityType:'post',postId:created.post,reason:'PRIVATE_REPORT',status:'open',createdAt:now,updatedAt:now});});
 expect((await t.query(ref,{})).events.find(e=>e.id==='reply:'+created.run)).toMatchObject({status:'completed',url:null});
 expect(JSON.stringify(await t.query(ref,{}))).not.toContain('PRIVATE_');
});

test('root publications and replies share a four-candidate fresh verification budget',async()=>{
 const {t,ids,post}=await setup();for(let i=0;i<3;i++)await post({updatedAt:now+i});
 await t.run(async ctx=>{
  const nyx=await ctx.db.query('forumAgents').withIndex('by_slug',q=>q.eq('slug','nyx')).unique();
  for(let i=0;i<3;i++){
   const p=await ctx.db.insert('forumPosts',{threadId:ids.thread,categoryId:ids.category,authorId:nyx!.userId,body:'PRIVATE',status:'active',createdAt:now+i,updatedAt:now+i});
   await ctx.db.insert('forumAgentReplyRuns',{runKey:'PRIVATE'+i,agentSlug:'nyx',runDate:'2026-10-28',sourceKind:'thread',threadId:ids.thread,categoryId:ids.category,authorId:ids.owner,attempt:1,status:'replied',model:'openai/gpt-6-luna',replyPostId:p,startedAt:now,completedAt:now+100+i,updatedAt:now+100+i});
  }
 });
 const rows=(await t.query(ref,{})).events;expect(rows.filter(e=>e.status==='published')).toHaveLength(4);expect(rows.filter(e=>e.status==='published'&&e.action==='forum-reply')).toHaveLength(3);expect(rows.filter(e=>e.action==='forum-post'&&e.status==='completed'&&e.url===null)).toHaveLength(2);
});

test('latest mascot drafts need no forum source and never imply an external publication',async()=>{
 const {t,ids}=await setup();
 await t.run(async ctx=>{
  for(const status of ['publishing','published'] as const)await ctx.db.insert('xAgentDrafts',{ownerUserId:ids.owner,agentSlug:'nyx',accountEpoch:1,key:'PRIVATE_MASCOT_'+status,kind:'mascot',brief:'PRIVATE_MASCOT_BRIEF',status,conversationId:'PRIVATE_CONVERSATION',text:'PRIVATE_MASCOT_TEXT',createdAt:now,updatedAt:now});
 });
 const rows=(await t.query(ref,{})).events.filter(e=>e.action==='x-draft');expect(rows.map(e=>e.status).sort()).toEqual(['completed','running']);expect(rows.every(e=>e.url===null)).toBe(true);expect(JSON.stringify(rows)).not.toContain('PRIVATE_');
});

test('actual X official-account operation receipts project safe queued/running/confirmed/held states',async()=>{
 const {t,ids}=await setup();
 const held=await t.run(async ctx=>{
  let last:Doc<'xAgentOperations'>['_id']|null=null;
  for(const [kind,status] of [['repost','confirmed'],['comment','confirmed'],['comment','sending'],['comment','queued'],['comment','held']] as const)last=await ctx.db.insert('xAgentOperations',{accountId:ids.account,epoch:1,key:'PRIVATE_X_OPERATION_'+kind+status,kind,post:{id:'2112678767726366720',authorId:'1494195618213990401',text:'PRIVATE_OFFICIAL_POST_TEXT',createdAt:now},status,notBefore:now,expiresAt:now+1000,resultId:'PRIVATE_RESULT_ID',issue:'PRIVATE_ISSUE',updatedAt:now});
  await ctx.db.insert('xAgentOperations',{accountId:ids.account,epoch:1,key:'PRIVATE_UNAPPROVED_SOURCE',kind:'comment',post:{id:'1',authorId:'not-an-official-account',text:'PRIVATE',createdAt:now},status:'confirmed',notBefore:now,expiresAt:now+1000,updatedAt:now});
  return last!;
 });
 const before=await t.run(ctx=>ctx.db.get('xAgentOperations',held));
 const rows=(await t.query(ref,{})).events.filter(e=>e.action==='x-repost'||e.action==='x-comment');
 expect(rows).toHaveLength(5);expect(rows.filter(e=>e.status==='completed')).toHaveLength(2);expect(rows.some(e=>e.status==='held')).toBe(true);expect(rows.some(e=>e.status==='published'||e.status==='delivered')).toBe(false);expect(rows.every(e=>e.url===null)).toBe(true);expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_|officialPost|resultId|issue|accountId|epoch|notBefore|expiresAt/);
 expect(await t.run(ctx=>ctx.db.get('xAgentOperations',held))).toEqual(before);
});
