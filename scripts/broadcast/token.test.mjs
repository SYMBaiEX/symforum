import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../../apps/forum/public/broadcast/token.js';
import worker,{refreshToken} from '../../workers/broadcast/worker.mjs';
const api=globalThis.SymfToken;
const now=1793156500000;
const pair={chainId:'solana',pairAddress:'BqkubRUbgk13q1imaVhKkSVZqrBoVXGc5LJi8JCL8CZr',baseToken:{address:api.MINT,symbol:'SYMF'},liquidity:{usd:10000},marketCap:29444,fdv:30000};
test('only the exact Solana mint is selected, with deepest eligible liquidity',()=>{
 const result=api.select([{...pair,baseToken:{address:'8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS',symbol:'SYMF'},liquidity:{usd:1e9}},pair,{...pair,pairAddress:'So11111111111111111111111111111111111111112',liquidity:{usd:20000},marketCap:31000}],now);
 assert.equal(result.marketCapUsd,31000);assert.equal(result.mint,api.MINT);assert.equal(api.valid(result,now),true);
});
test('FDV never substitutes for missing or invalid market cap',()=>{
 for(const marketCap of [undefined,null,0,-1,NaN,Infinity,1e20,'30000'])assert.equal(api.select([{...pair,marketCap}],now).status,'unavailable');
 for(const change of [{chainId:'ethereum'},{liquidity:{usd:0}},{pairAddress:'../bad'},{baseToken:{address:api.MINT,symbol:'FAKE'}}])assert.equal(api.select([{...pair,...change}],now).status,'unavailable');
});
test('stale, future, wrong-source and unsafe-link snapshots fail closed',()=>{
 const quote=api.select([pair],now);
 for(const change of [{fetchedAt:now-11*60000},{fetchedAt:now+10000},{mint:'wrong'},{source:'fake'},{sourceUrl:'javascript:alert(1)'}])assert.equal(api.valid({...quote,...change},now),false);
 assert.equal(api.valid(null,now),false);
});
test('USD display covers zero, tiny values, compact units and invalid inputs',()=>{
 for(const value of [null,undefined,NaN,Infinity,-1])assert.equal(api.formatUsd(value),'--');
 for(const [value,expected] of [[0,'$0.00'],[-0,'$0.00'],[.004,'<$0.01'],[12.3,'$12.30'],[1234.5,'$1.2K'],[29444,'$29.4K'],[1520000000000,'$1.5T']])assert.equal(api.formatUsd(value),expected);
});
test('public quote read is bounded, anonymous and uses one fixed free endpoint',async()=>{
 let calls=0;
 const quote=await api.load(async(url,opts)=>{calls++;assert.equal(url,'https://api.dexscreener.com/tokens/v1/solana/'+api.MINT);assert.equal(opts.credentials,'omit');assert.equal(opts.headers.Authorization,undefined);assert.equal(opts.headers.Accept,'application/json');assert.match(opts.headers['User-Agent'],/^SYMF-Broadcast\//);return{ok:true,text:async()=>JSON.stringify([pair])};});
 assert.equal(calls,1);assert.equal(quote.status,'reported');
 await assert.rejects(()=>api.load(async()=>({ok:false})));
 await assert.rejects(()=>api.load(async()=>({ok:true,text:async()=>'x'.repeat(500001)})));
});
test('provider failures are safely classified without raw response bodies',async()=>{
 await assert.rejects(()=>api.load(async()=>({ok:false,status:429})),e=>e.code==='provider_http'&&e.status===429);
 await assert.rejects(()=>api.load(async()=>({ok:true,text:async()=>'<html>upstream unavailable</html>'})),e=>e.code==='provider_invalid_json'&&!e.message.includes('<html>'));
});
test('token cache fails closed independently of the forum cache',async()=>{
 const data=new Map(),env={FORUM_FEED:{async get(k){return data.get(k)||null;},async put(k,v){data.set(k,JSON.parse(v));}}};
 let response=await worker.fetch(new Request('https://example.com/api/token'),env);assert.equal(response.status,503);
 const quote=await refreshToken(env,async()=>({ok:true,text:async()=>JSON.stringify([pair])}));assert.equal(quote.status,'reported');
 response=await worker.fetch(new Request('https://example.com/api/token'),env);assert.equal(response.status,200);assert.equal((await response.json()).mint,api.MINT);
 const cached=await refreshToken(env,async()=>{throw new Error('provider failure');});assert.equal(cached.fetchedAt,quote.fetchedAt);assert.equal(cached.marketCapUsd,quote.marketCapUsd);assert.ok(cached.refreshFailedAt>=quote.fetchedAt);
 response=await worker.fetch(new Request('https://example.com/api/token'),env);assert.equal(response.status,200);assert.equal((await response.json()).fetchedAt,quote.fetchedAt);
 data.set('official-token-v1',{...quote,fetchedAt:Date.now()-11*60000});await refreshToken(env,async()=>{throw new Error('provider failure');});response=await worker.fetch(new Request('https://example.com/api/token'),env);assert.equal(response.status,503);assert.equal((await response.json()).marketCapUsd,null);
});
test('one fixed pair fallback recovers transport errors but never retries rate limits or denied requests',async()=>{
 let calls=0;const result=await api.load(async(url)=>{calls++;if(calls===1)return{ok:false,status:503};assert.match(url,/\/latest\/dex\/pairs\/solana\/Bqkub/);return{ok:true,text:async()=>JSON.stringify({pairs:[pair]})};});assert.equal(result.marketCapUsd,pair.marketCap);assert.equal(calls,2);
 for(const status of [401,403,429]){let denied=0;await assert.rejects(()=>api.load(async()=>{denied++;return{ok:false,status};}));assert.equal(denied,1);}
 let invalid=0;assert.equal((await api.load(async()=>{invalid++;return{ok:true,text:async()=>'[]'};})).status,'unavailable');assert.equal(invalid,1);
});
test('Retry-After postpones provider calls without renewing the last-good quote',async()=>{
 const original=api.select([pair]),data=new Map([['official-token-v1',original]]),env={FORUM_FEED:{async get(k){return data.get(k)||null;},async put(k,v){data.set(k,JSON.parse(v));}}};
 const cached=await refreshToken(env,async()=>({ok:false,status:429,headers:{get:()=> '600'}}));assert.equal(cached.fetchedAt,original.fetchedAt);assert.ok(cached.retryAfterAt>Date.now());
 const held=await refreshToken(env,async()=>{assert.fail('Provider backoff must be respected');});assert.equal(held.fetchedAt,original.fetchedAt);
});
test('static address and persistent rail agree with the shared mint',()=>{
 const html=fs.readFileSync('apps/forum/public/broadcast/index.html','utf8');
 assert.ok(html.includes('data-token-mint href="https://pump.fun/coin/'+api.MINT+'"'));assert.ok(html.includes('>'+api.MINT+'</a>'));
 assert.ok(html.indexOf('class="an-token-rail"')>html.indexOf('class="an-transition"'));assert.ok(!html.includes('8Ta68iep'));
});
