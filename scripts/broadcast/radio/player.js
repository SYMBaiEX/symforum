import {fraction,clock,nextIndex,bufferedFraction,crossfadeGains,queueRows,audioEnergy,spectrumLevels} from './model.js';
const $=selector=>document.querySelector(selector),output=new URLSearchParams(location.search).get('output')==='obs';
document.body.classList.toggle('output',output);
const panel=$('.player'),decks=[...document.querySelectorAll('audio')],context=new AudioContext(),analyser=context.createAnalyser(),master=context.createGain();
analyser.fftSize=2048;analyser.smoothingTimeConstant=.7;master.gain.value=.4;master.connect(analyser);analyser.connect(context.destination);
const gains=decks.map(audio=>{const gain=context.createGain();gain.gain.value=0;context.createMediaElementSource(audio).connect(gain);gain.connect(master);return gain;});
const bars=new Uint8Array(analyser.frequencyBinCount),samples=new Float32Array(analyser.fftSize),canvas=$('canvas'),pen=canvas.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
const pulse=$('.art-pulse'),queue=$('[data-queue]');
const theme=getComputedStyle(document.documentElement),spectrumLow=theme.getPropertyValue('--spectrum-low').trim(),spectrumHigh=theme.getPropertyValue('--spectrum-high').trim();
let queueKey='',queueElements=[],visible=true,smoothedEnergy=0;
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;}).observe($('.radio-dock'));
let playlist,trackIndex=0,active=0,transition=null,state='loading',lastTick=0,lastHeartbeat=0,lastSave=0,signal=false,started=false;
const current=()=>decks[active],track=()=>playlist.tracks[trackIndex];
const featureAllowed=name=>{try{const policy=document.permissionsPolicy||document.featurePolicy;return policy?policy.allowsFeature(name):null;}catch{return null;}};
function updateQueue(){
 if(!playlist)return;
 const key=[trackIndex,state,!!transition].join(':');if(key===queueKey)return;queueKey=key;
 const rows=queueRows(playlist.tracks,trackIndex,state,!!transition);
 for(let i=0;i<rows.length;i++){
  const row=rows[i],el=queueElements[i];el.root.classList.toggle('is-current',row.isCurrent);el.root.classList.toggle('is-next',row.isNext);el.root.dataset.playing=String(row.isCurrent&&state==='playing');
  if(row.isCurrent)el.root.setAttribute('aria-current','true');else el.root.removeAttribute('aria-current');
  el.status.textContent=row.label;
 }
 $('[data-queue-summary]').textContent=transition?'Crossfading · continuous rotation':`NyX · ${playlist.tracks.length} originals · loop`;
}
function buildQueue(){
 queue.replaceChildren();queueElements=playlist.tracks.map((t,i)=>{
  const root=document.createElement('li'),number=document.createElement('span'),title=document.createElement('span'),status=document.createElement('span'),duration=document.createElement('span'),meter=document.createElement('span');
  number.className='queue-number';number.textContent=String(i+1).padStart(2,'0');title.className='queue-title';title.textContent=t.title;status.className='queue-status';duration.className='queue-duration';duration.textContent=clock(t.duration);meter.className='queue-meter';meter.setAttribute('aria-hidden','true');
  for(let k=0;k<3;k++)meter.append(document.createElement('i'));
  root.append(number,title,meter,status,duration);queue.append(root);return{root,status,bars:[...meter.children]};
 });updateQueue();
}
function setState(value){state=value;panel.dataset.state=value;$('[data-status]').textContent=({playing:'Now playing',paused:'Paused',buffering:'Buffering',blocked:'Playback needs attention',error:'Music unavailable',loading:'Connecting'})[value];$('[data-play]').textContent=value==='playing'?'Pause music':'Play music';updateQueue();}
function label(){const t=track();$('[data-title]').textContent=t.title;$('[data-index]').textContent=`${String(trackIndex+1).padStart(2,'0')} / ${String(playlist.tracks.length).padStart(2,'0')}`;$('[data-duration]').textContent=clock(t.duration);$('[data-seek]').value=String(Math.round(fraction(current().currentTime,t.duration)*100));updateQueue();}
function persist(){if(!started)return;try{localStorage.setItem('nyx-radio-v1',JSON.stringify({id:track().id,time:current().currentTime}));}catch{}}
function loadDeck(deck,index){deck.src='/'+playlist.tracks[index].file;deck.load();}
async function play(){try{await context.resume();await current().play();if(context.state!=='running')throw Error('Audio context suspended');started=true;setState('playing');}catch{setState('blocked');}}
function pause(){transition=null;decks.forEach(a=>a.pause());gains.forEach((g,i)=>{g.gain.cancelScheduledValues(context.currentTime);g.gain.value=i===active?1:0;});setState('paused');persist();}
function finishTransition(){if(!transition)return;const old=active;active=1-active;trackIndex=nextIndex(trackIndex,playlist.tracks.length);decks[old].pause();gains[old].gain.value=0;gains[active].gain.value=1;transition=null;label();loadDeck(decks[old],nextIndex(trackIndex,playlist.tracks.length));if(!current().paused&&current().readyState>=3)setState('playing');$('[data-transition]').textContent='';persist();}
async function crossfade(){
 if(transition||state!=='playing')return;
 const incoming=decks[1-active],next=nextIndex(trackIndex,playlist.tracks.length);
 if(incoming.readyState<3)return;
 transition={starting:true};
 try{incoming.currentTime=0;await incoming.play();transition={start:context.currentTime,duration:Math.min(6,Math.max(1,track().duration-current().currentTime))};$('[data-transition]').textContent='Blending → '+playlist.tracks[next].title;updateQueue();}
 catch{transition=null;setState('error');decks.forEach(a=>a.pause());}
}
function advance(){if(!playlist||transition)return;const wasPlaying=state==='playing';decks.forEach(a=>a.pause());trackIndex=nextIndex(trackIndex,playlist.tracks.length);loadDeck(current(),trackIndex);loadDeck(decks[1-active],nextIndex(trackIndex,playlist.tracks.length));label();if(wasPlaying)void play();else setState('paused');}
function draw(time){
 requestAnimationFrame(draw);if(time-lastTick<50||!playlist)return;lastTick=time;
 if(transition&&!transition.starting){const x=fraction(context.currentTime-transition.start,transition.duration),[outGain,inGain]=crossfadeGains(x);gains[active].gain.value=outGain;gains[1-active].gain.value=inGain;if(x>=1)finishTransition();}
 const audio=current(),duration=track().duration,elapsed=audio.currentTime,progress=fraction(elapsed,duration);
 if(state==='playing'&&!transition&&duration-elapsed<=6)void crossfade();
 $('[data-elapsed]').textContent=clock(elapsed);$('[data-progress]').style.transform=`scaleX(${progress})`;$('[data-buffer]').style.transform=`scaleX(${bufferedFraction(audio.buffered,duration,elapsed)})`;
 $('.rail').setAttribute('aria-valuenow',String(Math.round(progress*100)));
 if(document.activeElement!==$('[data-seek]'))$('[data-seek]').value=String(Math.round(progress*100));
 analyser.getByteFrequencyData(bars);signal=state==='playing'&&context.state==='running'&&bars.some(x=>x>12);
 if(visible&&!document.hidden){
  analyser.getFloatTimeDomainData(samples);const energy=signal&&!reduced.matches?audioEnergy(samples):0;
  smoothedEnergy+=(energy-smoothedEnergy)*(energy>smoothedEnergy?.5:.14);
  pulse.style.opacity=String(signal&&!reduced.matches?.15+smoothedEnergy*.5:0);pulse.style.transform=`scale(${1+smoothedEnergy*.09})`;
  panel.dataset.reactive=String(signal&&!reduced.matches);
  const levels=spectrumLevels(bars,context.sampleRate,analyser.fftSize);
  pen.clearRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<levels.length;i++){const amplitude=signal&&!reduced.matches?levels[i]:0,h=Math.max(3,amplitude*82);pen.fillStyle=i<16?spectrumLow:spectrumHigh;pen.beginPath();pen.roundRect(i*10+2,48-h/2,4,h,2);pen.fill();}
  for(let i=0;i<queueElements.length;i++)queueElements[i].bars.forEach((bar,k)=>{const value=i===trackIndex&&signal&&!reduced.matches?levels[3+k*5]:0;bar.style.transform=`scaleY(${.16+value*.84})`;});
 }
 if(time-lastSave>5000){persist();lastSave=time;}
 if(output&&time-lastHeartbeat>2000){lastHeartbeat=time;fetch('/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trackId:track().id,state:state==='loading'?'buffering':state,elapsed:current().currentTime,contextRunning:context.state==='running',signal,crossfading:!!transition,cameraAllowed:featureAllowed('camera'),microphoneAllowed:featureAllowed('microphone')})}).catch(()=>{});}
}
decks.forEach(audio=>{
 audio.addEventListener('waiting',()=>{if(audio===current()&&started)setState('buffering');});
 audio.addEventListener('playing',()=>{if(audio===current())setState('playing');});
 audio.addEventListener('error',()=>{if(audio===current()){setState('error');decks.forEach(a=>a.pause());}});
 audio.addEventListener('ended',()=>{if(audio!==current())return;if(transition&&!transition.starting)finishTransition();else{trackIndex=nextIndex(trackIndex,playlist.tracks.length);loadDeck(audio,trackIndex);loadDeck(decks[1-active],nextIndex(trackIndex,playlist.tracks.length));label();void play();}});
});
$('[data-play]').addEventListener('click',()=>state==='playing'?pause():void play());$('[data-next]').addEventListener('click',advance);
$('[data-seek]').addEventListener('input',event=>{if(playlist&&!transition)current().currentTime=fraction(Number(event.target.value),100)*Math.max(0,track().duration-1);});
addEventListener('pagehide',persist);
try{
 const response=await fetch('/playlist.json');if(!response.ok)throw Error('Playlist unavailable');playlist=await response.json();
 let saved;try{saved=JSON.parse(localStorage.getItem('nyx-radio-v1'));}catch{}
 const index=playlist.tracks.findIndex(t=>t.id===saved?.id);if(index>=0)trackIndex=index;
 loadDeck(decks[active],trackIndex);loadDeck(decks[1-active],nextIndex(trackIndex,playlist.tracks.length));gains[active].gain.value=1;
 if(index>=0&&Number.isFinite(saved.time)&&saved.time>0&&saved.time<track().duration-10)decks[active].addEventListener('loadedmetadata',()=>{decks[active].currentTime=saved.time;},{once:true});
 buildQueue();label();setState('paused');requestAnimationFrame(draw);if(output)void play();
}catch{setState('error');}
