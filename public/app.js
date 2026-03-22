'use strict';

// ══════════════════════════════════════════════════════════
// FISCOBOT PRO 2.0 — app.js
// ══════════════════════════════════════════════════════════

// ── REST Helpers ──────────────────────────────────────────
async function apiGet(key) {
  try { const r=await fetch(`/api/store/${encodeURIComponent(key)}`); const d=await r.json(); return d.value??null; }
  catch { return null; }
}
async function apiSet(key,value) {
  try { await fetch(`/api/store/${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})}); } catch {}
}
async function apiPost(path,body) {
  try { const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return await r.json(); }
  catch(e) { return {error:e.message}; }
}

// ── WebSocket ─────────────────────────────────────────────
let ws;
function connectWS() {
  ws = new WebSocket(`ws://localhost:${location.port}`);
  ws.addEventListener('message', ({data}) => {
    try {
      const {event, data:d} = JSON.parse(data);
      if (event==='macro:progress') updateMacroProgress(d.done, d.total);
      if (event==='macro:done')     onMacroDone(d.done, d.total);
      if (event==='macro:run')      runMacroLocal(d.steps, d.delay);
      if (event==='autofill:run')   runAutofillLocal(d.data);
      if (event==='log')            addLog(d.text, d.cls||'info');
    } catch {}
  });
  ws.addEventListener('close', () => setTimeout(connectWS, 2000));
  ws.addEventListener('error', () => {});
}
connectWS();

// ── Toast ─────────────────────────────────────────────────
function toast(msg, type='', dur=2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.className = type ? `show ${type}` : 'show';
  clearTimeout(t._t); t._t = setTimeout(() => t.className='', dur);
}

// ── Activity Feed ─────────────────────────────────────────
function addActivity(title, meta='', type='info') {
  const feed = document.getElementById('actFeed');
  if (!feed) return;
  const icons = { ok:'✓', warn:'⚠', err:'✕', info:'ℹ', gold:'⚡' };
  const now = new Date().toTimeString().slice(0,5);
  const item = document.createElement('div'); item.className='act-item';
  item.innerHTML=`
    <div class="act-ico ${type}">${icons[type]||'ℹ'}</div>
    <div class="act-body"><div class="act-title">${title}</div>${meta?`<div class="act-meta">${meta}</div>`:''}</div>
    <div class="act-time">${now}</div>`;
  feed.insertBefore(item, feed.firstChild);
  while (feed.children.length > 15) feed.removeChild(feed.lastChild);
}

// ── Log (Downloads) ───────────────────────────────────────
function addLog(text, cls='info') {
  const box = document.getElementById('logBox'); if (!box) return;
  const now = new Date().toTimeString().slice(0,5);
  const row = document.createElement('div'); row.className='lr';
  const ts = document.createElement('span'); ts.className='lt'; ts.textContent=now;
  const lm = document.createElement('span'); lm.className=`lm ${cls}`; lm.textContent=text;
  row.appendChild(ts); row.appendChild(lm);
  box.appendChild(row); box.scrollTop=box.scrollHeight;
}

function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className=cls;
  if (text!=null) e.textContent=text;
  return e;
}

// ── Navegação portais ─────────────────────────────────────
const ALLOWED = [
  'receita.fazenda.gov.br','nfe.fazenda.gov.br','cav.receita.fazenda.gov.br',
  'sped.rfb.gov.br','esocial.gov.br','sefaz.rs.gov.br',
  'www8.receita.fazenda.gov.br','www.gov.br','acesso.gov.br',
  'cnpj.com.br','pgfn.fazenda.gov.br','idg.receita.fazenda.gov.br',
  'servicos.receita.fazenda.gov.br','portaldosimples.receita.fazenda.gov.br',
  'gov.br','nfse.gov.br',
];
function isAllowed(raw) {
  try { const u=new URL(raw.startsWith('http')?raw:'https://'+raw); return ALLOWED.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)); }
  catch { return false; }
}

async function navigate(url) {
  if (!url) return;
  const full = url.startsWith('http') ? url : 'https://'+url;
  if (!isAllowed(full)) { toast('URL não autorizada.','err'); return; }
  document.getElementById('loadingBar')?.classList.add('on');
  addActivity(`Abrindo portal`, new URL(full).hostname, 'info');
  const r = await apiPost('/api/browser/navigate', { url: full });
  document.getElementById('loadingBar')?.classList.remove('on');
  if (r.ok) { toast(`✓ Portal aberto`, 'ok', 1800); addActivity(`Portal aberto`, full, 'ok'); }
  else       { toast(`Erro: ${r.error||'falha'}`, 'err'); }
}

document.querySelectorAll('.portal-card[data-url]').forEach(c => {
  c.addEventListener('click', () => navigate(c.dataset.url));
});

// ── Clear logs ────────────────────────────────────────────
document.getElementById('btnClearLog')?.addEventListener('click', () => {
  const box = document.getElementById('logBox'); if (box) box.innerHTML='';
  addLog('Log limpo.','info');
});
document.getElementById('btnClearLog2')?.addEventListener('click', () => {
  const feed = document.getElementById('actFeed'); if (feed) feed.innerHTML='';
  addActivity('Atividade limpa', '', 'info');
});

