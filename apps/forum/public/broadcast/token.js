/* One verified mint, shared read-only quote, and a persistent on-air identity rail. */
(function(scope){
  'use strict';
  const MINT='5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump';
  const SOURCE='DEX Screener';
  const ENDPOINT='https://api.dexscreener.com/tokens/v1/solana/'+MINT;
  const PAIR_ENDPOINT='https://api.dexscreener.com/latest/dex/pairs/solana/BqkubRUbgk13q1imaVhKkSVZqrBoVXGc5LJi8JCL8CZr';
  const MAX_AGE=10*60*1000;
  const address=value=>typeof value==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  function unavailable(){return{mint:MINT,symbol:'SYMF',marketCapUsd:null,fetchedAt:0,source:SOURCE,status:'unavailable'};}
  function select(pairs,now=Date.now()){
    if(!Array.isArray(pairs))return unavailable();
    const eligible=pairs.slice(0,100).filter(p=>p&&p.chainId==='solana'&&p.baseToken?.address===MINT&&p.baseToken?.symbol==='SYMF'&&address(p.pairAddress)&&typeof p.marketCap==='number'&&Number.isFinite(p.marketCap)&&p.marketCap>0&&p.marketCap<=1e15&&typeof p.liquidity?.usd==='number'&&Number.isFinite(p.liquidity.usd)&&p.liquidity.usd>0);
    eligible.sort((a,b)=>b.liquidity.usd-a.liquidity.usd||a.pairAddress.localeCompare(b.pairAddress));
    const pair=eligible[0];
    if(!pair)return unavailable();
    // FDV is deliberately NOT a fallback for missing marketCap.
    return{mint:MINT,symbol:'SYMF',marketCapUsd:pair.marketCap,fetchedAt:now,source:SOURCE,status:'reported',pairAddress:pair.pairAddress,sourceUrl:'https://dexscreener.com/solana/'+pair.pairAddress};
  }
  function valid(quote,now=Date.now()){
    return !!quote&&quote.mint===MINT&&quote.symbol==='SYMF'&&quote.source===SOURCE&&quote.status==='reported'&&typeof quote.marketCapUsd==='number'&&Number.isFinite(quote.marketCapUsd)&&quote.marketCapUsd>0&&quote.marketCapUsd<=1e15&&Number.isFinite(quote.fetchedAt)&&quote.fetchedAt<=now+5000&&now-quote.fetchedAt<=MAX_AGE&&address(quote.pairAddress)&&quote.sourceUrl==='https://dexscreener.com/solana/'+quote.pairAddress;
  }
  function formatUsd(value){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0)return'--';
    if(value===0)return'$0.00';
    if(value<.01)return'<$0.01';
    const units=[[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'K']];
    const unit=units.find(([limit])=>value>=limit);
    return unit?'$'+new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value/unit[0])+unit[1]:new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
  }
  async function load(fetcher=fetch){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);
    try{
      async function read(endpoint,pairRoute=false){
        const r=await fetcher(endpoint,{credentials:'omit',cache:'no-store',headers:{Accept:'application/json','User-Agent':'SYMF-Broadcast/1.0 (+https://forum.symbaiex.com)'},signal:controller.signal});
        if(!r.ok){
          const retry=r.headers?.get?.('Retry-After'),delay=retry&&/^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-Date.now();
          const retryAfterAt=r.status===429&&Number.isFinite(delay)&&delay>0&&delay<=86400000?Date.now()+delay:undefined;
          throw Object.assign(new Error('Quote unavailable'),{code:'provider_http',status:r.status,retryAfterAt});
        }
        const raw=await r.text();if(raw.length>500000)throw Object.assign(new Error('Quote response too large'),{code:'provider_response_too_large'});
        let data;try{data=JSON.parse(raw);}catch{throw Object.assign(new Error('Invalid quote response'),{code:'provider_invalid_json'});}
        return select(pairRoute?data?.pairs:data);
      }
      try{return await read(ENDPOINT);}catch(error){
        // One bounded alternate public route; never retry rate limits, denials or invalid identity.
        if(controller.signal.aborted||error?.code==='provider_response_too_large'||(error?.code==='provider_http'&&error.status<500))throw error;
        return await read(PAIR_ENDPOINT,true);
      }
    }finally{clearTimeout(timeout);}
  }
  function start(root){
    const rail=root.querySelector('.an-token-rail');if(!rail)return;
    const cap=rail.querySelector('[data-token-cap]'),stamp=rail.querySelector('[data-token-asof]'),link=rail.querySelector('[data-token-mint]');
    link.textContent=MINT;link.href='https://pump.fun/coin/'+MINT;
    let quote=unavailable(),stopped=false,timer,lastAttemptFailed=false;
    function render(){
      const ready=valid(quote),cached=ready&&(lastAttemptFailed||Number.isFinite(quote.refreshFailedAt));cap.textContent=ready?formatUsd(quote.marketCapUsd):'--';
      const caption=rail.querySelector('[data-token-caption]');if(caption)caption.textContent=cached?'Last known MC':'Market cap';
      cap.setAttribute('aria-label',ready?'Reported market cap '+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(quote.marketCapUsd):'Market cap unavailable');
      cap.dataset.raw=ready?new Intl.NumberFormat('en-US',{useGrouping:false,maximumSignificantDigits:21}).format(quote.marketCapUsd):'';
      if(stamp)stamp.textContent=ready?SOURCE+(cached?' · last good ':' · fetched ')+new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit',timeZone:'America/Chicago',timeZoneName:'short'}).format(new Date(quote.fetchedAt)):'Quote unavailable';
      rail.dataset.quoteState=ready?(cached?'cached':'reported'):'unavailable';
    }
    async function refresh(){
      try{
        const r=await fetch('/api/token',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(6000)});
        if(!r.ok)throw new Error('No current quote');
        const raw=await r.text();if(raw.length>4000)throw new Error('Quote too large');
        const next=JSON.parse(raw);quote=valid(next)?next:unavailable();lastAttemptFailed=false;
      }catch{lastAttemptFailed=true;if(!valid(quote))quote=unavailable();}
      if(!stopped){render();timer=setTimeout(refresh,30000);}
    }
    render();refresh();
    // Copying just the abbreviated value yields the source precision, not "$28.9K".
    document.addEventListener('copy',event=>{const selection=getSelection();if(cap.dataset.raw&&event.clipboardData&&selection&&cap.contains(selection.anchorNode)&&cap.contains(selection.focusNode)&&selection.toString()===cap.textContent){event.clipboardData.setData('text/plain',cap.dataset.raw);event.preventDefault();}});
    const guard=setInterval(()=>{if(!valid(quote))render();},15000);
    return()=>{stopped=true;clearTimeout(timer);clearInterval(guard);};
  }
  scope.SymfToken={MINT,SOURCE,MAX_AGE,unavailable,select,valid,formatUsd,load,start};
})(globalThis);
