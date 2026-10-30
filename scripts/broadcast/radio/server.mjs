import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const code=path.dirname(fileURLToPath(import.meta.url));
export function createRadioServer(mediaDir){
 const manifest=JSON.parse(fs.readFileSync(path.join(mediaDir,'playlist.json'),'utf8'));
 if(!Array.isArray(manifest.tracks)||manifest.tracks.length<1||manifest.tracks.length>12)throw Error('Invalid bounded playlist');
 const files=new Map([['/','player.html'],['/player.css','player.css'],['/player.js','player.js'],['/model.js','model.js']]);
 const media=new Map([['/nyx.webp','nyx.webp']]);
 for(const t of manifest.tracks){if(!/^[a-z0-9-]+\.m4a$/.test(t.file)||!Number.isFinite(t.duration)||t.duration<30||t.duration>900||!t.title||t.title.length>90)throw Error('Invalid track');media.set('/'+t.file,t.file);}
 let playback={state:'not_connected',updatedAt:0};
 const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.m4a':'audio/mp4'};
 return http.createServer(async(req,res)=>{
  const allowedHost=/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||'');
  const headers={'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(), geolocation=(), display-capture=()','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'Cross-Origin-Resource-Policy':'same-origin'};
  const end=(status,data,type='text/plain')=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(data);};
  if(!allowedHost)return end(403,'Loopback only');
  const url=new URL(req.url,'http://'+req.headers.host);
  if(url.pathname==='/heartbeat'&&req.method==='POST'){
   if(req.headers.origin!=='http://'+req.headers.host||req.headers['content-type']!=='application/json')return end(403,'Origin required');
   try{
    let data='';for await(const chunk of req){data+=chunk;if(data.length>2048){req.destroy();return;}}
    const value=JSON.parse(data),track=manifest.tracks.find(t=>t.id===value.trackId);
    if(!track||!['playing','paused','buffering','blocked','error'].includes(value.state)||!Number.isFinite(value.elapsed)||value.elapsed<0||value.elapsed>track.duration+2)throw Error('Invalid playback');
    playback={trackId:track.id,title:track.title,state:value.state,elapsed:value.elapsed,duration:track.duration,contextRunning:value.contextRunning===true,signal:value.signal===true,crossfading:value.crossfading===true,cameraAllowed:typeof value.cameraAllowed==='boolean'?value.cameraAllowed:null,microphoneAllowed:typeof value.microphoneAllowed==='boolean'?value.microphoneAllowed:null,updatedAt:Date.now()};
    return end(204,'');
   }catch{return end(400,'Invalid heartbeat');}
  }
  if(!['GET','HEAD'].includes(req.method))return end(405,'Read only');
  if(url.pathname==='/health')return end(200,JSON.stringify({ready:true,trackCount:manifest.tracks.length}), 'application/json');
  if(url.pathname==='/state')return end(200,JSON.stringify({...playback,stale:Date.now()-playback.updatedAt>6000}), 'application/json');
  if(url.pathname==='/playlist.json')return end(200,JSON.stringify(manifest),'application/json');
  const staticFile=files.get(url.pathname),mediaFile=media.get(url.pathname);
  if(!staticFile&&!mediaFile)return end(404,'Not found');
  const target=path.join(staticFile?code:mediaDir,staticFile||mediaFile);
  try{
   const size=fs.statSync(target).size;let start=0,endByte=size-1,status=200;
   if(req.headers.range){
    const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if(!match)return end(416,'Invalid range');
    start=Number(match[1]);endByte=match[2]?Number(match[2]):size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(endByte)||start> endByte||start>=size||endByte>=size)return end(416,'Invalid range');
    status=206;headers['Content-Range']=`bytes ${start}-${endByte}/${size}`;
   }
   res.writeHead(status,{...headers,'Content-Type':types[path.extname(target)],'Content-Length':endByte-start+1,'Accept-Ranges':'bytes'});
   if(req.method==='HEAD')return res.end();
   const stream=fs.createReadStream(target,{start,end:endByte});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch{if(!res.headersSent)end(404,'Not found');else res.destroy();}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const media=process.env.SYMF_RADIO_MEDIA||path.join(process.env.LOCALAPPDATA||'','SYMF-Broadcast','audio');
 createRadioServer(media).listen(4471,'127.0.0.1',()=>console.log('SYMF Radio listening on loopback:4471'));
}