// ═══════════════════════════════════════════════════════════
// MACROS
// ═══════════════════════════════════════════════════════════
let macroSteps=[], macroRec=false, macroRunning=false;

function buildSel(el) {
  if (el.id)   return '#'+CSS.escape(el.id);
  if (el.name) return `[name="${el.name}"]`;
  return el.tagName.toLowerCase()+(el.type?`[type="${el.type}"]`:'');
}
function flashEl(el) {
  if (!el) return;
  const p = el.style.outline;
  el.style.outline='2px solid var(--gold)'; el.style.outlineOffset='2px';
  setTimeout(()=>{el.style.outline=p;el.style.outlineOffset='';},450);
}
function updateRecCount() {
  const el = document.getElementById('recSteps');
  if (el) el.textContent=`${macroSteps.length} passo${macroSteps.length!==1?'s':''}`;
}

const clickH  = e => { if(!macroRec)return; const t=e.target; if(t.closest('#topbar')||t.closest('#drawer')||t.closest('#sidebar')||t.closest('#rail'))return; macroSteps.push({action:'click',selector:buildSel(t)}); updateRecCount(); flashEl(t); };
const inputH  = e => { if(!macroRec)return; const t=e.target,s=buildSel(t),l=macroSteps[macroSteps.length-1]; if(l?.action==='input'&&l.selector===s){l.value=t.value;}else{macroSteps.push({action:'input',selector:s,value:t.value});} updateRecCount(); };
const changeH = e => { if(!macroRec)return; const t=e.target; if(t.tagName==='SELECT'){macroSteps.push({action:'select',selector:buildSel(t),value:t.value});updateRecCount();} };

document.getElementById('btnRec')?.addEventListener('click', () => {
  macroRec=true; macroSteps=[];
  document.getElementById('btnRec').disabled=true;
  document.getElementById('btnStopRec').disabled=false;
  document.getElementById('recBar')?.classList.add('on');
  updateRecCount();
  document.addEventListener('click',clickH,true);
  document.addEventListener('input',inputH,true);
  document.addEventListener('change',changeH,true);
  toast('⏺ Gravação iniciada','ok');
  addActivity('Macro: gravação iniciada','','gold');
});

document.getElementById('btnStopRec')?.addEventListener('click', () => {
  macroRec=false;
  document.removeEventListener('click',clickH,true);
  document.removeEventListener('input',inputH,true);
  document.removeEventListener('change',changeH,true);
  document.getElementById('btnRec').disabled=false;
  document.getElementById('btnStopRec').disabled=true;
  document.getElementById('recBar')?.classList.remove('on');
  if (macroSteps.length>0) {
    const sb=document.getElementById('saveBar');
    if(sb)sb.style.display='flex';
    document.getElementById('macroNameInp')?.focus();
  } else { toast('Nenhuma ação gravada.','err'); }
});

document.getElementById('btnSaveMacro')?.addEventListener('click', async () => {
  const inp=document.getElementById('macroNameInp'); const name=inp?.value.trim();
  if(!name){toast('Digite um nome!','err');return;}
  const delay=parseInt(document.getElementById('delayMs')?.value)||600;
  const macros=(await apiGet('macros'))||[];
  macros.push({id:Date.now(),name,steps:macroSteps,delay,created:new Date().toLocaleDateString('pt-BR'),icon:guessIcon(name)});
  await apiSet('macros',macros); await apiSet('macroDelay',delay);
  const sb=document.getElementById('saveBar'); if(sb)sb.style.display='none';
  if(inp)inp.value=''; macroSteps=[];
  renderMacros(); toast(`Macro "${name}" salvo!`,'ok');
  addActivity(`Macro salvo: "${name}"`,`${macroSteps.length||0} passos · ${delay}ms`,'gold');
});

document.getElementById('btnDiscardMacro')?.addEventListener('click', () => {
  const sb=document.getElementById('saveBar'); if(sb)sb.style.display='none';
  const inp=document.getElementById('macroNameInp'); if(inp)inp.value=''; macroSteps=[];
});

document.getElementById('macroNameInp')?.addEventListener('keydown', e => {
  if(e.key==='Enter')  document.getElementById('btnSaveMacro')?.click();
  if(e.key==='Escape') document.getElementById('btnDiscardMacro')?.click();
});

document.getElementById('delayMs')?.addEventListener('change', e => apiSet('macroDelay',parseInt(e.target.value)||600));

function guessIcon(n) {
  n=n.toLowerCase();
  if(n.includes('nf')||n.includes('nota'))     return '📄';
  if(n.includes('darf')||n.includes('guia'))   return '📑';
  if(n.includes('sped')||n.includes('efd'))    return '💾';
  if(n.includes('esocial'))                    return '👥';
  if(n.includes('simples')||n.includes('das')) return '🟢';
  if(n.includes('icms')||n.includes('sefaz'))  return '🏛';
  if(n.includes('dctf'))                       return '📋';
  if(n.includes('pgdas'))                      return '🧮';
  return '⚙';
}

