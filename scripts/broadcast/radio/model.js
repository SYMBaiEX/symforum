export const fraction=(value,max)=>Number.isFinite(value)&&Number.isFinite(max)&&max>0?Math.max(0,Math.min(1,value/max)):0;
export const clock=value=>{const s=Math.max(0,Math.floor(Number.isFinite(value)?value:0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
export const nextIndex=(i,count)=>(i+1)%count;
export function bufferedFraction(ranges,duration,current){let end=current;for(let i=0;i<ranges.length;i++)if(ranges.start(i)<=current+.1&&ranges.end(i)>=current)end=Math.max(end,ranges.end(i));return fraction(end,duration);}
export function crossfadeGains(progress){const x=fraction(progress,1);return [Math.cos(x*Math.PI/2),Math.sin(x*Math.PI/2)];}
export function queueRows(tracks,index,state,mixing=false){
 const next=nextIndex(index,tracks.length);
 return tracks.map((track,i)=>({...track,isCurrent:i===index,isNext:i===next&&i!==index,label:i===index?({playing:'Playing',paused:'Paused',buffering:'Buffering',blocked:'Blocked',error:'Unavailable',loading:'Loading'})[state]||'Paused':i===next?(mixing?'Mixing in':'Up next'):'In rotation'}));
}
export function audioEnergy(samples){
 if(!samples.length)return 0;
 let total=0;for(const value of samples)total+=value*value;
 return Math.min(1,Math.sqrt(total/samples.length)*9);
}
export function spectrumLevels(bins,sampleRate,fftSize,count=32){
 const maxHz=Math.min(12000,sampleRate/2),minHz=55,levels=[];
 for(let i=0;i<count;i++){
  const low=Math.max(1,Math.floor(minHz*Math.pow(maxHz/minHz,i/count)*fftSize/sampleRate));
  const high=Math.max(low+1,Math.ceil(minHz*Math.pow(maxHz/minHz,(i+1)/count)*fftSize/sampleRate));
  let sum=0,n=0;for(let k=low;k<Math.min(high,bins.length);k++){sum+=bins[k]/255;n++;}
  levels.push(n?Math.max(0,Math.min(1,sum/n)):0);
 }
 return levels;
}
