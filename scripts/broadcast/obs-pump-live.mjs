// Purpose-bound operator: one explicit public-start command, never an autostart task.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
const root=path.join(process.env.LOCALAPPDATA,'SYMF-Broadcast'),configRoot=path.join(process.env.APPDATA,'obs-studio');
const config=JSON.parse(fs.readFileSync(path.join(configRoot,'plugin_config','obs-websocket','config.json'),'utf8'));
const mode=process.argv[2]||'--check';
if(!['--check','--start-authorized','--status'].includes(mode))throw Error('Unsupported operation');
if(!config.auth_required||config.server_port!==4458||!config.server_password)throw Error('Authenticated local control required');
const pending=new Map(),socket=new WebSocket('ws://127.0.0.1:4458');
const hash=v=>createHash('sha256').update(v).digest('base64');
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('Local control timeout')),10000);
 socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Local control unavailable'));});
 socket.addEventListener('message',event=>{
  const m=JSON.parse(event.data);
  if(m.op===0){if(!m.d.authentication){clearTimeout(timer);reject(Error('Authentication required'));socket.close();return;}const {salt,challenge}=m.d.authentication;socket.send(JSON.stringify({op:1,d:{rpcVersion:1,eventSubscriptions:0,authentication:hash(hash(config.server_password+salt)+challenge)}}));}
  else if(m.op===2){clearTimeout(timer);resolve();}
  else if(m.op===7){const p=pending.get(m.d.requestId);if(!p)return;clearTimeout(p.timer);pending.delete(m.d.requestId);m.d.requestStatus.result?p.resolve(m.d.responseData||{}):p.reject(Error('OBS request failed: '+m.d.requestType+' ('+m.d.requestStatus.code+')'));}
 });
});
function request(requestType,requestData={}){return new Promise((resolve,reject)=>{const requestId=randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(Error('OBS request timeout: '+requestType));},10000);pending.set(requestId,{resolve,reject,timer});socket.send(JSON.stringify({op:6,d:{requestType,requestId,requestData}}));});}
async function preflight(){
 if((await request('GetProfileList')).currentProfileName!=='SYMF'||(await request('GetSceneList')).currentProgramSceneName!=='SYMF Live')throw Error('Wrong profile or program scene');
 const inputs=(await request('GetInputList')).inputs,items=(await request('GetSceneItemList',{sceneName:'SYMF Live'})).sceneItems;
 const expected=['Forum Broadcast','NyX Radio'];
 if(inputs.length!==2||items.length!==2||inputs.some(i=>i.inputKind!=='browser_source'||!expected.includes(i.inputName))||items.some(i=>!expected.includes(i.sourceName)||!i.sceneItemEnabled||i.isGroup)||Object.values(await request('GetSpecialInputs')).some(Boolean))throw Error('Capture isolation failed');
 for(const name of expected){
  const music=name==='NyX Radio',s=(await request('GetInputSettings',{inputName:name})).inputSettings;
  if(s.url!==(music?'http://127.0.0.1:4471/?output=obs':'https://symf-broadcast.solsymbaiex.workers.dev/program')||s.width!==1920||s.height!==1080||!s.reroute_audio)throw Error('Unexpected browser source');
  if((await request('GetInputMute',{inputName:name})).inputMuted===music)throw Error('Unexpected mute state');
  const tracks=(await request('GetInputAudioTracks',{inputName:name})).inputAudioTracks;
  if(Object.entries(tracks).some(([key,value])=>value!==(music&&key==='1')))throw Error('Unexpected audio routing');
  if((await request('GetInputAudioMonitorType',{inputName:name})).monitorType!=='OBS_MONITORING_TYPE_NONE')throw Error('Audio monitoring must be off');
 }
 if((await request('GetVirtualCamStatus')).outputActive)throw Error('Virtual camera must be off');
 const radio=await(await fetch('http://127.0.0.1:4471/state',{signal:AbortSignal.timeout(3000)})).json();
 if(radio.stale||radio.state!=='playing'||!radio.contextRunning||!radio.signal||radio.cameraAllowed!==false||radio.microphoneAllowed!==false)throw Error('Music or browser protection not ready');
 const {streamServiceType,streamServiceSettings:s}=await request('GetStreamServiceSettings');
 const url=new URL(s?.server);
 if(streamServiceType!=='whip_custom'||url.protocol!=='https:'||url.hostname!=='pump-prod-tg2x8veh.whip.livekit.cloud'||url.username||url.password||!s.bearer_token)throw Error('Unexpected Pump.fun WHIP destination');
 const encoder=JSON.parse(fs.readFileSync(path.join(configRoot,'basic','profiles','SYMF','streamEncoder.json'),'utf8'));
 if(encoder.bf!==0||encoder.repeat_headers!==true)throw Error('WHIP encoder not compatible');
 let claimMintMatch=false;
 try{const claims=JSON.parse(Buffer.from(s.bearer_token.split('.')[1],'base64url').toString('utf8'));claimMintMatch=JSON.stringify(claims).includes('5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump');}catch{}
 return {isolated:true,musicPlaying:true,cameraBlocked:true,microphoneBlocked:true,destinationHost:url.hostname,claimMintMatch};
}
try{
 const checked=await preflight();
 let state=await request('GetStreamStatus');
 if(mode==='--start-authorized'&&!state.outputActive){
  const marker=path.join(root,'pumpfun-live-attempt-20261028.json');
  if(fs.existsSync(marker)&&JSON.parse(fs.readFileSync(marker,'utf8')).outcome==='unknown')throw Error('Prior start outcome uncertain; inspect without retry');
  fs.writeFileSync(marker,JSON.stringify({at:Date.now(),outcome:'unknown'}));
  // No automatic retry. A failed/ambiguous request leaves its marker held.
  await request('StartStream');
  for(let i=0;i<15;i++){await sleep(1000);state=await request('GetStreamStatus');if(state.outputActive)break;}
  fs.writeFileSync(marker,JSON.stringify({at:Date.now(),outcome:state.outputActive?'active':'inactive'}));
 }
 console.log(JSON.stringify({...checked,streaming:state.outputActive,reconnecting:state.outputReconnecting,outputBytes:state.outputBytes,outputDurationMs:state.outputDuration,droppedFrames:state.outputSkippedFrames,totalFrames:state.outputTotalFrames}));
}finally{socket.close();}