function updateMacroProgress(done, total) {
  const wrap=document.getElementById('macroProgress'), bar=document.getElementById('macroProgressBar'), txt=document.getElementById('macroProgressText');
  if(wrap)wrap.style.display='block';
  if(bar)bar.style.width=Math.round((done/total)*100)+'%';
  if(txt)txt.textContent=`${done}/${total} passos`;
}

function onMacroDone(done, total) {
  macroRunning=false;
  toast(`✅ Macro concluído (${done}/${total})!`,'ok');
  addActivity('Macro concluído',`${done}/${total} passos executados`,'ok');
  setTimeout(()=>{ const w=document.getElementById('macroProgress'); if(w)w.style.display='none'; const b=document.getElementById('macroProgressBar'); if(b)b.style.width='0'; },2000);
}

async function renderMacros() {
  const macros=(await apiGet('macros'))||[];
  const list=document.getElementById('macroList'); if(!list)return;
  const badge=document.getElementById('macroCountBadge');
  if(badge)badge.textContent=macros.length;
  const stEl=document.getElementById('stMacros');
  if(stEl){ stEl.textContent=macros.length; const bar=document.getElementById('stMacrosBar'); if(bar)bar.style.width=Math.min(macros.length*20,100)+'%'; }
  list.innerHTML='';
  if(!macros.length){
    const es=document.createElement('div');
    es.style.cssText='text-align:center;padding:32px 12px;color:var(--t3);font-size:12px;font-family:var(--fm)';
    es.innerHTML='<div style="font-size:28px;margin-bottom:8px">⚙</div><div style="font-weight:700;color:var(--t2);margin-bottom:4px">Nenhum macro</div><div>Clique em ⏺ Gravar para começar</div>';
    list.appendChild(es); return;
  }
  macros.forEach(m=>{
    const card=mk('div','mc'), ico=mk('div','mc-ico',m.icon), info=mk('div','mc-info');
    const nm=mk('div','mc-name',m.name); nm.title=m.name;
    const mt=mk('div','mc-meta',`${m.steps.length} passos · ${m.delay||600}ms · ${m.created||''}`);
    info.appendChild(nm); info.appendChild(mt);
    const acts=mk('div','mc-acts');
    const pb=mk('button','btn-xs go','▶ Rodar'); pb.addEventListener('click',()=>playMacro(m));
    const db=mk('button','btn-xs del','✕');     db.addEventListener('click',()=>deleteMacro(m.id,m.name));
    acts.appendChild(pb); acts.appendChild(db);
    card.appendChild(ico); card.appendChild(info); card.appendChild(acts);
    list.appendChild(card);
  });
}

async function playMacro(m) {
  if(macroRunning){toast('Já existe um macro em execução.','err');return;}
  macroRunning=true;
  updateMacroProgress(0,m.steps.length);
  toast(`▶ Executando "${m.name}"...`,'ok');
  addActivity(`Macro: "${m.name}"`,`${m.steps.length} passos · ${m.delay||600}ms`,'gold');
  const r=await apiPost('/api/macro/play',{steps:m.steps,delay:m.delay});
  if(!r.ok){macroRunning=false;toast('Erro: '+r.error,'err');}
}

async function deleteMacro(id,name) {
  let macros=(await apiGet('macros'))||[]; macros=macros.filter(x=>x.id!==id);
  await apiSet('macros',macros); renderMacros(); toast(`"${name}" removido.`);
}

async function runMacroLocal(steps,delay=600) {
  function findEl(sel){if(!sel)return null;try{return document.querySelector(sel);}catch{return null;}}
  function setVal(el,v){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;s?s.call(el,v):(el.value=v);}
  function flash(el){if(!el)return;const p=el.style.outline;el.style.outline='2px solid var(--gold)';setTimeout(()=>{el.style.outline=p;},500);}
  let done=0;
  for(const step of steps){
    await new Promise(r=>setTimeout(r,delay));
    try{
      if(step.action==='click'){const el=findEl(step.selector);if(el){el.click();flash(el);}}
      else if(step.action==='input'){const el=findEl(step.selector);if(el){setVal(el,step.value||'');el.dispatchEvent(new Event('input',{bubbles:true}));flash(el);}}
      else if(step.action==='type'){const el=document.activeElement;if(el&&step.text){setVal(el,(el.value||'')+step.text);el.dispatchEvent(new Event('input',{bubbles:true}));}}
      else if(step.action==='key'){document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:step.key,bubbles:true}));}
      done++;
    }catch{}
  }
  toast('Macro local concluído!','ok');
}

// ══════════════════════════════════════════════════════════
// AUTOFILL
// ══════════════════════════════════════════════════════════
const FF=['cnpj','razao','ie','im','email','tel','end','cep','uf'];

