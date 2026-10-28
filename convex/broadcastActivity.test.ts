/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";
const modules = import.meta.glob("./**/*.ts");
const now = 1793188800000;
const ref = makeFunctionReference<"query", {now:number}, {events:Array<{id:string;agentSlug:string;action:string;url:string;at:number}>;telegramAgents:string[];xConnected:boolean}>("broadcastActivity:publicActivity");
afterEach(()=>vi.unstubAllEnvs());
async function setup(){
 vi.stubEnv("TELEGRAM_AGENTS_ENABLED","true");vi.stubEnv("X_AGENTS_ENABLED","true");
 vi.stubEnv("TELEGRAM_AGENT_BOTS",JSON.stringify({belle:{token:'123456789:'+ 'a'.repeat(35),username:'symbaiex_belle_bot'},suki:{token:'223456789:'+ 'b'.repeat(35),username:'symbaiex_suki_bot'}}));
 const t=convexTest(schema,modules);
 const ids=await t.run(async ctx=>{
  const user=await ctx.db.insert('users',{name:'Synthetic owner'});
  for(const slug of ['suki','belle'])await ctx.db.insert('forumAgents',{slug,name:slug,userId:user,persona:'Synthetic fixture',model:'openai/gpt-6-luna',enabled:true,dailyPostTarget:1,createdAt:now,updatedAt:now});
  const category=await ctx.db.insert('forumCategories',{slug:'research',name:'Research',description:'',status:'active',viewAccess:'public',position:0,threadCount:1,postCount:1,createdAt:now,updatedAt:now});
  const thread=await ctx.db.insert('forumThreads',{categoryId:category,categorySlug:'research',slug:'retrieval',title:'Retrieval source visibility',body:'Synthetic public research source.',authorId:user,lastPostUserId:user,status:'active',pinned:false,replyCount:0,viewCount:0,searchText:'retrieval',lastPostAt:now,createdAt:now,updatedAt:now});
  const topic=await ctx.db.insert('telegramYapResearchTopics',{sourceThreadId:thread,conversationId:'synthetic',tag:'retrieval',createdAt:now-1000,lastStartedAt:now-1000,lastConfirmedAt:now,hasConfirmed:true});
  await ctx.db.insert('xAgentAccounts',{agentSlug:'nyx',ownerUserId:user,expectedUsername:'symbaiex_nyx',epoch:1,connected:true,mode:'drafts',username:'symbaiex_nyx',grant:{ciphertext:'synthetic-secret',nonce:'synthetic-nonce'},updatedAt:now});
  return {user,category,thread,topic};
 });
 const insert=async(overrides:Partial<Doc<'telegramAgentRequests'>>={})=>t.run(ctx=>ctx.db.insert('telegramAgentRequests',{key:'synthetic',agentSlug:'belle',botId:'123456789',updateId:1,messageId:1,topicId:13,senderId:'private-human-id',conversationId:'synthetic',kind:'meme',status:'sent',sentMessageId:100,prompt:'NEVER EXPOSE PROMPT',reply:'NEVER EXPOSE BODY',reason:'NEVER EXPOSE ERROR',createdAt:now-1000,updatedAt:now,...overrides}));
 return {t,ids,insert};
}
test('anonymous response is exactly the metadata allowlist, never raw stored objects',async()=>{
 const {t,insert}=await setup();await insert();const r=await t.query(ref,{now});
 expect(r.telegramAgents).toEqual(['suki','belle']);expect(r.xConnected).toBe(true);
 expect(r.events).toEqual([{id:'telegram:13:100',agentSlug:'belle',platform:'telegram',action:'meme',status:'confirmed',at:now,topicId:13,messageId:100,url:'https://t.me/symforum/13/100'}]);
 expect(JSON.stringify(r)).not.toMatch(/NEVER|private-human|synthetic-secret|synthetic-nonce|grant|ownerUserId|conversationId|senderId|prompt|reply|reason/);
});
test('private/member interactions, uncertain sends, spoofed bots, topics and identities fail closed',async()=>{
 const {t,insert}=await setup();
 for(const kind of ['ask','help','menu','prompt'] as const)await insert({kind});
 for(const status of ['held','sending','ready','generating','queued'] as const)await insert({status});
 for(const overrides of [{botId:'wrong'},{topicId:7},{agentSlug:'unapproved'},{sentMessageId:undefined},{sentMessageId:-1},{updatedAt:now+1},{updatedAt:now-24*3600000}])await insert(overrides);
 expect((await t.query(ref,{now})).events).toEqual([]);
});
test('autonomous Yappers receipt rechecks current public source and ancestors',async()=>{
 const {t,ids,insert}=await setup();await insert({kind:'yap',agentSlug:'suki',botId:'223456789',topicId:296,yapVersion:4,yapResearchTopicId:ids.topic,sentMessageId:101});
 expect((await t.query(ref,{now})).events).toHaveLength(1);
 await t.run(ctx=>ctx.db.patch('forumCategories',ids.category,{viewAccess:'members'}));
 expect((await t.query(ref,{now})).events).toEqual([]);
});
test('preview digests are private and disabled agents never get receipts',async()=>{
 const {t,insert}=await setup();await insert();
 await t.run(async ctx=>{await ctx.db.insert('telegramForumDigests',{key:'preview',topicId:273,from:now-1000,to:now,preview:true,status:'sent',threadIds:[],sentMessageId:200,createdAt:now,updatedAt:now});const agent=await ctx.db.query('forumAgents').withIndex('by_slug',q=>q.eq('slug','belle')).unique();await ctx.db.patch('forumAgents',agent!._id,{enabled:false});});
 expect((await t.query(ref,{now})).events).toEqual([]);
 vi.stubEnv('TELEGRAM_AGENTS_ENABLED','false');expect((await t.query(ref,{now})).telegramAgents).toEqual([]);
});
test('invalid windows reject and query leaves all intent/hold records byte-for-byte unchanged',async()=>{
 const {t,insert}=await setup();const id=await insert({status:'held'});const before=await t.run(ctx=>ctx.db.get('telegramAgentRequests',id));
 await t.query(ref,{now});expect(await t.run(ctx=>ctx.db.get('telegramAgentRequests',id))).toEqual(before);
 for(const value of [-1,1,NaN,Infinity])await expect(t.query(ref,{now:value})).rejects.toThrow();
});
