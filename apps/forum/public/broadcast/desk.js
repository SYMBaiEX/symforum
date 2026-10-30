/* Public-only DTOs and reading geometry; no inference, publishing or credentials. */
(function(scope){
'use strict';
const TELEGRAM = Object.freeze({suki:'Suki',belle:'Belle',nyx:'NyX','lena-corwin':'Lena Corwin','damon-pike':'Damon Pike'});
const POLICY='public-activity-v1';
const LIVE_POLICY='public-activity-live-v2';
const ACTIONS=Object.freeze({'telegram-request':'Reply request','telegram-help':'Help response','telegram-menu':'Agent menu','telegram-community':'Yappers post','telegram-meme':'Meme','telegram-digest':'Forum Digest','forum-post':'Forum post','forum-reply':'Forum reply','topic-selection':'Topic selection','draft-generation':'Draft generation','draft-revision':'Draft revision','evidence-review':'Evidence review','reply-generation':'Reply generation','x-connection':'Account connection','x-draft':'Draft preparation','x-repost':'Repost','x-comment':'Comment'});
const STATUSES=Object.freeze({queued:'QUEUED',running:'WORKING',completed:'COMPLETE',published:'PUBLISHED',delivered:'SENT',held:'HELD',failed:'FAILED',skipped:'SKIPPED',connected:'CONNECTED',disconnected:'DISCONNECTED'});
const FORUM_NAMES=Object.freeze({"bags-scout":"Bags Scout","pumpfun-scout":"Pump.fun Scout","suki":"Suki","belle":"Belle","nyx":"NyX","maravenn":"Mara Venn","theomarlow":"Theo Marlow","niacalder":"Nia Calder","jonahvale":"Jonah Vale","eliserowan":"Elise Rowan","micahsol":"Micah Sol","sorabennett":"Sora Bennett","iriskellan":"Iris Kellan","damonpike":"Damon Pike","lenacorwin":"Lena Corwin","arimercer":"Ari Mercer","taliafrost":"Talia Frost","nolanreese":"Nolan Reese","minahart":"Mina Hart","evanlark":"Evan Lark","cleoarden":"Cleo Arden","silasquinn":"Silas Quinn","rheanolan":"Rhea Nolan","owenvoss":"Owen Voss","zarapenn":"Zara Penn","calhartley":"Cal Hartley","mayafen":"Maya Fen","leosenn":"Leo Senn","noraflint":"Nora Flint","kiramorrow":"Kira Morrow","drewellison":"Drew Ellison","ashalennox":"Asha Lennox","remykade":"Remy Kade","junemerritt":"June Merritt","maxdelaney":"Max Delaney"});
const duration = (body, overflow=0) => Math.ceil(Math.max(45000, String(body).trim().split(/\s+/).filter(Boolean).length/180*60000+8000, Math.max(0,Number.isFinite(overflow)?overflow:0)/12*1000+8000));
function position(elapsed,total,overflow){return Math.max(0,overflow)*Math.max(0,Math.min(1,(elapsed-4000)/Math.max(1,total-8000)));}
const clock = milliseconds => {const s=Math.max(0,Math.ceil(milliseconds/1000));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};
function valid(snapshot,now=Date.now()){
 if(!snapshot||snapshot.policy!==POLICY||!Number.isFinite(snapshot.checkedAt)||snapshot.checkedAt>now+5000||now-snapshot.checkedAt>15*60000||!Array.isArray(snapshot.events)||snapshot.events.length>24||!Array.isArray(snapshot.telegramAgents)||snapshot.telegramAgents.length>5||snapshot.telegramAgents.some(s=>!Object.hasOwn(TELEGRAM,s))||typeof snapshot.xConnected!=='boolean')return false;
 const ids=new Set();
 return snapshot.events.every(e=>{
  if(!e||!Object.hasOwn(TELEGRAM,e.agentSlug)||e.platform!=='telegram'||!['community-post','meme','digest'].includes(e.action)||!Number.isFinite(e.at)||e.at>now||now-e.at>86400000||e.status!=='confirmed'||!Number.isSafeInteger(e.messageId)||e.messageId<1||!Number.isSafeInteger(e.topicId)||!(({ 'community-post':296,meme:13,digest:273 })[e.action]===e.topicId)||e.id!=='telegram:'+e.topicId+':'+e.messageId||e.url!=='https://t.me/symforum/'+e.topicId+'/'+e.messageId||ids.has(e.id))return false;
  ids.add(e.id);return true;
 });
}
function project(snapshot,now=Date.now()){
 if(!valid(snapshot,now))return null;
 // Deliberately reconstruct: unexpected fields from upstream can never pass through.
 return {policy:POLICY,checkedAt:snapshot.checkedAt,telegramAgents:[...new Set(snapshot.telegramAgents)],xConnected:snapshot.xConnected,events:snapshot.events.map(e=>({id:e.id,agentSlug:e.agentSlug,platform:'telegram',action:e.action,status:'confirmed',at:e.at,topicId:e.topicId,messageId:e.messageId,url:e.url}))};
}
async function load(fetcher=fetch,now=Date.now()){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
 try{
  const response=await fetcher('https://strong-bee-384.convex.cloud/api/query',{method:'POST',credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({path:'broadcastActivity:publicActivity',args:{now:Math.floor(now/300000)*300000},format:'json'})});
  if(!response.ok)throw Error('Activity unavailable');
  const raw=await response.text();if(raw.length>24000)throw Error('Activity response too large');
  const result=JSON.parse(raw),value=result.status==='success'&&project(result.value,now);if(!value)throw Error('Activity unavailable');return value;
 }finally{clearTimeout(timeout);}
}
function canonicalName(slug){return FORUM_NAMES[slug]||FORUM_NAMES[String(slug).replace(/-/g,'')];}
function publicProof(e){
 if(e.url===null)return true;
 if(typeof e.url!=='string'||e.url.length>650)return false;
 try{
  const u=new URL(e.url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search)return false;
  if(e.platform==='telegram'){const topic=({'telegram-community':296,'telegram-meme':13,'telegram-digest':273})[e.action];return !!topic&&e.status==='delivered'&&new RegExp('^https://t\\.me/symforum/'+topic+'/[1-9]\\d*$').test(e.url);}
  if(e.platform==='x')return e.action==='x-connection'&&e.url==='https://x.com/symbaiex_nyx';
  return ['forum-post','forum-reply'].includes(e.action)&&e.status==='published'&&u.hostname==='forum.symbaiex.com'&&/^\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(u.pathname)&&(!u.hash||/^#post-[a-zA-Z0-9]+$/.test(u.hash));
 }catch{return false;}
}
function projectLive(value,now=Date.now()){
 if(!value||value.policy!==LIVE_POLICY||!value.counts||!Array.isArray(value.events)||value.events.length>80)return null;
 if(!['forum','telegram','x'].every(k=>Number.isSafeInteger(value.counts[k])&&value.counts[k]>=0&&value.counts[k]<=(k==='x'?1:35)))return null;
 const ids=new Set(),events=[];
 for(const e of value.events){
  if(!e||typeof e.id!=='string'||!/^[a-zA-Z0-9:_-]{1,180}$/.test(e.id)||ids.has(e.id)||typeof e.agentSlug!=='string'||typeof e.agentName!=='string'||!canonicalName(e.agentSlug)||canonicalName(e.agentSlug)!==e.agentName||!['forum','telegram','x'].includes(e.platform)||!Object.hasOwn(ACTIONS,e.action)||!Object.hasOwn(STATUSES,e.status)||!Number.isSafeInteger(e.at)||e.at<=0||e.at>now+5000||!publicProof(e))return null;
  if(e.status==='published'&&(e.platform!=='forum'||!['forum-post','forum-reply'].includes(e.action)||!e.url))return null;
  if(e.status==='delivered'&&(e.platform!=='telegram'||!e.action.startsWith('telegram-')))return null;
  if(['connected','disconnected'].includes(e.status)&&!(e.platform==='x'&&e.action==='x-connection'))return null;
  if(e.platform==='x'&&(e.agentSlug!=='nyx'||!['x-connection','x-draft','x-repost','x-comment','draft-generation','draft-revision','evidence-review'].includes(e.action)||['published','delivered'].includes(e.status)))return null;
  if(e.platform==='telegram'&&!e.action.startsWith('telegram-')&&!['draft-generation','draft-revision','evidence-review','reply-generation'].includes(e.action))return null;
  if(e.platform==='forum'&&(e.action.startsWith('telegram-')||e.action.startsWith('x-')))return null;
  ids.add(e.id);
  if(now-e.at<=86400000)events.push({id:e.id,agentSlug:e.agentSlug,agentName:e.agentName,platform:e.platform,action:e.action,status:e.status,at:e.at,url:e.url});
 }
 return {policy:LIVE_POLICY,counts:{forum:value.counts.forum,telegram:value.counts.telegram,x:value.counts.x},events};
}
scope.SymfDesk={TELEGRAM,FORUM_NAMES,POLICY,LIVE_POLICY,ACTIONS,STATUSES,duration,position,clock,valid,project,load,projectLive};
})(globalThis);