async function loadProfiles() {
  const profiles=(await apiGet('profiles'))||[];
  const sel=document.getElementById('profileSel'); if(!sel)return;
  const cur=sel.value;
  while(sel.firstChild)sel.removeChild(sel.firstChild);
  sel.appendChild(new Option('— Selecionar perfil —',''));
  profiles.forEach(p=>sel.appendChild(new Option(p.name,p.id)));
  if(cur)sel.value=cur;

  // Atualiza sidebar
  const profile=profiles.find(p=>String(p.id)===String(cur));
  if(profile){
    const n=document.getElementById('sbCoName'); const m=document.getElementById('sbCoMeta');
    if(n)n.textContent=profile.name||profile.data?.razao||'Empresa';
    if(m)m.textContent=profile.data?.cnpj||'AutoFill ativo';
    const av=document.getElementById('sbUserAv');
    if(av)av.textContent=(profile.name||'E').slice(0,1).toUpperCase();
    const stat=document.getElementById('stEmpresas');
    if(stat){stat.textContent=profiles.length;const bar=document.getElementById('stEmpresasBar');if(bar)bar.style.width=Math.min(profiles.length*25,100)+'%';}
  } else {
    const stat=document.getElementById('stEmpresas');
    if(stat){stat.textContent=profiles.length;const bar=document.getElementById('stEmpresasBar');if(bar)bar.style.width=Math.min(profiles.length*25,100)+'%';}
  }
}

document.getElementById('profileSel')?.addEventListener('change', async e=>{
  const id=parseInt(e.target.value); if(!id)return;
  const p=((await apiGet('profiles'))||[]).find(x=>x.id===id); if(!p)return;
  FF.forEach(f=>{const el=document.getElementById(`f_${f}`);if(el)el.value=p.data[f]||'';});
  toast(`Perfil "${p.name}" carregado.`,'ok');
  const n=document.getElementById('sbCoName'); const m=document.getElementById('sbCoMeta');
  if(n)n.textContent=p.name; if(m)m.textContent=p.data?.cnpj||'AutoFill ativo';
});

document.getElementById('btnNewPrf')?.addEventListener('click',()=>{
  FF.forEach(f=>{const el=document.getElementById(`f_${f}`);if(el)el.value='';});
  const sel=document.getElementById('profileSel'); if(sel)sel.value='';
  document.getElementById('f_cnpj')?.focus();
});

document.getElementById('btnSavePrf')?.addEventListener('click', async()=>{
  const name=document.getElementById('f_razao')?.value.trim()||document.getElementById('f_cnpj')?.value.trim();
  if(!name){toast('Preencha CNPJ ou Razão Social.','err');return;}
  const profiles=(await apiGet('profiles'))||[];
  const data={}; FF.forEach(f=>{data[f]=document.getElementById(`f_${f}`)?.value||'';});
  const sid=parseInt(document.getElementById('profileSel')?.value||'0');
  if(sid){const idx=profiles.findIndex(p=>p.id===sid);if(idx>=0){profiles[idx].data=data;profiles[idx].name=name;}else profiles.push({id:Date.now(),name,data});}
  else profiles.push({id:Date.now(),name,data});
  await apiSet('profiles',profiles); await loadProfiles();
  toast(`Perfil "${name}" salvo!`,'ok');
  addActivity(`AutoFill: perfil "${name}" salvo`,'','ok');
});

document.getElementById('btnFillPage')?.addEventListener('click', async()=>{
  const data={}; FF.forEach(f=>{data[f]=document.getElementById(`f_${f}`)?.value||'';});
  const hasData=Object.values(data).some(v=>v.trim());
  if(!hasData){toast('Preencha ao menos um campo.','err');return;}
  runAutofillLocal(data);
});

