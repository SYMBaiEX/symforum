import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
test('installed OBS controller and launcher no longer depend on portable files',()=>{
 const control=read('obs-control.mjs'),show=read('show-obs.ps1');
 assert.match(control,/configRoot=path\.join\(process\.env\.APPDATA,'obs-studio'\)/);
 assert.doesNotMatch(control,/obs-33\.0\.0/);assert.doesNotMatch(show,/--portable/);
 assert.match(show,/ProgramFiles 'obs-studio\\bin\\64bit\\obs64.exe'/);
 assert.doesNotMatch(control,/request\('StartStream'/);
});
test('migration preserves partial destinations and requires recoverable exact-target cleanup',()=>{
 const script=read('migrate-installed-obs.ps1');
 assert.match(script,/\[bool\]\$s.settings.key -or \[bool\]\$s.settings.server/);
 assert.match(script,/credentialHashPreserved=/);assert.match(script,/installed-config/);assert.match(script,/portable-config/);
 assert.match(script,/CloseMainWindow/);assert.doesNotMatch(script,/Stop-Process|Remove-Item|--startstreaming/i);
 assert.match(script,/RecycleOption\]::SendToRecycleBin/);assert.match(script,/ReparsePoint/);
 assert.match(script,/Existing SYMF configuration must not be overwritten/);
});
test('WHIP compatibility repair keeps credentials and applies WebRTC-safe H264 settings',()=>{
 const control=read('obs-control.mjs');
 assert.match(control,/bf:0,repeat_headers:true/);
 assert.match(control,/parameterName:'ApplyServiceSettings',parameterValue:'true'/);
 assert.match(control,/after.streamServiceSettings.bearer_token!==before.streamServiceSettings.bearer_token/);
 assert.match(control,/destination.streamServiceSettings\?\.bearer_token/);
 assert.match(control,/readonlyActions.includes\(action\)/);
});
test('public start is explicit, purpose-bound, preflighted, and never retries an uncertain outcome',()=>{
 const live=read('obs-pump-live.mjs');
 assert.match(live,/mode==='--start-authorized'&&!state.outputActive/);
 assert.match(live,/const checked=await preflight\(\)/);
 assert.match(live,/Prior start outcome uncertain; inspect without retry/);
 assert.match(live,/cameraAllowed!==false\|\|radio.microphoneAllowed!==false/);
 assert.match(live,/pump-prod-tg2x8veh\.whip\.livekit\.cloud/);
 assert.match(live,/inputs.length!==2\|\|items.length!==2/);
 assert.equal((live.match(/request\('StartStream'\)/g)||[]).length,1);
 assert.doesNotMatch(live,/SetStreamServiceSettings|SetInputSettings|StartVirtualCam/);
});
