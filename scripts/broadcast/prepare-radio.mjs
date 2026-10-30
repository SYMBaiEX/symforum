// Preserve original WAVs; create level-matched streaming copies and provenance.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out||!path.isAbsolute(out))throw Error('An explicit absolute output folder is required');
fs.mkdirSync(out,{recursive:true});
const downloads=path.dirname(out);
const selections=[
 {id:'after-hours',title:'After Hours',input:'SYMF — After Hours.wav',sunoId:'dfc7b44f-573c-4507-b5e6-50ff28136db7',notes:'Warm Rhodes, soft guitar, late-night lo-fi jazzhop. 70 BPM.'},
 {id:'neon-harbor',title:'Neon Harbor',input:'Nyx — Neon Harbor.wav',sunoId:'cba4ac21-df79-4ddb-a409-cd0fdb2b5738',notes:'Nocturnal jazztronica, brushed breakbeats and muted guitar. 72 BPM.'},
 {id:'moonlit-archive',title:'Moonlit Archive',input:'Nyx — Moonlit Archive.wav',sunoId:'3a746d87-107d-4ac9-9e52-1ccd4828e567',notes:'Slow-bloom ambient soul, felt piano and vibraphone. 68 BPM.'},
];
const tracks=[];
for(const selection of selections){
 const source=path.join(downloads,selection.input),target=path.join(out,selection.id+'.m4a');
 if(fs.existsSync(target))throw Error('Prepared track already exists; preserve instead of overwriting: '+selection.id);
 const measured=spawnSync('ffmpeg',['-hide_banner','-i',source,'-af','loudnorm=I=-18:TP=-1.5:LRA=9:print_format=json','-f','null','-'],{encoding:'utf8',maxBuffer:2e6});
 if(measured.status!==0)throw Error('Loudness measurement failed: '+selection.id);
 const json=measured.stderr.slice(measured.stderr.lastIndexOf('{'));
 const stats=JSON.parse(json.slice(0,json.indexOf('}')+1));
 if(!Number.isFinite(Number(stats.input_i)))throw Error('Silent or invalid source: '+selection.id);
 const filter=`loudnorm=I=-18:TP=-1.5:LRA=9:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true,afade=t=in:st=0:d=0.05`;
 execFileSync('ffmpeg',['-v','error','-n','-i',source,'-af',filter,'-ar','48000','-ac','2','-c:a','aac','-b:a','256k','-movflags','+faststart','-metadata','title='+selection.title,'-metadata','artist=NyX','-metadata','album=After Hours Radio','-metadata','comment=Original AI-generated instrumental using Suno; downloaded under active Pro subscription.',target],{stdio:'inherit'});
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',target],{encoding:'utf8'}));
 const duration=Number(probe.format.duration);if(duration<30||duration>900)throw Error('Unexpected duration');
 const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 tracks.push({id:selection.id,title:selection.title,artist:'NyX',file:selection.id+'.m4a',duration,notes:selection.notes,sourceUrl:'https://suno.com/song/'+selection.sunoId,sourceSha256:hash(source),preparedSha256:hash(target),originalLufs:Number(stats.input_i)});
 console.log(JSON.stringify({prepared:selection.id,duration,originalLufs:Number(stats.input_i)}));
}
const manifest={version:1,title:'After Hours Radio',artist:'NyX',agentUrl:'https://forum.symbaiex.com/members/nyx',attribution:'Original AI-generated instrumentals using Suno, credited to the SYMBaiEX Forum agent NyX. Human-directed selection and mastering.',createdAt:new Date().toISOString(),commercialRightsBasis:'Generated and unlocked/downloaded under the user-confirmed active Suno Pro subscription. No third-party reference audio or artist imitation supplied.',rightsSource:'https://help.suno.com/en/articles/9601665',normalization:{targetLufs:-18,truePeakDb:-1.5},tracks};
fs.writeFileSync(path.join(out,'playlist.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({ready:true,trackCount:tracks.length,totalSeconds:tracks.reduce((sum,t)=>sum+t.duration,0)}));