function runAutofillLocal(data={}) {
  const FMAP={cnpj:['cnpj','cpf','documento','nr_cnpj'],razao:['razao','razão','nome','empresa','fantasia'],ie:['ie','inscricao_estadual','nr_ie'],im:['im','inscricao_municipal'],email:['email','e-mail','mail'],tel:['telefone','tel','fone','celular'],end:['endereco','endereço','logradouro'],cep:['cep','postal'],uf:['uf','estado']};
  let filled=0;
  document.querySelectorAll('input,textarea,select').forEach(el=>{
    const attr=[el.name,el.id,el.placeholder,el.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
    for(const[key,kws]of Object.entries(FMAP)){
      if(!data[key])continue;
      if(kws.some(kw=>attr.includes(kw))){
        const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
        s?s.call(el,data[key]):(el.value=data[key]);
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.style.outline='2px solid var(--gold)';
        setTimeout(()=>el.style.outline='',600);
        filled++;break;
      }
    }
  });
  if(filled>0){addLog(`AutoFill: ${filled} campo(s)`,'ok');toast(`✅ ${filled} campo(s) preenchido(s)!`,'ok');}
  else toast('Nenhum campo compatível encontrado.','err');
}

// ══════════════════════════════════════════════════════════
// DOWNLOADS / TOGGLES
// ══════════════════════════════════════════════════════════
async function initToggles() {
  const cfg=(await apiGet('downloadSettings'))||{};
  document.querySelectorAll('.toggle[data-key]').forEach(sw=>{if(cfg[sw.dataset.key])sw.classList.add('on');});
  document.querySelectorAll('.mon-card[data-key]').forEach(row=>{
    row.addEventListener('click',async()=>{
      const key=row.dataset.key,c=(await apiGet('downloadSettings'))||{};
      c[key]=!c[key]; await apiSet('downloadSettings',c);
      row.querySelector('.toggle')?.classList.toggle('on',!!c[key]);
      addLog(c[key]?`Monitor ${key.toUpperCase()} ativado`:`Monitor ${key.toUpperCase()} desativado`,c[key]?'ok':'warn');
    });
  });
}

// ══════════════════════════════════════════════════════════
// CERTIFICADOS
// ══════════════════════════════════════════════════════════
let selectedCert=null;

async function loadCerts() {
  try { const r=await fetch('/api/certs'); const d=await r.json(); renderCerts(d.certs||[]); }
  catch { renderCerts([]); }
}

function renderCerts(certs) {
  // Sidebar cert count
  const badge=document.getElementById('tbPillCert');
  const sbStatus=document.getElementById('sbCertStatus');
  const stEl=document.getElementById('stCerts');
  if(stEl){stEl.textContent=certs.length;const bar=document.getElementById('stCertsBar');if(bar)bar.style.width=Math.min(certs.length*50,100)+'%';}
  if(certs.length>0){
    if(badge){badge.style.display='flex';badge.innerHTML=`<div class="tp-dot"></div> Cert. A1 (${certs.length})`;}
    if(sbStatus){sbStatus.innerHTML=`<div class="sb-dot on"></div> Cert. A1 (${certs.length})`;}
  } else {
    if(badge)badge.style.display='none';
    if(sbStatus)sbStatus.innerHTML='<div class="sb-dot off"></div> Sem certificado';
  }

  // Render list (seção certs)
  const list=document.getElementById('certListMain'); if(!list)return;
  selectedCert=null;
  const btnExp=document.getElementById('btnExportCertMain'); if(btnExp)btnExp.disabled=true;
  if(!certs.length){list.innerHTML='<div style="color:var(--t3);font-size:11px;font-family:var(--fm);padding:8px">Nenhum certificado importado ainda.</div>';return;}
  list.innerHTML='';
  certs.forEach(c=>{
    const item=mk('div','cert-row');
    const ico=mk('div','cr-ico',c.type==='A3'?'🔑':'🔏');
    const info=mk('div','cr-info');
    const nm=mk('div','cr-name',c.name); nm.title=c.name;
    const kb=c.size?`${(c.size/1024).toFixed(1)} KB · `:'';
    const dt=c.added?new Date(c.added).toLocaleDateString('pt-BR'):'';
    const mt=mk('div','cr-meta',`${kb}${dt}${c.hasPass?' · 🔒':''}`);
    const badge2=mk('span','cr-badge',c.type);
    info.appendChild(nm); info.appendChild(mt); info.appendChild(badge2);
    const acts=mk('div','cr-actions');
    const btnDl=mk('button','cr-btn','⬇'); btnDl.title='Baixar';
    btnDl.addEventListener('click',e=>{e.stopPropagation();downloadCert(c.name);});
    const btnDel=mk('button','cr-btn del','✕'); btnDel.title='Remover';
    btnDel.addEventListener('click',e=>{e.stopPropagation();deleteCert(c.name);});
    acts.appendChild(btnDl); acts.appendChild(btnDel);
    item.appendChild(ico); item.appendChild(info); item.appendChild(acts);
    item.addEventListener('click',()=>{
      document.querySelectorAll('.cert-row').forEach(x=>x.classList.remove('sel'));
      item.classList.add('sel'); selectedCert=c.name;
      if(btnExp)btnExp.disabled=false;
    });
    list.appendChild(item);
  });
}

async function downloadCert(name) {
  const a=document.createElement('a');a.href=`/api/certs/download/${encodeURIComponent(name)}`;a.download=name;a.click();
  toast(`Baixando ${name}…`,'ok');
}
async function deleteCert(name) {
  const r=await fetch(`/api/certs/${encodeURIComponent(name)}`,{method:'DELETE'});const d=await r.json();
  if(d.ok){toast(`"${name}" removido.`);loadCerts();}
  else toast('Erro: '+d.error,'err');
}

// Drop + file main
function setupCertMain() {
  const drop=document.getElementById('certDropMain');
  const fi=document.getElementById('certFileMain');
  if(drop){
    drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag');});
    drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
    drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');const f=e.dataTransfer.files[0];if(f)selectCertMain(f);});
  }
  fi?.addEventListener('change',e=>{const f=e.target.files[0];if(f)selectCertMain(f);e.target.value='';});
  document.getElementById('btnImportCertMain')?.addEventListener('click',()=>{const fi2=document.getElementById('certFileMain');if(fi2?.files?.length)importCert(fi2.files[0]);else toast('Selecione um arquivo .pfx primeiro.','err');});
  document.getElementById('btnExportCertMain')?.addEventListener('click',()=>{if(selectedCert)downloadCert(selectedCert);});
}

function selectCertMain(file) {
  const allowed=['.pfx','.p12','.cer','.crt','.pem'];
  const ext=file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if(!allowed.includes(ext)){toast('Formato não suportado.','err');return;}
  const nm=document.getElementById('certNameMain'); if(nm)nm.value=file.name;
  importCert(file);
}

async function importCert(file) {
  const pw=document.getElementById('certPassMain')?.value||'';
  const reader=new FileReader();
  reader.onload=async ev=>{
    const base64=ev.target.result.split(',')[1];
    const ext=file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    const type=['.pfx','.p12'].includes(ext)?'A1':'A1';
    toast('Importando certificado...','ok');
    const r=await apiPost('/api/certs/upload',{name:file.name,type,data:base64,password:pw});
    if(r.ok){
      toast(`✅ Certificado "${r.name}" importado!`,'ok');
      addActivity(`Certificado importado: ${r.name}`,'Seguro · AES-256-GCM','ok');
      const pw2=document.getElementById('certPassMain'); if(pw2)pw2.value='';
      const nm=document.getElementById('certNameMain'); if(nm)nm.value='';
      const fi=document.getElementById('certFileMain'); if(fi)fi.value='';
      loadCerts();
    } else { toast('Erro: '+(r.error||'falha'),'err'); }
  };
  reader.readAsDataURL(file);
}

// ══════════════════════════════════════════════════════════
// AGENTE IA — SSE Streaming
// ══════════════════════════════════════════════════════════
let chatHistory=[], agentBusy=false, abortCtrl=null;

(async()=>{
  try{const r=await fetch('/api/key/exists');const d=await r.json();
    if(d.exists){
      const inp=document.getElementById('apiKeyInp'); if(inp)inp.value='••••••••••••••••';
      const dot=document.getElementById('apiDot'); if(dot)dot.className='key-dot ok';
      const sbIA=document.getElementById('sbIAStatus'); if(sbIA)sbIA.innerHTML='<div class="sb-dot on"></div> IA ativa';
    }
  }catch{}
})();

document.getElementById('btnSaveKey')?.addEventListener('click',async()=>{
  const inp=document.getElementById('apiKeyInp'); const raw=inp?.value.trim()||'';
  if(raw==='••••••••••••••••'){toast('Key já está salva.','ok');return;}
  if(!raw.startsWith('sk-ant-')||raw.length<40){const dot=document.getElementById('apiDot');if(dot)dot.className='key-dot err';toast('Key inválida — deve começar com sk-ant-','err');return;}
  const r=await apiPost('/api/key/save',{key:raw});const dot=document.getElementById('apiDot');
  if(r.ok){if(inp)inp.value='••••••••••••••••';if(dot)dot.className='key-dot ok';toast('API Key salva!','ok');
    const sbIA=document.getElementById('sbIAStatus'); if(sbIA)sbIA.innerHTML='<div class="sb-dot on"></div> IA ativa';
    addActivity('API Key do Léo configurada','Anthropic · Claude','ok');
  } else {if(dot)dot.className='key-dot err';toast(r.error||'Erro.','err');}
});

document.getElementById('btnClearKey')?.addEventListener('click',async()=>{
  await fetch('/api/key',{method:'DELETE'});
  const inp=document.getElementById('apiKeyInp'); if(inp)inp.value='';
  const dot=document.getElementById('apiDot'); if(dot)dot.className='key-dot';
  const sbIA=document.getElementById('sbIAStatus'); if(sbIA)sbIA.innerHTML='<div class="sb-dot off"></div> IA inativa';
  toast('API Key removida.');
});

document.querySelectorAll('.chip[data-q]').forEach(chip=>{
  chip.addEventListener('click',()=>{
    const ta=document.getElementById('chatInput');
    if(ta){ta.value=chip.dataset.q;autoH(ta);ta.focus();sendMsg();}
  });
});

const chatTA=document.getElementById('chatInput');
function autoH(ta){if(!ta)return;ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,140)+'px';}
chatTA?.addEventListener('input',()=>autoH(chatTA));
chatTA?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}});
document.getElementById('btnSendChat')?.addEventListener('click',sendMsg);
document.getElementById('btnCancelStream')?.addEventListener('click',()=>{abortCtrl?.abort();abortCtrl=null;setBusy(false);addLog('Resposta cancelada.','warn');});
document.getElementById('btnClearChat')?.addEventListener('click',()=>{
  chatHistory=[];const cm=document.getElementById('chatMsgs');if(cm)cm.innerHTML='';
  addBotBub('👋 **Léo aqui de novo!** Papo zerado. Fala aí, qual é a boa?');
});

