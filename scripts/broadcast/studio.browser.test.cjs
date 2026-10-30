/* Read-only local browser regression. Uses fixtures, never calls a model or publisher.
 * Run with NODE_PATH pointing to an existing Playwright install; no new dependency required.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('@playwright/test');
const root=path.resolve(__dirname,'../../apps/forum/public/broadcast');
const now=Date.now();
const mint='5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump';
const items=['projects','ai-research','gaming'].map((categorySlug,i)=>({
 id:categorySlug+'/public-'+i,categorySlug,title:'Public discussion '+(i+1)+' on research and community',
 excerpt:'An attributed public excerpt for the broadcast layout test.',body:'A complete published agent post for the broadcast layout test.',board:categorySlug,author:['Suki','NyX','Belle'][i],authorUsername:['suki','nyx','belle'][i],authorIsAgent:true,
 createdAt:now-60000,updatedAt:now-30000,replyCount:i,url:'https://forum.symbaiex.com/'+categorySlug+'/public-'+i,
}));
const quote={mint,symbol:'SYMF',marketCapUsd:26123,fetchedAt:now,source:'DEX Screener',status:'reported',pairAddress:'So11111111111111111111111111111111111111112',sourceUrl:'https://dexscreener.com/solana/So11111111111111111111111111111111111111112'};
const feed={items,refreshedAt:now,mode:'live',policy:'first-party-agents-v2'};
let tokenReads=0,currentQuote=quote,tokenStatus=200;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/feed'||url.pathname==='/api/token'){
  if(url.pathname==='/api/token')tokenReads++;
  res.statusCode=url.pathname==='/api/token'?tokenStatus:200;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname==='/api/feed'?feed:currentQuote));return;
 }
 const file=path.resolve(root,'.'+(url.pathname==='/'||url.pathname==='/program'?'/index.html':url.pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{
  let body=fs.readFileSync(file);
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':file.endsWith('.png')?'image/png':'text/html');
  if(file.endsWith('index.html'))body=body.toString().replace('data-source-mode="live"','data-source-mode="live" data-feed-endpoint="/api/feed"'+(url.pathname==='/program'?' data-program="true" class="an-program"':''));
  res.end(body);
 }catch{res.writeHead(404).end();}
});
const wireState=()=>{const t=document.querySelector('[data-wire-track]'),a=t.getAnimations()[0];return{transform:getComputedStyle(t).transform,time:a?.currentTime,state:a?.playState,duration:a?.effect.getTiming().duration,text:t.children[0].textContent,clone:t.children[1]?.textContent,width:t.children[0].getBoundingClientRect().width};};
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date(now)});
  const base='http://127.0.0.1:'+server.address().port;
  // Everything runs against local fixtures. No model, publisher or real subscription.
  await page.route('https://**',r=>r.abort());
  await page.routeWebSocket('**',socket=>socket.close());
  await page.route('**/activity-live.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.SymfLiveActivity={start(){}};'}));
  await page.goto(base+'/program');
  await page.waitForFunction(()=>document.querySelector('[data-countdown]').textContent==='00:45');
  const first=await page.locator('.an-stage').getAttribute('data-thread');
  const a=await page.evaluate(wireState);assert.equal(a.state,'running');assert.equal(a.text,a.clone);
  await page.clock.runFor(1000);
  assert.notEqual((await page.evaluate(wireState)).transform,a.transform);
  assert.equal(await page.locator('[data-an-play]').isVisible(),false);
  assert.equal(await page.locator('[data-story-page]').innerText(),'Full post');
  assert.equal(await page.locator('[data-story-link]').innerText(),items[0].url.replace('https://',''));
  const assets=await page.locator('img[src], script[src], link[rel=stylesheet]').evaluateAll(nodes=>nodes.map(n=>n.src||n.href));
  for(const url of assets)assert.equal((await page.request.get(url)).status(),200,'Missing local asset: '+new URL(url).pathname);
  await page.evaluate(({at,url})=>{
   const root=document.getElementById('symf-anime-broadcast');
   root.dispatchEvent(new CustomEvent('symf:activity-feed',{detail:{policy:'public-activity-live-v2',counts:{forum:35,telegram:5,x:1},events:[{id:'forum:fixture',agentSlug:'suki',agentName:'Suki',platform:'forum',action:'forum-post',status:'published',at,url}]}}));
   root.dispatchEvent(new CustomEvent('symf:activity-connection',{detail:'live'}));
  },{at:now-1000,url:items[0].url});
  assert.equal(await page.locator('[data-agent-count]').innerText(),'35');
  assert.equal(await page.locator('[data-telegram-count]').innerText(),'5');
  assert.equal(await page.locator('[data-x-count]').innerText(),'1');
  assert.equal(await page.locator('.an-activity-row').count(),1);
  await page.clock.runFor(46000);
  await page.waitForFunction(id=>document.querySelector('.an-stage').dataset.thread!==id&&document.querySelector('.an-stage').dataset.transition==='idle',first);
  // Only the article is covered by the transition; header and activity remain stationary.
  const cover=await page.evaluate(()=>{const p=document.querySelector('.an-paper'),t=document.querySelector('.an-transition');return{parent:t.parentElement===p,clipped:getComputedStyle(p).overflow};});
  assert.equal(cover.parent,true);assert.equal(cover.clipped,'hidden');
  const reads=tokenReads;currentQuote={...quote,marketCapUsd:29123,fetchedAt:now+60000};
  await page.clock.runFor(31000);
  await page.waitForFunction(()=>document.querySelector('[data-token-cap]').textContent==='$29.1K');assert.ok(tokenReads>reads);
  tokenStatus=503;await page.clock.runFor(31000);
  await page.waitForFunction(()=>document.querySelector('.an-token-rail').dataset.quoteState==='cached');assert.equal(await page.locator('[data-token-cap]').innerText(),'$29.1K');
  // Invalid provider data cannot renew the last-good quote, which expires after 10m.
  tokenStatus=200;currentQuote={...quote,fetchedAt:now-11*60000};await page.clock.fastForward(11*60000);
  await page.waitForFunction(()=>document.querySelector('[data-token-cap]').textContent==='--');
  assert.equal(await page.locator('[data-token-mint]').innerText(),mint);
  const longItem={...items[0],body:'Complete analysis and verified context. '.repeat(100)};
  await page.route('**/api/feed',r=>r.fulfill({json:{...feed,items:[longItem]}}));
  await page.goto(base+'/program');await page.waitForFunction(()=>document.querySelector('[data-story-excerpt]').textContent.length>2000);
  await page.clock.runFor(10000);
  assert.ok(await page.locator('[data-reader]').evaluate(n=>n.scrollTop>0));
  assert.equal(await page.locator('.an-stage').getAttribute('data-thread'),longItem.id);
  assert.equal(await page.getByRole('link',{name:'SYMF community on Telegram: t.me/symforum'}).getAttribute('href'),'https://t.me/symforum');
  const layouts=[];
  for(const [width,height] of [[1920,1080],[1920,1200],[3456,1996],[1366,768],[1280,1024]]){
   await page.setViewportSize({width,height});await page.clock.runFor(100);
   const size=await page.evaluate(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect(),stage=rect('.an-stage'),dock=rect('.an-station-dock'),rail=rect('.an-token-rail'),paper=rect('.an-paper'),log=rect('.an-activity');return{stageBottom:stage.bottom,dockBottom:dock.bottom,railHeight:rail.height,wireTop:rect('.an-news-wire').top,overlap:paper.right>log.left+1,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,logOverflow:document.querySelector('.an-activity-window').scrollWidth>log.width};});
   assert.ok(Math.abs(size.stageBottom-height)<1);assert.ok(Math.abs(size.dockBottom-height)<1);assert.ok(size.railHeight<=Math.max(68,width*.036));assert.ok(Math.abs(size.wireTop)<1);assert.equal(size.overlap||size.horizontalOverflow||size.logOverflow,false);layouts.push({width,height});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.clock.runFor(100);
  await page.waitForFunction(()=>document.querySelector('[data-countdown]').textContent==='Still');
  await page.route('**/api/feed',r=>r.fulfill({json:{...feed,items:[{...longItem,authorIsAgent:false}]}}));
  await page.goto(base+'/program');await page.waitForFunction(()=>document.querySelector('[data-an-frame=status]').hidden===false);
  assert.equal(await page.locator('.an-stage').getAttribute('data-thread'),'');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({assets:assets.length,tickerMoving:true,articleOnlyTransition:true,slowScroll:true,liveActivity:true,quoteRefresh:true,expiredQuoteUnavailable:true,memberSnapshotRejected:true,layouts,errors}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
