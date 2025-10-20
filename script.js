(() => {
  const PASSWORD = "0423594446";
  const LS_SYMBOL_LIMITS = "slot_symbol_limits_no_payout_v1";
  const LS_FORCE_RATE   = "slot_force_jackpot_rate_percent_v1";
  const LS_SESSION_WINS = "slot_session_wins_v1";
  const LS_SPIN_TIME    = "slot_spin_time_sec_v1";   // 🆕 拉霸時間(秒)

  // 相片池（使用者自選）
  let symbols = [];                 // {file,label,weight}
  let symbolLimits = {};            // {file:{maxWins,wins}}
  let spinning=false, spinInterval=null, isMuted=false, bag=[], plannedFinal=null;

  // 🆕 自動停止計時
  let pendingTimer = null;
  let pendingHit   = null;

  // DOM
  const img1 = document.getElementById("r1");
  const msg  = document.getElementById("msg");
  const muteBtn  = document.getElementById("muteBtn");
  const vol = document.getElementById("vol");
  const totalStat = document.getElementById("totalStat");
  const panelSpinBtn = document.getElementById("panelSpinBtn");
  const root = document.body;

  // 🆕 拉霸時間控制（若 HTML 沒放滑桿，仍以預設3秒運作）
  const spinTimeRange = document.getElementById("spinTimeRange");
  const spinTimeValue = document.getElementById("spinTimeValue");
  let spinTimeSec = (() => {
    const v = Number(localStorage.getItem(LS_SPIN_TIME));
    if (Number.isFinite(v)) return Math.max(0, Math.min(10, Math.floor(v)));
    return 3; // 預設 3s
  })();
  function syncSpinTimeUI() {
    if (spinTimeRange) spinTimeRange.value = String(spinTimeSec);
    if (spinTimeValue) spinTimeValue.textContent = String(spinTimeSec);
  }
  syncSpinTimeUI();
  spinTimeRange?.addEventListener("input", () => {
    const v = Math.max(0, Math.min(10, Math.floor(Number(spinTimeRange.value)||0)));
    spinTimeSec = v;
    localStorage.setItem(LS_SPIN_TIME, String(v));
    syncSpinTimeUI();
  });

  // 圖庫（Modal）
  const openGalleryBtn = document.getElementById("openGalleryBtn");
  const galleryModal   = document.getElementById("galleryModal");
  const closeGalleryBtn= document.getElementById("closeGalleryBtn");
  const galleryGrid    = document.getElementById("galleryGrid");
  const addBtn         = document.getElementById("addBtn");
  const clearAllBtn    = document.getElementById("clearAllBtn");
  const countText      = document.getElementById("countText");

  // 首次選圖層
  const overlay   = document.getElementById("pickerOverlay");
  const chooseBtn = document.getElementById("chooseBtn");
  const filePicker= document.getElementById("filePicker");

  // 隱藏檔案選擇器（新增）
  const addPicker = document.getElementById("addPicker");

  // 強制中獎機率(%)
  let FORCE_JACKPOT_RATE_PERCENT = (() => {
    const v = Number(localStorage.getItem(LS_FORCE_RATE));
    return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.floor(v))) : 20;
  })();

  // Session wins
  let sessionWins = Number(sessionStorage.getItem(LS_SESSION_WINS)) || 0;
  const incSessionWins = () => {
    sessionWins += 1;
    try { sessionStorage.setItem(LS_SESSION_WINS, String(sessionWins)); } catch(e){}
  };
  const resetSessionWins = () => {
    sessionWins = 0;
    try { sessionStorage.removeItem(LS_SESSION_WINS); } catch(e){}
  };
  const updateTotalStat = ()=> totalStat && (totalStat.textContent = `總連線中獎次數：${sessionWins}`);

  // 上限/次數
  function saveLimits(){ try{ localStorage.setItem(LS_SYMBOL_LIMITS, JSON.stringify(symbolLimits)); }catch(e){} }
  function loadLimitsFromSymbols(){
    let data = {};
    try{ data = JSON.parse(localStorage.getItem(LS_SYMBOL_LIMITS)||"{}"); }catch(e){ data={}; }
    symbols.forEach(s=>{ if(!data[s.file]) data[s.file]={maxWins:0,wins:0}; });
    symbolLimits = data; saveLimits();
  }
  const isBlocked = (file)=> {
    const lim = symbolLimits[file]; return lim && lim.maxWins>0 && lim.wins>=lim.maxWins;
  };

  // 權重抽樣袋
  const clampWeight = (v)=>{ v=Math.round(Number(v)||10); return Math.min(10, Math.max(1, v)); };
  function rebuildBag(){
    bag=[];
    symbols.forEach(s=>{
      if(isBlocked(s.file)) return;
      const w = clampWeight(s.weight ?? 10);
      for(let i=0;i<w;i++) bag.push(s);
    });
    if(bag.length===0) bag=[...symbols];
    updateSpinButtonState();
  }
  const pick = () => bag[Math.floor(Math.random()*bag.length)];

  // 預載
  const preload = list => Promise.all(list.map(s=>new Promise(res=>{
    const im=new Image(); im.onload=res; im.onerror=res; im.src=s.file;
  })));

  // 音效
  let ctx=null, masterGain=null, spinNodes=null;
  function ensureAudio(){
    if(!ctx){
      ctx = new (window.AudioContext||window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = (Number(vol?.value||70)/100)*0.8;
      masterGain.connect(ctx.destination);
    }
    if(ctx.state==="suspended") ctx.resume();
  }
  function sfxSpinStart(){
    if(isMuted) return; ensureAudio();
    const g=ctx.createGain(); g.gain.value=0.0001;
    const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=900;
    const o1=ctx.createOscillator(); o1.type="sawtooth"; o1.frequency.value=160;
    const o2=ctx.createOscillator(); o2.type="sawtooth"; o2.frequency.value=164; o2.detune.value=+6;
    o1.connect(g); o2.connect(g); g.connect(lp).connect(masterGain);
    const t=ctx.currentTime;
    g.gain.exponentialRampToValueAtTime((Number(vol?.value||70)/100)*0.08, t+0.12);
    o1.frequency.linearRampToValueAtTime(260, t+1.2);
    o2.frequency.linearRampToValueAtTime(266, t+1.2);
    o1.start(); o2.start(); spinNodes={o1,o2,g};
  }
  function sfxSpinStop(){
    if(!spinNodes||!ctx) return;
    const {o1,o2,g}=spinNodes; const t=ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.12);
    try{ o1.stop(t+0.15); o2.stop(t+0.15); }catch(e){}
    spinNodes=null;
  }
  function sfxWin(){
    if(isMuted) return; ensureAudio();
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type="triangle"; o.frequency.value=600; g.gain.value=0.0001; o.connect(g).connect(masterGain);
    const t=ctx.currentTime; o.start(t);
    g.gain.exponentialRampToValueAtTime((Number(vol?.value||70)/100)*0.3, t+0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.4); o.stop(t+0.45);
  }
  function sfxLose(){
    if(isMuted) return; ensureAudio();
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type="sine"; o.frequency.value=300; g.gain.value=0.0001;
    o.connect(g).connect(masterGain);              // ✅ 修正語法
    const t=ctx.currentTime; o.start(t);
    g.gain.exponentialRampToValueAtTime((Number(vol?.value||70)/100)*0.25, t+0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.35); o.stop(t+0.4);
  }
  function sfxHint(){
    if(isMuted) return; ensureAudio();
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type="square"; o.frequency.value=880; g.gain.value=0.0001; o.connect(g).connect(masterGain);
    const t=ctx.currentTime; o.start(t);
    g.gain.exponentialRampToValueAtTime((Number(vol?.value||70)/100)*0.18, t+0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.20); o.stop(t+0.22);
  }
  window.addEventListener("pointerdown", ()=>{ try{ ensureAudio(); }catch(e){} }, { once:true });
  vol?.addEventListener("input", ()=>{ if(masterGain) masterGain.gain.value=(Number(vol.value)/100)*0.8; });

  // 單格流程
  function updateSpinButtonState(){ panelSpinBtn?.classList.toggle('disabled', symbols.length<3); }
  function startReel(period){
    const el=img1;
    if (spinInterval) { clearInterval(spinInterval); spinInterval=null; }
    spinInterval = setInterval(()=>{ el.src=pick().file; }, period);
    el.classList.add("blur"); el.parentElement.classList.add("spin");
  }
  function stopReel(finalSymbol){
    if (spinInterval) { clearInterval(spinInterval); spinInterval=null; }
    img1.classList.remove("blur");
    img1.src=finalSymbol.file; img1.parentElement.classList.remove("spin");
  }
  function markWinSlot(on=true){
    const s = img1.parentElement;
    s.classList.toggle("win", on);
    if(on && navigator.vibrate) try{ navigator.vibrate([60,60,60]); }catch(e){}
    setTimeout(()=>s.classList.remove("win"),700);
  }

  // 🆕 統一的停止＋結算
  function stopAndFinishAt(finalSym, hit){
    if(!spinning) return;
    stopReel(finalSym);
    finish(hit, finalSym);
  }

  function startSpin(){
    if(spinning) return;
    if(symbols.length<3){ msg.className="message bad"; msg.textContent="請先加入至少 3 張照片（最多 10 張）。"; return; }
    spinning=true; msg.className="message"; msg.textContent="轉動中...";
    sfxSpinStart(); panelSpinBtn?.classList.add('press-glow','disabled');
    startReel(55);

    // 🆕 依設定秒數（0~10s，預設3s）自動停止
    const rate = Math.min(100, Math.max(0, Number(FORCE_JACKPOT_RATE_PERCENT)||0)) / 100;
    pendingHit   = Math.random() < rate;
    plannedFinal = pick();

    if(pendingTimer) { clearTimeout(pendingTimer); pendingTimer=null; }
    const delayMs = Math.max(0, Math.min(10, spinTimeSec)) * 1000;
    pendingTimer = setTimeout(()=>{ stopAndFinishAt(plannedFinal, pendingHit); }, delayMs);
  }

  function finish(hit, sym){
    if(pendingTimer){ clearTimeout(pendingTimer); pendingTimer=null; }
    sfxSpinStop(); spinning=false; panelSpinBtn?.classList.remove('disabled');

    if(hit){
      const lim = symbolLimits[sym.file] || {maxWins:0,wins:0};
      lim.wins=(lim.wins||0)+1; symbolLimits[sym.file]=lim; saveLimits();
      incSessionWins(); updateTotalStat();
      msg.className="message ok"; msg.textContent=`🎉 中獎！（第 ${lim.wins} 次）`;
      if(lim.maxWins>0 && lim.wins>=lim.maxWins) rebuildBag();
      const winsSpan = document.querySelector(`[data-file="${CSS?.escape?CSS.escape(sym.file):sym.file}"].wins`);
      if(winsSpan) winsSpan.textContent=String(lim.wins);
      root.classList.add("win-flash"); markWinSlot(true); setTimeout(()=>root.classList.remove("win-flash"),900); sfxWin();
    }else{
      msg.className="message bad"; msg.textContent="未中獎，再試一次！（Space）"; sfxLose();
    }
    setTimeout(()=>panelSpinBtn?.classList.remove('press-glow'),300);
  }

  function stopSpinManual(){
    if(!spinning) return;
    if(pendingTimer){ clearTimeout(pendingTimer); pendingTimer=null; }
    if(spinInterval) { clearInterval(spinInterval); spinInterval=null; }
    img1.classList.remove("blur"); img1.parentElement.classList.remove("spin");
    if(!plannedFinal){
      const f=(img1.getAttribute("src")||"");
      plannedFinal = symbols.find(s=>s.file===f) || {file:f,label:f,weight:1};
    } else {
      img1.src=plannedFinal.file;
    }
    const rate = Math.min(100, Math.max(0, Number(FORCE_JACKPOT_RATE_PERCENT)||0)) / 100;
    const hit = Math.random() < rate;
    finish(hit, plannedFinal);
  }

  document.addEventListener("keydown", e=>{
    if(e.code==="Space"){ e.preventDefault(); ensureAudio(); if(!spinning) startSpin(); else stopSpinManual(); }
    if(e.key==="Escape"){ hideGallery(); }
  });
  muteBtn?.addEventListener("click", ()=>{ isMuted=!isMuted; muteBtn.textContent = isMuted ? "🔇 聲音：關" : "🔊 聲音：開"; });
  panelSpinBtn?.addEventListener("click", ()=>{ ensureAudio(); if(!spinning) startSpin(); else stopSpinManual(); });

  // 參數面板
  const passInput=document.getElementById("passInput");
  const passBtn  =document.getElementById("passBtn");
  const passMsg  =document.getElementById("passMsg");
  const cfgHost  =document.getElementById("cfg");
  const cfgArea  =document.getElementById("cfgContainer");
  const passwordArea=document.getElementById("passwordArea");
  const resetWinsAllBtn=document.getElementById("resetWinsAllBtn");

  function renderForceRow(container){
    const old=container.querySelector('.force-row'); if(old) old.remove();
    const row=document.createElement("div"); row.className="size-row force-row";
    const label=document.createElement("label"); label.textContent="強制中獎機率(%)：";
    const input=document.createElement("input"); input.type="number"; input.min="0"; input.max="100"; input.step="1"; input.value=String(FORCE_JACKPOT_RATE_PERCENT);
    const setBtn=document.createElement("button"); setBtn.textContent="設定"; setBtn.className="btn mini";
    input.oninput=()=>{ let v=Math.floor(Number(input.value)||0); input.value=String(Math.max(0,Math.min(100,v))); };
    setBtn.onclick=()=>{ let v=Math.floor(Number(input.value)||0); v=Math.max(0,Math.min(100,v)); FORCE_JACKPOT_RATE_PERCENT=v; try{localStorage.setItem(LS_FORCE_RATE,String(v));}catch(e){} msg.textContent=`🎯 已設定強制中獎機率為 ${v}%`; };
    const resetBtn=document.createElement("button"); resetBtn.textContent="重置"; resetBtn.className="btn mini";
    resetBtn.onclick=()=>{ FORCE_JACKPOT_RATE_PERCENT=20; input.value="20"; try{localStorage.setItem(LS_FORCE_RATE,"20");}catch(e){} msg.textContent="🔄 已重置強制中獎機率為 20%"; };
    const tip=document.createElement("span"); tip.className="muted"; tip.textContent="（0 = 不啟用；預設 20）";
    row.append(label,input,setBtn,resetBtn,tip); container.prepend(row);
  }
  function renderConfig(){
    cfgHost.innerHTML=""; renderForceRow(cfgArea);
    ["人物","權重(1~10)","預覽","已中","上限","重置"].forEach(h=>{ const d=document.createElement("div"); d.className="hdr"; d.textContent=h; cfgHost.appendChild(d); });
    symbols.forEach((s,i)=>{
      const lim=symbolLimits[s.file]||{maxWins:0,wins:0};
      const n=document.createElement("div"); n.textContent=s.label||`照片${i+1}`;
      const w=document.createElement("input"); w.type="number"; w.min="1"; w.max="10"; w.step="1"; w.value=clampWeight(s.weight??10);
      w.oninput=()=>{ s.weight=clampWeight(w.value); w.value=s.weight; rebuildBag(); };
      const prev=document.createElement("div"); prev.className="prevBox"; prev.title=s.file; prev.innerHTML=`<img src="${s.file}" alt="">`;
      const wins=document.createElement("div"); wins.textContent=lim.wins||0; wins.className="wins"; wins.setAttribute("data-file", s.file);
      const maxIn=document.createElement("input"); maxIn.type="number"; maxIn.min="0"; maxIn.step="1"; maxIn.placeholder="0=不限"; maxIn.value=lim.maxWins>0?lim.maxWins:"";
      maxIn.oninput=()=>{ const v=Number(maxIn.value||0); if(!symbolLimits[s.file]) symbolLimits[s.file]={maxWins:0,wins:0}; symbolLimits[s.file].maxWins=v>0?Math.floor(v):0; saveLimits(); rebuildBag(); };
      const resetBtn=document.createElement("button"); resetBtn.className="btn mini"; resetBtn.textContent="重置";
      resetBtn.onclick=()=>{ symbolLimits[s.file]={maxWins:(Number(maxIn.value)||0), wins:0}; wins.textContent="0"; saveLimits(); rebuildBag(); updateTotalStat(); msg.textContent=`🧹 已重置「${s.label||`照片${i+1}`}」已中獎次數`; };
      cfgHost.append(n,w,prev,wins,maxIn,resetBtn);
    });
  }
  passBtn?.addEventListener("click", ()=>{ if(passInput.value===PASSWORD){ passMsg.textContent="✅ 密碼正確"; passwordArea.style.display="none"; cfgArea.style.display="block"; renderConfig(); } else { passMsg.textContent="❌ 密碼錯誤"; } });
  document.getElementById("applyBtn")?.addEventListener("click", ()=>{ saveLimits(); rebuildBag(); msg.textContent="✅ 已套用設定（權重/上限/機率）"; });
  document.getElementById("resetBtn")?.addEventListener("click", ()=>{ symbols=symbols.map(s=>({...s,weight:10})); renderConfig(); rebuildBag(); msg.textContent="↩ 已重置為預設權重（機率值保留）"; });
  resetWinsAllBtn?.addEventListener("click", ()=>{ Object.keys(symbolLimits).forEach(k=>symbolLimits[k].wins=0); saveLimits(); rebuildBag(); resetSessionWins(); updateTotalStat(); document.querySelectorAll(".wins").forEach(el=>el.textContent="0"); msg.textContent="🧹 已重置遊戲（所有已中歸零）"; });

  // 圖庫管理
  function showGallery(){ galleryModal.classList.add('show'); galleryModal.setAttribute('aria-hidden','false'); }
  function hideGallery(){ galleryModal.classList.remove('show'); galleryModal.setAttribute('aria-hidden','true'); }
  openGalleryBtn?.addEventListener("click", showGallery);
  closeGalleryBtn?.addEventListener("click", hideGallery);
  galleryModal?.addEventListener("click", e=>{ if(e.target===galleryModal) hideGallery(); });

  function updateCount(){ if(countText) countText.textContent=String(symbols.length); }
  function renderGallery(){
    galleryGrid.innerHTML="";
    symbols.forEach((s,idx)=>{
      const item=document.createElement("div"); item.className="gitem";
      const im=document.createElement("img"); im.src=s.file; im.alt=s.label||`照片${idx+1}`;
      const rm=document.createElement("button"); rm.className="rm"; rm.textContent="刪除";
      rm.addEventListener("click", ()=>{
        try{ if(s.file.startsWith("blob:")) URL.revokeObjectURL(s.file); }catch(e){}
        symbols.splice(idx,1); delete symbolLimits[s.file]; saveLimits();
        rebuildBag(); renderGallery(); renderConfig(); updateCount(); syncInitialImages();
        msg.textContent=`🗑 已刪除 1 張，剩餘 ${symbols.length} / 10`;
      });
      item.append(im,rm); galleryGrid.appendChild(item);
    });
    updateCount(); updateSpinButtonState();
  }
  async function filesToSymbols(fileList, remainSlots){
    const files=Array.from(fileList).filter(f=>f.type.startsWith("image/")).slice(0,remainSlots);
    const out=[]; for(const f of files){ const url=URL.createObjectURL(f); const label=(f.name||"照片").replace(/\.[^.]+$/,""); out.push({file:url,label,weight:10}); }
    return out;
  }
  function syncInitialImages(){ if(symbols[0]) img1.src=symbols[0].file; }

  addBtn?.addEventListener("click", ()=> addPicker.click());
  addPicker?.addEventListener("change", async ()=>{
    if(!addPicker.files || !addPicker.files.length) return;
    const remain=Math.max(0,10-symbols.length);
    if(remain<=0){ msg.className="message bad"; msg.textContent="已達 10 張上限。請先刪除再新增。"; return; }
    const newSyms=await filesToSymbols(addPicker.files,remain);
    symbols=symbols.concat(newSyms); loadLimitsFromSymbols();
    await preload(newSyms); rebuildBag(); renderGallery(); renderConfig(); updateCount(); syncInitialImages();
    msg.textContent=`✅ 已新增 ${newSyms.length} 張（目前 ${symbols.length} / 10）`; addPicker.value="";
  });
  clearAllBtn?.addEventListener("click", ()=>{
    if(!confirm("確定要清空整個圖庫嗎？")) return;
    symbols.forEach(s=>{ try{ if(s.file.startsWith("blob:")) URL.revokeObjectURL(s.file); }catch(e){} });
    symbols=[]; symbolLimits={}; saveLimits(); rebuildBag(); renderGallery(); renderConfig(); updateCount();
    img1.removeAttribute("src");
    updateSpinButtonState(); msg.textContent="🧹 已清空圖庫。請新增 3～10 張照片。";
  });

  // 首次選圖
  function showPicker(){ overlay.style.display="flex"; }
  function hidePicker(){ overlay.style.display="none"; }
  chooseBtn?.addEventListener("click", ()=> filePicker.click());
  filePicker?.addEventListener("change", async ()=>{
    if(!filePicker.files || !filePicker.files.length) return;
    const files=Array.from(filePicker.files).filter(f=>f.type.startsWith("image/"));
    if(files.length<3){ msg.className="message bad"; msg.textContent="至少選擇 3 張照片。"; return; }
    const sliced=files.slice(0,10);
    const newSyms=await filesToSymbols(sliced,10);
    symbols=newSyms; await preload(symbols); loadLimitsFromSymbols();
    rebuildBag(); renderGallery(); renderConfig(); updateCount(); syncInitialImages();
    hidePicker(); msg.className="message"; msg.textContent=`已載入 ${symbols.length} 張照片，開始玩吧！`; sfxHint();
  });

  // 初始化
  function init(){
    if(symbols.length<3){ showPicker(); updateSpinButtonState(); }
    updateTotalStat();
  }
  init();
})();