function setBusy(b){
  agentBusy=b;
  const bs=document.getElementById('btnSendChat'),bc=document.getElementById('btnCancelStream');
  if(bs)bs.style.display=b?'none':'flex';
  if(bc)bc.style.display=b?'flex':'none';
  if(chatTA){chatTA.disabled=b;if(!b)chatTA.focus();}
}

function scrollChat(){const b=document.getElementById('chatMsgs');if(b)b.scrollTop=b.scrollHeight;}

function addUserBub(text){
  const box=document.getElementById('chatMsgs');if(!box)return;
  const now=new Date().toTimeString().slice(0,5);
  const w=mk('div','msg msg-u'),b=mk('div','bubble',text),t=mk('div','msg-time',`Você · ${now}`);
  w.appendChild(b);w.appendChild(t);box.appendChild(w);scrollChat();
}

function mkBotBub(){
  const box=document.getElementById('chatMsgs');if(!box)return{wrapEl:null,bubEl:null};
  const w=mk('div','msg msg-b'),b=mk('div','bubble');
  w.appendChild(b);box.appendChild(w);scrollChat();
  return{wrapEl:w,bubEl:b};
}

function finBub(w){if(!w)return;const now=new Date().toTimeString().slice(0,5);const t=mk('div','msg-time',`Léo · ${now}`);w.appendChild(t);scrollChat();}

