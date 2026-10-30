import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createRadioServer} from './server.mjs';
import {clock,fraction,nextIndex,bufferedFraction,crossfadeGains,queueRows,audioEnergy,spectrumLevels} from './model.js';

test('music clock, playlist wrap, bounded progress and equal-power crossfade',()=>{
 assert.equal(clock(360),'6:00');assert.equal(clock(NaN),'0:00');assert.equal(fraction(120,100),1);assert.equal(fraction(-2,100),0);assert.equal(nextIndex(2,3),0);
 for(const x of [0,.1,.5,.9,1]){const [a,b]=crossfadeGains(x);assert.ok(Math.abs(a*a+b*b-1)<1e-10);}
 assert.equal(bufferedFraction({length:2,start:i=>[0,80][i],end:i=>[50,100][i]},100,10),.5);
});
test('playlist labels track the actual state, next song, crossfade and final-song wrap',()=>{
 const tracks=['After Hours','Neon Harbor','Moonlit Archive'].map((title,i)=>({id:String(i),title}));
 let rows=queueRows(tracks,0,'playing');assert.deepEqual(rows.map(r=>r.label),['Playing','Up next','In rotation']);assert.equal(rows.filter(r=>r.isCurrent).length,1);
 rows=queueRows(tracks,2,'paused');assert.deepEqual(rows.map(r=>r.label),['Up next','In rotation','Paused']);
 rows=queueRows(tracks,2,'playing',true);assert.deepEqual(rows.map(r=>r.label),['Mixing in','In rotation','Playing']);
 for(const state of ['blocked','buffering','error'])assert.notEqual(queueRows(tracks,0,state)[0].label,'Playing');
 assert.deepEqual(queueRows([],0,'paused'),[]);
});
test('audio visualization is bounded, uses the signal and is flat for silence',()=>{
 assert.equal(audioEnergy(new Float32Array(2048)),0);assert.equal(audioEnergy([]),0);assert.equal(audioEnergy([1,-1]),1);assert.ok(audioEnergy([.02,-.02])>0);
 assert.ok(spectrumLevels(new Uint8Array(1024),48000,2048).every(x=>x===0));
 const bins=new Uint8Array(1024).fill(255),levels=spectrumLevels(bins,48000,2048);assert.equal(levels.length,32);assert.ok(levels.every(x=>x>=0&&x<=1));assert.ok(levels.some(x=>x>0));
});
test('music panels share the light-glass palette with readable reactive accents',()=>{
 const css=fs.readFileSync(new URL('./player.css',import.meta.url),'utf8');
 const player=fs.readFileSync(new URL('./player.js',import.meta.url),'utf8');
 assert.match(css,/color-scheme: light/);assert.match(css,/--ink: #14263a/);
 assert.match(css,/\.player, \.queue \{[\s\S]*?background: var\(--card-surface\)/);
 assert.match(css,/\.is-current \{ background: #ffffff70; color: var\(--ink\)/);
 assert.match(css,/background: #f5f7fb; backdrop-filter: none/);
 assert.match(player,/getPropertyValue\('--spectrum-low'\)/);assert.match(player,/pen\.fillStyle=i<16\?spectrumLow:spectrumHigh/);
 assert.doesNotMatch(css,/#19364d|#112338|#14283e/);
});
test('loopback radio exposes only declared assets and safe bounded playback metadata',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'symf-radio-test-'));
 fs.writeFileSync(path.join(dir,'playlist.json'),JSON.stringify({tracks:[{id:'a',file:'after-hours.m4a',title:'After Hours',duration:180}]}));
 fs.writeFileSync(path.join(dir,'after-hours.m4a'),'0123456789');fs.writeFileSync(path.join(dir,'secret.txt'),'must-not-leak');
 const server=createRadioServer(dir);server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{
  let r=await fetch(base+'/');assert.equal(r.status,200);assert.match(r.headers.get('permissions-policy'),/camera=\(\), microphone=\(\)/);assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
  r=await fetch(base+'/secret.txt');assert.equal(r.status,404);
  r=await fetch(base+'/after-hours.m4a',{headers:{range:'bytes=2-4'}});assert.equal(r.status,206);assert.equal(await r.text(),'234');assert.equal(r.headers.get('content-range'),'bytes 2-4/10');
  assert.equal((await fetch(base+'/after-hours.m4a',{headers:{range:'bytes=20-30'}})).status,416);
  assert.equal((await fetch(base+'/after-hours.m4a',{headers:{range:'bytes=0-1,3-4'}})).status,416);
  assert.equal((await fetch(base+'/player.js',{method:'DELETE'})).status,405);
  const data={trackId:'a',state:'playing',elapsed:12,contextRunning:true,signal:true};
  assert.equal((await fetch(base+'/heartbeat',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify(data)})).status,403);
  assert.equal((await fetch(base+'/heartbeat',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({...data,elapsed:99999})})).status,400);
  assert.equal((await fetch(base+'/heartbeat',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(data)})).status,204);
  const state=await (await fetch(base+'/state')).json();assert.equal(state.title,'After Hours');assert.equal(state.elapsed,12);assert.equal(state.signal,true);assert.equal(state.stale,false);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
