/* Read-only local browser regression. Uses fixtures, never calls a model or publisher.
 * Run with NODE_PATH pointing to an existing Playwright install; no new dependency required.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
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
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date(now)});
  const base='http://127.0.0.1:'+server.address().port;
  await page.goto(base+'/program');
  await page.waitForFunction(()=>document.querySelector('[data-countdown]').textContent==='00:18');
  const a=await page.evaluate(wireState);assert.equal(a.state,'running');assert.equal(a.text,a.clone);
  await page.waitForFunction(t=>document.querySelector('[data-wire-track]').getAnimations()[0].currentTime>t+350,a.time);
  const b=await page.evaluate(wireState);assert.notEqual(a.transform,b.transform);
  await page.clock.runFor(2200);
  await page.waitForFunction(()=>document.querySelector('[data-countdown]').textContent==='00:16');
  const first=await page.locator('.an-stage').getAttribute('data-thread');
  // Advance the real scene timeout without waiting 18 seconds in the test.
  await page.evaluate(()=>document.querySelector('[data-an-play]').click());
  await page.evaluate(async()=>{await document.querySelector('[data-wire-track]').getAnimations()[0].ready;});
  const paused=await page.evaluate(wireState);assert.equal(paused.state,'paused');
  await page.clock.runFor(2000);assert.equal((await page.evaluate(wireState)).time,paused.time);
  assert.equal(await page.locator('[data-countdown]').innerText(),'Paused');
  await page.evaluate(()=>document.querySelector('[data-an-play]').click());
  assert.equal(await page.locator('[data-countdown]').innerText(),'00:18');
  await page.clock.runFor(18020);
  await page.waitForFunction(()=>document.querySelector('.an-stage').dataset.transition==='enter');
  assert.equal((await page.evaluate(wireState)).state,'running');
  await page.waitForFunction(()=>document.querySelector('.an-stage').dataset.transition==='idle');
  assert.notEqual(await page.locator('.an-stage').getAttribute('data-thread'),first);
  assert.equal(await page.locator('[data-countdown]').innerText(),'00:18');
  // Reset geometry at the wrap: second set's final edge lands exactly at the first set's origin.
  const loop=await page.evaluate(()=>{
   const track=document.querySelector('[data-wire-track]'),a=track.getAnimations()[0],duration=a.effect.getTiming().duration;
   a.pause();a.currentTime=duration-.01;
   const before=track.children[1].getBoundingClientRect().left;
   a.currentTime=duration+.01;
   const after=track.children[0].getBoundingClientRect().left;
   a.play();return{delta:Math.abs(before-after),copies:track.children.length};
  });assert.equal(loop.copies,2);assert.ok(loop.delta<.1);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.runFor(50);
  await page.waitForFunction(()=>document.getElementById('symf-anime-broadcast').classList.contains('an-motion-muted'));
  assert.equal((await page.evaluate(wireState)).state,undefined);assert.equal(await page.locator('[data-countdown]').innerText(),'Still');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.clock.runFor(50);
  await page.waitForFunction(()=>document.querySelector('[data-wire-track]').getAnimations()[0]?.playState==='running');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal((await page.evaluate(wireState)).state,'paused');
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>document.querySelector('[data-wire-track]').getAnimations()[0]?.playState==='running');
  await page.evaluate(()=>document.getElementById('symf-anime-broadcast').style.marginTop='1800px');
  await page.waitForFunction(()=>document.querySelector('[data-wire-track]').getAnimations()[0]?.playState==='paused');
  await page.evaluate(()=>document.getElementById('symf-anime-broadcast').style.marginTop='');
  await page.waitForFunction(()=>document.querySelector('[data-wire-track]').getAnimations()[0]?.playState==='running');
  // A separate clock-controlled page verifies recurring display fetches, then fail-closed expiry.
  const polling=await browser.newPage({viewport:{width:1920,height:1080}});
  polling.on('pageerror',e=>errors.push(e.message));await polling.clock.install({time:new Date(now)});
  await polling.goto(base+'/program');await polling.waitForFunction(()=>document.querySelector('[data-token-cap]').textContent==='$26.1K');
  const reads=tokenReads;currentQuote={...quote,marketCapUsd:29123,fetchedAt:now+30000};
  await polling.clock.runFor(30500);
  await polling.waitForFunction(()=>document.querySelector('[data-token-cap]').textContent==='$29.1K');assert.equal(tokenReads,reads+1);
  tokenStatus=503;await polling.clock.runFor(30500);
  await polling.waitForFunction(()=>document.querySelector('.an-token-rail').dataset.quoteState==='cached');assert.equal(await polling.locator('[data-token-cap]').innerText(),'$29.1K');assert.match(await polling.locator('[data-token-asof]').innerText(),/last good/);
  tokenStatus=200;
  currentQuote={...quote,fetchedAt:now-11*60000};await polling.clock.runFor(30500);
  await polling.waitForFunction(()=>document.querySelector('[data-token-cap]').textContent==='--');
  assert.equal(await polling.locator('[data-token-mint]').innerText(),mint);
  assert.equal(await polling.locator('[data-token-asof]').innerText(),'Quote unavailable');
  currentQuote=quote;
  const reader=await browser.newPage({viewport:{width:1920,height:1080}});await reader.clock.install({time:new Date(now)});
  const longItem={...items[0],body:'Complete analysis and verified context. '.repeat(35)};
  await reader.route('**/api/feed',r=>r.fulfill({json:{...feed,items:[longItem]}}));
  await reader.goto(base+'/program');await reader.waitForFunction(()=>document.querySelector('[data-story-page]').textContent.startsWith('Page 1 /'));
  assert.equal(await reader.getByRole('link',{name:'SYMF community on Telegram: t.me/symforum'}).getAttribute('href'),'https://t.me/symforum');
  const firstText=await reader.locator('[data-story-excerpt]').innerText();assert.ok(firstText.length>300);assert.ok(!await reader.getByText('Read the discussion').count());
  await reader.clock.runFor(18020);await reader.waitForFunction(()=>document.querySelector('.an-stage').dataset.page==='2'&&document.querySelector('.an-stage').dataset.transition==='idle');
  assert.equal(await reader.locator('.an-stage').getAttribute('data-thread'),longItem.id);
  assert.match(await reader.locator('[data-story-link]').innerText(),/^forum\.symbaiex\.com\/projects\//);
  const layouts=[];for(const [width,height] of [[1920,1080],[1920,1200],[3456,1996],[1366,768],[1280,1024]]){
   await reader.setViewportSize({width,height});await reader.clock.runFor(50);
   const size=await reader.evaluate(()=>{const stage=document.querySelector('.an-stage').getBoundingClientRect(),dock=document.querySelector('.an-station-dock').getBoundingClientRect(),rail=document.querySelector('.an-token-rail').getBoundingClientRect(),paper=document.querySelector('.an-paper').getBoundingClientRect(),wire=document.querySelector('.an-news-wire').getBoundingClientRect(),header=document.querySelector('.an-header').getBoundingClientRect(),telegram=document.querySelector('.an-token-telegram').getBoundingClientRect();return{height:innerHeight,stageBottom:stage.bottom,dockBottom:dock.bottom,railHeight:rail.height,wireTop:wire.top,wireHeaderOverlap:wire.bottom>header.top+1,telegramInside:telegram.left>=rail.left&&telegram.right<=rail.right&&telegram.bottom<=rail.bottom+1,overlap:paper.bottom>dock.top+1,horizontalOverflow:document.documentElement.scrollWidth>innerWidth};});
   assert.ok(Math.abs(size.stageBottom-height)<1);assert.ok(Math.abs(size.dockBottom-height)<1);assert.ok(size.railHeight<=Math.max(68,width*.036));assert.equal(size.overlap||size.horizontalOverflow||size.wireHeaderOverlap,false);assert.ok(Math.abs(size.wireTop)<1);assert.equal(size.telegramInside,true);layouts.push({width,height,...size});
  }
  await reader.route('**/api/feed',r=>r.fulfill({json:{...feed,items:[{...longItem,authorIsAgent:false}]}}));
  await reader.goto(base+'/program');await reader.waitForFunction(()=>document.querySelector('[data-an-frame=status]').hidden===false);assert.equal(await reader.locator('.an-stage').getAttribute('data-thread'),'');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({tickerMoving:true,seamlessWrap:loop.delta<.1,countdownAndSceneAdvance:true,pause:true,reducedMotion:true,offscreenPause:true,hiddenPause:true,quoteRefresh30s:true,transientQuotePreserved:true,expiredQuoteUnavailable:true,agentRootPaged:true,memberSnapshotRejected:true,layouts,errors}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