function addBotBub(text){const{wrapEl,bubEl}=mkBotBub();if(bubEl)rmd(bubEl,text);finBub(wrapEl);}

async function sendMsg(){
  if(agentBusy)return;
  const text=chatTA?.value.trim();if(!text)return;
  try{const kr=await fetch('/api/key/exists'),kd=await kr.json();if(!kd.exists){toast('Configure a API Key na aba IA primeiro.','err');return;}}catch{toast('Erro ao verificar API Key.','err');return;}
  if(chatTA){chatTA.value='';chatTA.style.height='auto';}
  setBusy(true);
  addUserBub(text);chatHistory.push({role:'user',content:text});
  const{wrapEl,bubEl}=mkBotBub();if(!bubEl){setBusy(false);return;}
  const cur=document.createElement('span');cur.className='scursor';bubEl.appendChild(cur);scrollChat();
  abortCtrl=new AbortController();let full='';
  try{
    const res=await fetch('/api/agent/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:chatHistory}),signal:abortCtrl.signal});
    if(!res.ok){const err=await res.json().catch(()=>({}));cur.remove();rmd(bubEl,'Erro: '+(err.error||`HTTP ${res.status}`));finBub(wrapEl);setBusy(false);return;}
    const reader=res.body.getReader(),dec=new TextDecoder();let buf='';
    while(true){
      const{done,value}=await reader.read();if(done)break;
      buf+=dec.decode(value,{stream:true});const lines=buf.split('\n');buf=lines.pop();
      let en='';
      for(const line of lines){
        if(line.startsWith('event: ')){en=line.slice(7).trim();continue;}
        if(!line.startsWith('data: '))continue;
        try{const ev=JSON.parse(line.slice(6));
          if(en==='delta'&&ev.text){full+=ev.text;cur.remove();bubEl.innerHTML='';rmd(bubEl,full);bubEl.appendChild(cur);scrollChat();}
          if(en==='done'){cur.remove();bubEl.innerHTML='';rmd(bubEl,full);finBub(wrapEl);chatHistory.push({role:'assistant',content:full});setBusy(false);}
          if(en==='error'){cur.remove();rmd(bubEl,'Erro: '+(ev.message||'Falha.'));finBub(wrapEl);setBusy(false);}
        }catch{}
      }
    }
    if(full&&agentBusy){cur.remove();bubEl.innerHTML='';rmd(bubEl,full);finBub(wrapEl);chatHistory.push({role:'assistant',content:full});setBusy(false);}
  }catch(err){
    if(err.name!=='AbortError'){cur.remove();bubEl.innerHTML='';rmd(bubEl,'Conexão interrompida. Tente novamente.');finBub(wrapEl);}
    setBusy(false);
  }
  abortCtrl=null;
}

// Markdown renderer
function rmd(c,raw){
  if(!c)return;c.innerHTML='';
  const lines=raw.split('\n');let lst=null,ltag='';
  function fl(){if(lst){c.appendChild(lst);lst=null;ltag='';}}
  lines.forEach(line=>{
    if(/^[•\-\*] /.test(line)){if(ltag!=='ul'){fl();lst=document.createElement('ul');ltag='ul';}const li=document.createElement('li');ri(li,line.slice(2).trim());lst.appendChild(li);return;}
    if(/^\d+\. /.test(line)){if(ltag!=='ol'){fl();lst=document.createElement('ol');ltag='ol';}const li=document.createElement('li');ri(li,line.replace(/^\d+\.\s/,'').trim());lst.appendChild(li);return;}
    fl();
    if(!line.trim()){c.appendChild(document.createElement('br'));return;}
    const hm=line.match(/^(#{1,3})\s(.+)/);
    if(hm){const h=document.createElement(hm[1].length===1?'h3':'h4');ri(h,hm[2]);c.appendChild(h);c.appendChild(document.createElement('br'));return;}
    if(/^---+$/.test(line.trim())){c.appendChild(document.createElement('hr'));return;}
    const sp=document.createElement('span');ri(sp,line);c.appendChild(sp);c.appendChild(document.createElement('br'));
  });
  fl();
}
function ri(c,text){
  text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).forEach(p=>{
    if(p.startsWith('**')&&p.endsWith('**')&&p.length>4){const s=mk('strong');s.textContent=p.slice(2,-2);c.appendChild(s);}
    else if(p.startsWith('*')&&p.endsWith('*')&&p.length>2){const s=mk('em');s.textContent=p.slice(1,-1);c.appendChild(s);}
    else if(p.startsWith('`')&&p.endsWith('`')&&p.length>2){const s=mk('code');s.textContent=p.slice(1,-1);c.appendChild(s);}
    else c.appendChild(document.createTextNode(p));
  });
}

// ══════════════════════════════════════════════════════════
// CONFIGURAÇÕES
// ══════════════════════════════════════════════════════════
const cfgOverlay2=document.getElementById('cfgOverlay');
document.getElementById('cfgSave')?.addEventListener('click',async()=>{
  const cfg={
    delay:   parseInt(document.getElementById('cfg-delay-num')?.value||600),
    tokens:  parseInt(document.getElementById('cfg-tokens-num')?.value||1024),
    model:   document.getElementById('cfg-model')?.value||'claude-sonnet-4-6',
    tone:    document.getElementById('cfg-tone')?.value||'casual',
    portais: parseInt(document.getElementById('cfg-portais')?.value||8),
    accent:  document.getElementById('cfg-accent')?.value||'#c9a84c',
    grid:    document.getElementById('cfg-grid')?.classList.contains('on')??true,
    status:  document.getElementById('cfg-status')?.classList.contains('on')??true,
    flash:   document.getElementById('cfg-flash')?.classList.contains('on')??true,
  };
  await apiSet('settings',cfg);
  const df=document.getElementById('delayMs');if(df)df.value=cfg.delay;
  await apiSet('macroDelay',cfg.delay);
  toast('✅ Configurações salvas!','ok');
  setTimeout(()=>cfgOverlay2?.classList.remove('open'),600);
});

document.getElementById('btnClearData')?.addEventListener('click',async()=>{
  if(!confirm('Tem certeza? Remove TODOS os macros, perfis e configurações.'))return;
  await Promise.all([apiSet('macros',[]),apiSet('profiles',[]),apiSet('settings',{}),apiSet('downloadSettings',{})]);
  toast('🗑 Dados limpos!','err');
  setTimeout(()=>location.reload(),800);
});

document.getElementById('btnOpenData')?.addEventListener('click',()=>{
  if(window.fiscobotApp?.openDataDir){window.fiscobotApp.openDataDir((navigator.platform.includes('Win')?'':'')||'~/.fiscobot');}
  else toast('Abra %APPDATA%\\.fiscobot no Explorer','ok');
});

// Aplica configs ao carregar
(async()=>{
  const cfg=(await apiGet('settings'))||{};
  if(cfg.accent){
    document.documentElement.style.setProperty('--gold',cfg.accent);
    document.getElementById('cfg-accent')?.setAttribute('value',cfg.accent);
    const txt=document.getElementById('cfg-accent-txt');if(txt)txt.textContent=cfg.accent;
  }
  if(cfg.status===false)document.querySelectorAll('.pc-status').forEach(el=>el.style.display='none');
  ['model','tone','portais'].forEach(k=>{const el=document.getElementById('cfg-'+k);if(el&&cfg[k])el.value=cfg[k];});
  ['grid','status','flash'].forEach(k=>{const el=document.getElementById('cfg-'+k);if(el&&cfg[k]!==undefined)el.classList.toggle('on',!!cfg[k]);});
  const d=cfg.delay||600;
  const dr=document.getElementById('cfg-delay-range'),dn=document.getElementById('cfg-delay-num');
  if(dr)dr.value=d;if(dn)dn.value=d;
  const t=cfg.tokens||1024;
  const tr=document.getElementById('cfg-tokens-range'),tn=document.getElementById('cfg-tokens-num');
  if(tr)tr.value=t;if(tn)tn.value=t;
})();

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
async function init(){
  await renderMacros();
  await loadProfiles();
  await initToggles();
  await loadCerts();
  setupCertMain();
  const d=await apiGet('macroDelay');if(d){const el=document.getElementById('delayMs');if(el)el.value=d;}
  addLog('FiscoBot Pro 2.0 iniciado.','ok');
  addActivity('FiscoBot Pro 2.0','Sistema iniciado · servidor Express · porta 3737','gold');

  // Verifica status geral
  const certs=await fetch('/api/certs').then(r=>r.json()).catch(()=>({certs:[]}));
  const hasCert=(certs.certs||[]).length>0;
  const heroT=document.getElementById('heroTitle'), heroS=document.getElementById('heroSub');
  const stStatus=document.getElementById('stStatus'), stMeta=document.getElementById('stStatusMeta');
  if(!hasCert){
    if(heroT)heroT.innerHTML='Importar certificado<br><span>para começar.</span>';
    if(heroS)heroS.textContent='Nenhum certificado A1 importado. Acesse Certificados na sidebar para importar seu .pfx.';
    if(stStatus){stStatus.textContent='Atenção';stStatus.style.color='var(--orange)';}
    if(stMeta)stMeta.textContent='sem certificado A1';
    const stBar=document.getElementById('stStatusBar'); if(stBar)stBar.style.background='linear-gradient(90deg,var(--orange),var(--gold))';
  } else {
    if(heroT)heroT.innerHTML='Operação fiscal<br><span>sob controle.</span>';
    if(heroS)heroS.textContent=`${(certs.certs||[]).length} certificado(s) A1 ativo(s). Sistema pronto para consultas SEFAZ e automações.`;
  }
}
init();
