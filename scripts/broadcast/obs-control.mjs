// Local-only setup and recording diagnostics. Intentionally has no StartStream command.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';

const root=path.join(process.env.LOCALAPPDATA,'SYMF-Broadcast');
const configRoot=path.join(process.env.APPDATA,'obs-studio');
const configPath=path.join(configRoot,'plugin_config','obs-websocket','config.json');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const program='https://symf-broadcast.solsymbaiex.workers.dev/program';
const radio='http://127.0.0.1:4471/?output=obs';
const action=process.argv[2]||'status';
if(!['status','destination-status','encoder-status','whip-compatibility','refresh-radio','radio-configure','radio-status','privacy-audit','privacy-lock','inspect-profile','restore-profile','cleanup-validation','refresh-browser','configure','canary','screenshot'].includes(action))throw new Error('Unsupported local-only action');
if(!config.auth_required||!config.server_password||config.server_port!==4458)throw new Error('Dedicated authenticated control configuration required');
const pending=new Map();
const socket=new WebSocket('ws://127.0.0.1:4458');
const base64=value=>createHash('sha256').update(value).digest('base64');
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('OBS local control connection timed out')),12000);
 socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('OBS local control connection failed'));});
 socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.op===0){
   if(!message.d.authentication){clearTimeout(timer);reject(new Error('OBS authentication unexpectedly disabled'));socket.close();return;}
   const {salt,challenge}=message.d.authentication;
   socket.send(JSON.stringify({op:1,d:{rpcVersion:1,eventSubscriptions:0,authentication:base64(base64(config.server_password+salt)+challenge)}}));
  }else if(message.op===2){clearTimeout(timer);resolve();}
  else if(message.op===7){const p=pending.get(message.d.requestId);if(!p)return;clearTimeout(p.timer);pending.delete(message.d.requestId);if(message.d.requestStatus.result)p.resolve(message.d.responseData||{});else p.reject(new Error('OBS request failed: '+message.d.requestType+' ('+message.d.requestStatus.code+')'));}
 });
});
function request(requestType,requestData={}){
 return new Promise((resolve,reject)=>{const requestId=randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('OBS request timed out: '+requestType));},10000);pending.set(requestId,{resolve,reject,timer});socket.send(JSON.stringify({op:6,d:{requestType,requestId,requestData}}));});
}
async function status(){
 const [version,video,stream,record,stats,scenes]=await Promise.all(['GetVersion','GetVideoSettings','GetStreamStatus','GetRecordStatus','GetStats','GetSceneList'].map(type=>request(type)));
 return{obsVersion:version.obsVersion,video,streaming:stream.outputActive,recording:record.outputActive,stats,scene:scenes.currentProgramSceneName};
}
async function waitProfile(name){
 for(let i=0;i<50;i++){if((await request('GetProfileList')).currentProfileName===name){await sleep(250);return;}await sleep(100);}
 throw new Error('Dedicated profile did not finish switching');
}
async function screenshot(){
 const result=await request('GetSourceScreenshot',{sourceName:'SYMF Live',imageFormat:'png',imageWidth:1920,imageHeight:1080});
 const target=path.join(root,'program-preview.png');fs.writeFileSync(target,Buffer.from(result.imageData.split(',')[1],'base64'));return target;
}
try{
 let profile=await request('GetProfileList');
 if(action==='inspect-profile'){console.log(JSON.stringify({profile,video:await request('GetVideoSettings')}));socket.close();process.exit(0);}
 if(action==='restore-profile'){
  if(profile.currentProfileName!=='SYMF'&&!profile.currentProfileName.startsWith('SYMF-Validation-'))throw new Error('Not an owned validation profile');
  if((await request('GetStreamStatus')).outputActive||(await request('GetRecordStatus')).outputActive)throw new Error('Outputs are active; will not switch profiles');
  await request('SetCurrentProfile',{profileName:'SYMF'});await waitProfile('SYMF');console.log(JSON.stringify({restored:true,profile:(await request('GetProfileList')).currentProfileName}));socket.close();process.exit(0);
 }
 if(profile.currentProfileName!=='SYMF')throw new Error('Refusing to change a non-SYMF OBS profile');
 const readonlyActions=['status','destination-status','encoder-status','radio-status','privacy-audit','screenshot'];
 if((await request('GetStreamStatus')).outputActive&&!readonlyActions.includes(action))throw new Error('Live streaming is active; setup will not touch it');
 if(action==='destination-status'){
  const {streamServiceType,streamServiceSettings:s}=await request('GetStreamServiceSettings');
  let serverProtocol=null,serverHost=null;try{const url=new URL(s?.server);serverProtocol=url.protocol;serverHost=url.hostname;}catch{}
  // Never emit the server path, query, userinfo, stream key or raw settings.
  console.log(JSON.stringify({service:streamServiceType,hasServer:!!s?.server,hasKey:!!s?.key,hasBearerToken:!!s?.bearer_token,serverProtocol,serverHost,...await status()}));
 }else if(action==='encoder-status'){
  const mode=await request('GetProfileParameter',{parameterCategory:'Output',parameterName:'Mode'});
  const encoder=await request('GetProfileParameter',{parameterCategory:'AdvOut',parameterName:'Encoder'});
  const s=JSON.parse(fs.readFileSync(path.join(configRoot,'basic','profiles','SYMF','streamEncoder.json'),'utf8'));
  console.log(JSON.stringify({mode:mode.parameterValue,encoder:encoder.parameterValue,rateControl:s.rate_control,bitrate:s.bitrate,keyframeSeconds:s.keyint_sec,preset:s.preset,bFrames:s.bf,repeatHeaders:s.repeat_headers,...await status()}));
 }else if(action==='whip-compatibility'){
  if((await request('GetRecordStatus')).outputActive)throw Error('Recording active; defer compatibility change');
  const before=await request('GetStreamServiceSettings');
  if(before.streamServiceType!=='whip_custom'||!before.streamServiceSettings?.bearer_token||new URL(before.streamServiceSettings.server).hostname!=='pump-prod-tg2x8veh.whip.livekit.cloud')throw Error('Unexpected WHIP destination; refuse to change it');
  const encoderFile=path.join(configRoot,'basic','profiles','SYMF','streamEncoder.json'),s=JSON.parse(fs.readFileSync(encoderFile,'utf8'));
  if(!fs.existsSync(encoderFile+'.before-whip-compat.json'))fs.copyFileSync(encoderFile,encoderFile+'.before-whip-compat.json');
  fs.writeFileSync(encoderFile+'.tmp',JSON.stringify({...s,bf:0,repeat_headers:true}));fs.renameSync(encoderFile+'.tmp',encoderFile);
  await request('SetProfileParameter',{parameterCategory:'AdvOut',parameterName:'ApplyServiceSettings',parameterValue:'true'});
  const temporary='SYMF-Validation-'+randomUUID();
  await request('CreateProfile',{profileName:temporary});await waitProfile(temporary);
  await request('SetCurrentProfile',{profileName:'SYMF'});await waitProfile('SYMF');
  await request('RemoveProfile',{profileName:temporary});
  const after=await request('GetStreamServiceSettings');
  if(after.streamServiceType!==before.streamServiceType||after.streamServiceSettings.server!==before.streamServiceSettings.server||after.streamServiceSettings.bearer_token!==before.streamServiceSettings.bearer_token)throw Error('Destination verification failed; do not start');
  const saved=JSON.parse(fs.readFileSync(encoderFile,'utf8'));
  if(saved.bf!==0||saved.repeat_headers!==true)throw Error('WHIP encoder correction not retained');
  console.log(JSON.stringify({corrected:true,bFrames:0,repeatHeaders:true,credentialsUnchanged:true,...await status()}));
 }else if(action==='refresh-radio'){
  if((await request('GetRecordStatus')).outputActive)throw Error('Recording active; defer radio refresh');
  if((await request('GetInputSettings',{inputName:'NyX Radio'})).inputSettings.url!==radio)throw Error('Unexpected radio source');
  await request('PressInputPropertiesButton',{inputName:'NyX Radio',propertyName:'refreshnocache'});
  await sleep(5000);
  console.log(JSON.stringify({refreshed:true,radio:await(await fetch('http://127.0.0.1:4471/state')).json(),preview:await screenshot(),...await status()}));
 }else if(action==='radio-status'){
  const response=await fetch('http://127.0.0.1:4471/state',{signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw Error('Local radio unavailable');
  console.log(JSON.stringify({radio:await response.json(),...await status()}));
 }else if(action==='radio-configure'){
  if((await request('GetRecordStatus')).outputActive)throw Error('Recording active; defer music setup');
  const inputs=(await request('GetInputList')).inputs,items=(await request('GetSceneItemList',{sceneName:'SYMF Live'})).sceneItems;
  if(inputs.some(i=>!['Forum Broadcast','NyX Radio'].includes(i.inputName)||i.inputKind!=='browser_source')||items.some(i=>!['Forum Broadcast','NyX Radio'].includes(i.sourceName))||Object.values(await request('GetSpecialInputs')).some(Boolean))throw Error('Unexpected source topology; inspect before music setup');
  if((await request('GetSceneList')).currentProgramSceneName!=='SYMF Live')throw Error('Unexpected active scene');
  if((await request('GetInputSettings',{inputName:'Forum Broadcast'})).inputSettings.url!==program)throw Error('Unexpected forum URL');
  const health=await fetch('http://127.0.0.1:4471/health',{signal:AbortSignal.timeout(3000)});
  if(!health.ok||(await health.json()).trackCount!==3)throw Error('Expected three prepared radio tracks');
  const settings={url:radio,width:1920,height:1080,fps:30,fps_custom:true,shutdown:false,restart_when_active:false,webpage_control_level:0,reroute_audio:true};
  if(inputs.some(i=>i.inputName==='NyX Radio')){
   if((await request('GetInputSettings',{inputName:'NyX Radio'})).inputSettings.url!==radio)throw Error('Unexpected radio URL');
   await request('SetInputSettings',{inputName:'NyX Radio',inputSettings:settings,overlay:true});
  }else await request('CreateInput',{sceneName:'SYMF Live',inputName:'NyX Radio',inputKind:'browser_source',inputSettings:settings,sceneItemEnabled:true});
  for(const name of ['Forum Broadcast','NyX Radio']){
   const music=name==='NyX Radio';
   await request('SetInputMute',{inputName:name,inputMuted:!music});
   await request('SetInputAudioMonitorType',{inputName:name,monitorType:'OBS_MONITORING_TYPE_NONE'});
   await request('SetInputAudioTracks',{inputName:name,inputAudioTracks:{'1':music,'2':false,'3':false,'4':false,'5':false,'6':false}});
   const {sceneItemId}=await request('GetSceneItemId',{sceneName:'SYMF Live',sourceName:name});
   await request('SetSceneItemEnabled',{sceneName:'SYMF Live',sceneItemId,sceneItemEnabled:true});
   await request('SetSceneItemLocked',{sceneName:'SYMF Live',sceneItemId,sceneItemLocked:true});
  }
  await request('SetInputVolume',{inputName:'NyX Radio',inputVolumeDb:0});
  const {sceneItemId}=await request('GetSceneItemId',{sceneName:'SYMF Live',sourceName:'NyX Radio'});
  await request('SetSceneItemIndex',{sceneName:'SYMF Live',sceneItemId,sceneItemIndex:1});
  await sleep(5000);
  const receipt=await (await fetch('http://127.0.0.1:4471/state')).json();
  if(receipt.stale||receipt.state!=='playing'||!receipt.contextRunning)throw Error('Music configured but playback not verified; inspect radio-status');
  console.log(JSON.stringify({configured:true,radio:receipt,preview:await screenshot(),...await status()}));
 }else if(action==='privacy-lock'){
  if((await request('GetRecordStatus')).outputActive)throw new Error('Recording is active; defer privacy changes');
  const inputs=(await request('GetInputList')).inputs;
  const items=(await request('GetSceneItemList',{sceneName:'SYMF Live'})).sceneItems;
  const special=await request('GetSpecialInputs');
  if(inputs.length!==1||inputs[0].inputName!=='Forum Broadcast'||inputs[0].inputKind!=='browser_source'||items.length!==1||items[0].sourceName!=='Forum Broadcast'||Object.values(special).some(Boolean))throw new Error('Unexpected input topology; inspect manually before changing');
  const {inputSettings:s}=await request('GetInputSettings',{inputName:'Forum Broadcast'});
  if(s.url!==program)throw new Error('Unexpected browser source URL');
  await request('SetInputMute',{inputName:'Forum Broadcast',inputMuted:true});
  await request('SetInputAudioMonitorType',{inputName:'Forum Broadcast',monitorType:'OBS_MONITORING_TYPE_NONE'});
  await request('SetInputAudioTracks',{inputName:'Forum Broadcast',inputAudioTracks:{'1':false,'2':false,'3':false,'4':false,'5':false,'6':false}});
  const mute=await request('GetInputMute',{inputName:'Forum Broadcast'});
  const tracks=await request('GetInputAudioTracks',{inputName:'Forum Broadcast'});
  if(!mute.inputMuted||Object.values(tracks.inputAudioTracks).some(Boolean))throw new Error('Audio isolation verification failed');
  console.log(JSON.stringify({isolated:true,mute,tracks,...await status()}));
 }else if(action==='privacy-audit'){
  const inputs=(await request('GetInputList')).inputs;
  const details=[];
  for(const input of inputs){
   const item={name:input.inputName,kind:input.inputKind};
   for(const [key,type] of [['mute','GetInputMute'],['tracks','GetInputAudioTracks'],['monitor','GetInputAudioMonitorType']]){
    try{item[key]=await request(type,{inputName:input.inputName});}catch{item[key]={notApplicable:true};}
   }
   if(input.inputName==='Forum Broadcast'){
    const {inputSettings:s}=await request('GetInputSettings',{inputName:input.inputName});
    item.browser={url:s.url,width:s.width,height:s.height,reroute_audio:s.reroute_audio,webpage_control_level:s.webpage_control_level};
   }
   if(input.inputName==='NyX Radio'){
    const {inputSettings:s}=await request('GetInputSettings',{inputName:input.inputName});
    item.browser={url:s.url,width:s.width,height:s.height,reroute_audio:s.reroute_audio,webpage_control_level:s.webpage_control_level};
    item.volume=await request('GetInputVolume',{inputName:input.inputName});
   }
   details.push(item);
  }
  const virtualCamera=await request('GetVirtualCamStatus').catch(()=>({unavailable:true}));
  console.log(JSON.stringify({profile:profile.currentProfileName,special:await request('GetSpecialInputs'),items:(await request('GetSceneItemList',{sceneName:'SYMF Live'})).sceneItems.map(i=>({name:i.sourceName,kind:i.inputKind,enabled:i.sceneItemEnabled,isGroup:i.isGroup})),inputs:details,virtualCamera,...await status()}));
 }else if(action==='refresh-browser'){
  if((await request('GetRecordStatus')).outputActive)throw new Error('Recording is active; defer browser-source refresh');
  await request('PressInputPropertiesButton',{inputName:'Forum Broadcast',propertyName:'refreshnocache'});
  await sleep(10000);console.log(JSON.stringify({refreshed:true,preview:await screenshot(),...await status()}));
 }else if(action==='cleanup-validation'){
  if((await request('GetRecordStatus')).outputActive)throw new Error('A recording is active; defer setup cleanup');
  const temporary=profile.profiles.filter(name=>name.startsWith('SYMF-Validation-'));
  for(const name of temporary){await request('RemoveProfile',{profileName:name});for(let i=0;i<50;i++){if(!(await request('GetProfileList')).profiles.includes(name))break;await sleep(100);}}
  const final=await request('GetProfileList');if(final.currentProfileName!=='SYMF'||final.profiles.some(name=>name.startsWith('SYMF-Validation-')))throw new Error('Validation profile cleanup did not finish');
  console.log(JSON.stringify({removedTemporaryProfiles:temporary.length,activeProfile:final.currentProfileName}));
 }else if(action==='configure'){
  const destination=await request('GetStreamServiceSettings');
  if(destination.streamServiceSettings?.key||destination.streamServiceSettings?.bearer_token||destination.streamServiceSettings?.server)throw new Error('Destination already configured; setup will not erase its credentials');
  const health=await fetch(new URL('/health',program),{signal:AbortSignal.timeout(10000)});if(!health.ok)throw new Error('Cloudflare public feed is not ready');
  await request('SetVideoSettings',{baseWidth:1920,baseHeight:1080,outputWidth:1920,outputHeight:1080,fpsNumerator:30,fpsDenominator:1});
  const scenes=await request('GetSceneList');if(!scenes.scenes.some(s=>s.sceneName==='SYMF Live'))await request('CreateScene',{sceneName:'SYMF Live'});
  const settings={url:program,width:1920,height:1080,fps:30,fps_custom:true,shutdown:false,restart_when_active:false,webpage_control_level:0,reroute_audio:true};
  const inputs=await request('GetInputList');
  if(inputs.inputs.some(i=>i.inputName==='Forum Broadcast'))await request('SetInputSettings',{inputName:'Forum Broadcast',inputSettings:settings,overlay:true});
  else await request('CreateInput',{sceneName:'SYMF Live',inputName:'Forum Broadcast',inputKind:'browser_source',inputSettings:settings,sceneItemEnabled:true});
  await request('SetInputMute',{inputName:'Forum Broadcast',inputMuted:true});
  const special=await request('GetSpecialInputs');for(const name of Object.values(special).filter(Boolean))await request('SetInputMute',{inputName:name,inputMuted:true});
  await request('SetCurrentProgramScene',{sceneName:'SYMF Live'});
  await request('SetStreamServiceSettings',{streamServiceType:'rtmp_custom',streamServiceSettings:{server:'',key:'',use_auth:false}});
  // Explicit keyframe spacing is needed for RTMP; Simple mode leaves NVENC on auto-GOP.
  const encoderFile=path.join(configRoot,'basic','profiles','SYMF','streamEncoder.json');
  if(fs.existsSync(encoderFile)&&!fs.existsSync(encoderFile+'.before-symf-tuning.json'))fs.copyFileSync(encoderFile,encoderFile+'.before-symf-tuning.json');
  fs.writeFileSync(encoderFile+'.tmp',JSON.stringify({rate_control:'CBR',bitrate:4500,keyint_sec:2,preset:'p5',tuning:'hq',multipass:'qres',profile:'high',lookahead:false,bf:2,psycho_aq:true,gpu:0}));
  fs.renameSync(encoderFile+'.tmp',encoderFile);
  for(const [parameterCategory,parameterName,parameterValue] of [['Output','Mode','Advanced'],['Output','Reconnect','true'],['Output','RetryDelay','5'],['Output','MaxRetries','1000000'],['AdvOut','Encoder','obs_nvenc_h264_tex'],['AdvOut','AudioEncoder','ffmpeg_aac'],['AdvOut','TrackIndex','1'],['AdvOut','Track1Bitrate','128'],['AdvOut','ApplyServiceSettings','false'],['AdvOut','Rescale','false'],['AdvOut','RecType','Standard'],['AdvOut','RecEncoder','none'],['AdvOut','RecAudioEncoder','none'],['AdvOut','RecTracks','1'],['AdvOut','RecFormat2','mkv'],['AdvOut','RecFilePath',path.join(root,'recordings')]])await request('SetProfileParameter',{parameterCategory,parameterName,parameterValue});
  // Reload only this private, inactive output profile; no app restart or stream replay.
  const temporaryProfile='SYMF-Validation-'+randomUUID();
  await request('CreateProfile',{profileName:temporaryProfile});
  await waitProfile(temporaryProfile);
  await request('SetCurrentProfile',{profileName:'SYMF'});
  await waitProfile('SYMF');
  await request('RemoveProfile',{profileName:temporaryProfile});
  await waitProfile('SYMF');
  await request('SetVideoSettings',{baseWidth:1920,baseHeight:1080,outputWidth:1920,outputHeight:1080,fpsNumerator:30,fpsDenominator:1});
  await request('SetRecordDirectory',{recordDirectory:path.join(root,'recordings')});
  await sleep(10000);
  console.log(JSON.stringify({configured:true,programUrl:program,preview:await screenshot(),...await status()}));
 }else if(action==='canary'){
  if((await request('GetRecordStatus')).outputActive)throw new Error('A recording is already active; do not interrupt it');
  const before=await request('GetStats');let started=false;
  try{
   await request('StartRecord');started=true;await sleep(45000);
   const stats=await request('GetStats'),record=await request('StopRecord');started=false;
   const stream=await request('GetStreamStatus');if(stream.outputActive)throw new Error('Unexpected stream state during local recording test');
   // OBS resets output counters when a new recording starts, unlike render counters.
   console.log(JSON.stringify({localOnly:true,recordingPath:record.outputPath,preview:await screenshot(),delta:{renderFrames:stats.renderTotalFrames-before.renderTotalFrames,renderSkipped:stats.renderSkippedFrames-before.renderSkippedFrames,outputFrames:stats.outputTotalFrames,outputSkipped:stats.outputSkippedFrames},...await status()}));
  }finally{if(started)await request('StopRecord').catch(()=>{});}
 }else if(action==='screenshot')console.log(JSON.stringify({preview:await screenshot()}));
 else console.log(JSON.stringify(await status()));
}finally{socket.close();}
