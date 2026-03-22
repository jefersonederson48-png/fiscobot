'use strict';

// ── Default data ──────────────────────────────────
const DEFAULT_DATA = {
  empresas: [
    { id:1, nome:'Empresa Exemplo Ltda',  cnpj:'12.345.678/0001-99', regime:'Simples Nacional', status:'Atenção'  },
    { id:2, nome:'Alpha Comércio S/A',    cnpj:'98.765.432/0001-10', regime:'Lucro Presumido',  status:'Regular'  },
    { id:3, nome:'Beta Serviços ME',      cnpj:'11.222.333/0001-44', regime:'Simples Nacional', status:'Regular'  },
  ],
  tarefas: [
    { id:1, titulo:'Conferir SPED ICMS',         empresa:'Empresa Exemplo Ltda', prioridade:'Crítica'  },
    { id:2, titulo:'Validar certificado A1',      empresa:'Alpha Comércio S/A',   prioridade:'Atenção'  },
    { id:3, titulo:'Revisar EFD-Contribuições',   empresa:'Beta Serviços ME',     prioridade:'Regular'  },
  ],
  obrigacoes: [
    { id:1, titulo:'EFD-Contribuições',  empresa:'Empresa Exemplo Ltda', vencimento:'amanhã',  prioridade:'Crítica' },
    { id:2, titulo:'Fechamento eSocial', empresa:'Alpha Comércio S/A',   vencimento:'3 dias',  prioridade:'Atenção' },
    { id:3, titulo:'DCTF Mensal',        empresa:'Beta Serviços ME',     vencimento:'7 dias',  prioridade:'Atenção' },
  ]
};

// ── State ─────────────────────────────────────────
let STATE = { data: DEFAULT_DATA, certs: [], currentSection: 'dashboard' };

// ── API helpers ───────────────────────────────────
async function apiGet(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
}
async function apiPost(url, body) {
  const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
}
async function loadStore(k)   { const d = await apiGet(`/api/store/${k}`); return d.value; }
async function saveStore(k,v) { await apiPost(`/api/store/${k}`, { value:v }); }

// ── Utils ─────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function badgeClass(level) {
  if (!level) return 'ok';
  const l = level.toLowerCase();
  if (l.includes('crít') || l.includes('problem')) return 'critical';
  if (l.includes('aten') || l.includes('aviso'))   return 'warning';
  return 'ok';
}
function emptyState(icon, msg) {
  return `<div class="empty-state"><div class="empty-state-icon">${icon}</div>${esc(msg)}</div>`;
}
function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return s; }
}

// ── Clock ─────────────────────────────────────────
function startClock() {
  const el = document.getElementById('topbarTime');
  if (!el) return;
  const tick = () => el.textContent = new Date().toLocaleTimeString('pt-BR');
  tick(); setInterval(tick, 1000);
}

// ── Navigation ────────────────────────────────────
function switchSection(id) {
  STATE.currentSection = id;

  // Atualiza menu ativo
  document.querySelectorAll('.menu-item[data-section]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === id);
  });

  // Mostra/oculta seções
  document.querySelectorAll('.page-section').forEach(sec => {
    sec.style.display = sec.id === 'sec-' + id ? 'block' : 'none';
  });

  // Atualiza topbar
  const titles = {
    dashboard:    ['Painel Fiscal',         'Visão Operacional'],
    empresas:     ['Base de Empresas',      'Multiempresa fiscal'],
    obrigacoes:   ['Obrigações Fiscais',    'Controle de vencimentos'],
    certificados: ['Certificados Digitais', 'Gestão de certificados A1'],
    automacoes:   ['Automações',            'Macros e fluxos automáticos'],
    inteligencia: ['Inteligência Fiscal',   'Análise e diagnósticos IA'],
  };
  const [ey, h2] = titles[id] || ['Dashboard', ''];
  const eyEl = document.querySelector('.topbar-left .eyebrow');
  const h2El = document.querySelector('.topbar-left h2');
  if (eyEl) eyEl.textContent = ey;
  if (h2El) h2El.textContent = h2;

  // Re-renderiza seção ativa
  renderSection(id);
}

// ── Render de seções ──────────────────────────────
function renderSection(id) {
  const { data, certs } = STATE;
  switch(id) {
    case 'dashboard':    renderDashboard(data, certs); break;
    case 'empresas':     renderEmpresasSection(data); break;
    case 'obrigacoes':   renderObrigacoesSection(data); break;
    case 'certificados': renderCertificadosSection(certs); break;
    case 'automacoes':   renderAutomacoesSection(); break;
    case 'inteligencia': renderInteligenciaSection(data, certs); break;
  }
}

// ── SECTION: Dashboard ────────────────────────────
function renderDashboard(data, certs) {
  const alerts       = buildAlerts(data, certs);
  const kpiCompanies = (data.empresas   || []).length;
  const kpiCritical  = alerts.filter(a => a.nivel === 'Crítica').length;
  const kpiDue       = (data.obrigacoes || []).length;
  const kpiCerts     = certs.length;

  renderAlerts(alerts);
  renderTasks(data.tarefas || []);
  renderCertsSmall(certs);
  renderCompaniesTable(data.empresas || []);

  animateNum(document.getElementById('kpiCompanies'), kpiCompanies);
  animateNum(document.getElementById('kpiCritical'),  kpiCritical);
  animateNum(document.getElementById('kpiDue'),        kpiDue);
  animateNum(document.getElementById('kpiCerts'),      kpiCerts);

  const setBadge = (id, val, singular, plural) =>
    document.getElementById(id) && (document.getElementById(id).textContent = `${val} ${val!==1?plural:singular}`);
  setBadge('badgeCritical', kpiCritical, 'crítica',     'críticas');
  setBadge('badgeDue',      kpiDue,      'próxima',     'próximas');
  setBadge('badgeCerts',    kpiCerts,    'certificado', 'certificados');

  const sb = document.getElementById('sidebarBadge');
  if (sb) sb.textContent = kpiCritical;

  updateHero(kpiCritical);
}

function renderAlerts(alerts) {
  const root = document.getElementById('alertsList');
  if (!root) return;
  if (!alerts.length) { root.innerHTML = emptyState('○', 'Nenhum alerta no momento.'); return; }
  root.innerHTML = alerts.map(item => `
    <div class="item-row">
      <div class="item-left">
        <div class="item-title">${esc(item.titulo)}</div>
        <div class="item-meta">${esc(item.descricao)}</div>
      </div>
      <div class="item-right">
        <span class="status ${badgeClass(item.nivel)}">${esc(item.nivel)}</span>
      </div>
    </div>`).join('');
}

function renderTasks(tasks) {
  const root = document.getElementById('tasksList');
  if (!root) return;
  if (!tasks.length) { root.innerHTML = emptyState('○', 'Nenhuma tarefa cadastrada.'); return; }
  root.innerHTML = tasks.map((task, idx) => `
    <div class="item-row">
      <div class="item-left">
        <div class="item-title">${esc(task.titulo)}</div>
        <div class="item-meta">${esc(task.empresa)}</div>
      </div>
      <div class="item-right">
        <span class="status ${badgeClass(task.prioridade)}">${esc(task.prioridade)}</span>
        <button class="btn-icon btn-sm" onclick="deleteTask(${idx})" title="Remover">✕</button>
      </div>
    </div>`).join('');
}

function renderCertsSmall(certs) {
  const root = document.getElementById('certsList');
  if (!root) return;
  if (!certs.length) { root.innerHTML = emptyState('◈', 'Nenhum certificado importado.'); return; }
  root.innerHTML = certs.map(cert => `
    <div class="item-row">
      <div class="item-left">
        <div class="item-title">${esc(cert.name)}</div>
        <div class="item-meta">${esc(cert.type||'A1')} · ${(cert.size||0).toLocaleString('pt-BR')} bytes</div>
      </div>
      <div class="item-right"><span class="status ok">Ativo</span></div>
    </div>`).join('');
}

function renderCompaniesTable(empresas) {
  const root = document.getElementById('companiesList');
  if (!root) return;
  if (!empresas.length) { root.innerHTML = emptyState('⊞', 'Nenhuma empresa cadastrada.'); return; }
  root.innerHTML = `
    <div class="company-table">
      <div class="ct-header">
        <span class="ct-th">Empresa</span><span class="ct-th">CNPJ</span>
        <span class="ct-th">Regime</span><span class="ct-th">Status</span>
      </div>
      ${empresas.map(e => `
        <div class="ct-row">
          <div><div class="ct-name">${esc(e.nome)}</div></div>
          <div class="ct-cnpj">${esc(e.cnpj)}</div>
          <div class="ct-regime">${esc(e.regime)}</div>
          <div><span class="status ${badgeClass(e.status)}">${esc(e.status)}</span></div>
        </div>`).join('')}
    </div>`;
}

// ── SECTION: Empresas ─────────────────────────────
function renderEmpresasSection(data) {
  const root = document.getElementById('sec-empresas');
  if (!root) return;
  const empresas = data.empresas || [];
  root.innerHTML = `
    <div class="section-header">
      <div>
        <h3>Empresas cadastradas</h3>
        <p class="section-sub">${empresas.length} empresa${empresas.length!==1?'s':''} monitorada${empresas.length!==1?'s':''}</p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="addEmpresa()">+ Nova empresa</button>
        <button class="btn btn-ghost btn-sm" onclick="seedData()">Carregar exemplo</button>
      </div>
    </div>
    <div class="company-table" style="margin-top:0">
      <div class="ct-header">
        <span class="ct-th">Empresa</span><span class="ct-th">CNPJ</span>
        <span class="ct-th">Regime</span><span class="ct-th">Status</span><span class="ct-th">Ações</span>
      </div>
      ${empresas.length ? empresas.map((e, idx) => `
        <div class="ct-row">
          <div><div class="ct-name">${esc(e.nome)}</div></div>
          <div class="ct-cnpj">${esc(e.cnpj)}</div>
          <div class="ct-regime">${esc(e.regime)}</div>
          <div><span class="status ${badgeClass(e.status)}">${esc(e.status)}</span></div>
          <div style="display:flex;gap:6px">
            <button class="btn-icon btn-sm" onclick="editEmpresa(${idx})" title="Editar">✎</button>
            <button class="btn-icon btn-sm" onclick="deleteEmpresa(${idx})" title="Remover">✕</button>
          </div>
        </div>`).join('') : `<div class="ct-row" style="justify-content:center;color:var(--t3);font-size:12px;padding:24px">Nenhuma empresa cadastrada</div>`}
    </div>`;
}

// ── SECTION: Obrigações ───────────────────────────
function renderObrigacoesSection(data) {
  const root = document.getElementById('sec-obrigacoes');
  if (!root) return;
  const obrig = data.obrigacoes || [];
  root.innerHTML = `
    <div class="section-header">
      <div>
        <h3>Obrigações Fiscais</h3>
        <p class="section-sub">${obrig.length} obrigação${obrig.length!==1?'ões':''} próxima${obrig.length!==1?'s':''}</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="addObrigacao()">+ Nova obrigação</button>
    </div>
    <div class="item-list" style="margin-top:8px">
      ${obrig.length ? obrig.map((o, idx) => `
        <div class="item-row">
          <div class="item-left">
            <div class="item-title">${esc(o.titulo)}</div>
            <div class="item-meta">${esc(o.empresa)} · Vencimento: ${esc(o.vencimento)}</div>
          </div>
          <div class="item-right">
            <span class="status ${badgeClass(o.prioridade)}">${esc(o.prioridade)}</span>
            <button class="btn-icon btn-sm" onclick="deleteObrigacao(${idx})" title="Remover">✕</button>
          </div>
        </div>`).join('') : emptyState('◷', 'Nenhuma obrigação cadastrada.')}
    </div>`;
}

// ── SECTION: Certificados ─────────────────────────
function renderCertificadosSection(certs) {
  const root = document.getElementById('sec-certificados');
  if (!root) return;
  root.innerHTML = `
    <div class="section-header">
      <div>
        <h3>Certificados Digitais A1</h3>
        <p class="section-sub">${certs.length} certificado${certs.length!==1?'s':''} importado${certs.length!==1?'s':''}</p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="window.location.href='/'">Gerenciar no FiscoBot</button>
    </div>
    <div class="item-list" style="margin-top:8px">
      ${certs.length ? certs.map(cert => `
        <div class="item-row">
          <div class="item-left">
            <div class="item-title">◈ ${esc(cert.name)}</div>
            <div class="item-meta">
              Tipo: ${esc(cert.type||'A1')} ·
              Tamanho: ${(cert.size||0).toLocaleString('pt-BR')} bytes ·
              Importado: ${fmtDate(cert.added)}
            </div>
          </div>
          <div class="item-right">
            <span class="status ok">Ativo</span>
          </div>
        </div>`).join('') : `
        <div class="cert-empty-card">
          <div style="font-size:28px;margin-bottom:8px;opacity:.3">◈</div>
          <div style="font-weight:700;margin-bottom:4px">Nenhum certificado importado</div>
          <div style="font-size:11px;color:var(--t3)">Importe um arquivo .pfx na tela principal do FiscoBot (aba Certificados)</div>
          <button class="btn btn-secondary btn-sm" style="margin-top:12px" onclick="window.location.href='/'">← Ir para FiscoBot</button>
        </div>`}
    </div>`;
}

// ── SECTION: Automações ───────────────────────────
function renderAutomacoesSection() {
  const root = document.getElementById('sec-automacoes');
  if (!root) return;
  const items = [
    { nome:'Verificar vencimentos próximos', descricao:'Checa obrigações com prazo menor que 5 dias', status:'Ativo' },
    { nome:'Alertar certificados expirando',  descricao:'Notifica 30 dias antes da expiração do A1', status:'Ativo' },
    { nome:'Sync multiempresa',              descricao:'Consolida dados de todas as empresas da base', status:'Inativo' },
    { nome:'Backup configurações',           descricao:'Exporta configurações para arquivo local',     status:'Inativo' },
  ];
  root.innerHTML = `
    <div class="section-header">
      <div><h3>Automações</h3><p class="section-sub">Fluxos automáticos configurados</p></div>
      <button class="btn btn-ghost btn-sm" onclick="window.location.href='/'">Macros no FiscoBot</button>
    </div>
    <div class="item-list" style="margin-top:8px">
      ${items.map(a => `
        <div class="item-row">
          <div class="item-left">
            <div class="item-title">${esc(a.nome)}</div>
            <div class="item-meta">${esc(a.descricao)}</div>
          </div>
          <div class="item-right">
            <span class="status ${a.status==='Ativo'?'ok':'warning'}">${a.status}</span>
          </div>
        </div>`).join('')}
    </div>`;
}

// ── SECTION: Inteligência ─────────────────────────
function renderInteligenciaSection(data, certs) {
  const root = document.getElementById('sec-inteligencia');
  if (!root) return;
  root.innerHTML = `
    <div class="section-header">
      <div><h3>Inteligência Fiscal</h3><p class="section-sub">Análise automática e diagnósticos</p></div>
      <div style="display:flex;gap:8px">
        <button class="btn-icon btn-sm" id="btnCopyAnalysis2" onclick="copyAnalysis2()" title="Copiar">⎘</button>
        <button class="btn btn-primary btn-sm" onclick="runAnalysisHere()">◎ Analisar agora</button>
      </div>
    </div>
    <div class="analysis-wrap" style="margin-top:12px">
      <div id="analysisBoxHere" class="analysis-box empty">
        <span style="font-size:20px;opacity:.3">◎</span>
        Clique em <strong>Analisar agora</strong> para gerar diagnóstico automático.
      </div>
    </div>`;
}

async function runAnalysisHere() {
  const box = document.getElementById('analysisBoxHere');
  if (!box) return;
  box.classList.remove('empty');
  box.innerHTML = '<span style="color:var(--t3)">Gerando análise...</span>';
  try {
    box.innerHTML = buildAnalysis(STATE.data, STATE.certs);
  } catch {
    box.innerHTML = '<span style="color:var(--red)">Erro ao gerar análise.</span>';
  }
}

function copyAnalysis2() {
  const box = document.getElementById('analysisBoxHere');
  const text = box?.innerText;
  if (!text || box.classList.contains('empty')) return;
  navigator.clipboard?.writeText(text).then(() => {
    const btn = document.getElementById('btnCopyAnalysis2');
    if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = '⎘', 1500); }
  });
}

// ── Build alerts ──────────────────────────────────
function buildAlerts(data, certs) {
  const alerts = [];
  (data.obrigacoes||[]).forEach(o => alerts.push({
    titulo: `${o.titulo} — ${o.empresa}`,
    descricao: `Vencimento em ${o.vencimento}`,
    nivel: o.prioridade,
  }));
  (data.tarefas||[]).filter(t => t.prioridade==='Crítica').forEach(t => alerts.push({
    titulo: t.titulo,
    descricao: `Ação pendente · ${t.empresa}`,
    nivel: 'Crítica',
  }));
  if (!certs.length) alerts.push({
    titulo: 'Certificado A1 não cadastrado',
    descricao: 'Importe um .pfx na aba Certificados para habilitar consultas SEFAZ.',
    nivel: 'Atenção',
  });
  if (!(data.empresas||[]).length) alerts.push({
    titulo: 'Base de empresas vazia',
    descricao: 'Cadastre as empresas para usar o painel multiempresa.',
    nivel: 'Atenção',
  });
  return alerts.slice(0, 8);
}

// ── Build analysis ────────────────────────────────
function buildAnalysis(data, certs) {
  const e = data.empresas   || [];
  const t = data.tarefas    || [];
  const o = data.obrigacoes || [];
  const critT = t.filter(x => x.prioridade==='Crítica').length;
  const critO = o.filter(x => x.prioridade==='Crítica').length;
  const total = critT + critO;
  const risco = total>=3?'ALTO':total>=1?'MÉDIO':'BAIXO';
  const rc = risco==='ALTO'?'risk-high':risco==='MÉDIO'?'risk-medium':'risk-low';
  return [
    `DIAGNÓSTICO FISCAL — ${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}`,
    `${'─'.repeat(52)}`,
    `Risco fiscal estimado ........ <span class="${rc}">${risco}</span>`,
    ``,
    `Empresas monitoradas ......... ${e.length}`,
    `Tarefas pendentes ............ ${t.length}  (${critT} crítica${critT!==1?'s':''})`,
    `Obrigações próximas .......... ${o.length}  (${critO} crítica${critO!==1?'s':''})`,
    `Certificados A1 ativos ....... ${certs.length}`,
    ``, `RECOMENDAÇÕES`, `${'─'.repeat(52)}`,
    total > 0
      ? `↳ Priorizar ${total} item${total!==1?'s':''} crítico${total!==1?'s':''} antes de qualquer outra ação.`
      : `↳ Sem itens críticos no momento. Operação estável.`,
    !certs.length
      ? `↳ Importar certificado A1 (.pfx) para habilitar consultas reais à SEFAZ.`
      : `↳ Manter conferência periódica dos certificados para evitar falhas de autenticação.`,
    e.length > 0
      ? `↳ Consolidar visão multiempresa com status de compliance por CNPJ.`
      : `↳ Cadastrar empresas para estruturar a operação contábil no painel.`,
    `↳ Próximo passo: conectar módulo de IA para recomendações automáticas por empresa.`,
  ].join('\n');
}

// ── Hero ──────────────────────────────────────────
function updateHero(kpiCritical) {
  const msg = document.getElementById('heroMessage');
  const sub = document.getElementById('heroSubtitle');
  if (!msg||!sub) return;
  if (kpiCritical > 0) {
    msg.textContent = `${kpiCritical} pendência${kpiCritical>1?'s':''} fiscal${kpiCritical>1?'is':''} exige${kpiCritical>1?'m':''} atenção hoje.`;
    sub.textContent = 'Resolva os itens críticos antes das obrigações com vencimento próximo.';
  } else {
    msg.textContent = 'Operação fiscal sob controle no momento.';
    sub.textContent = 'Bom momento para evoluir automações e ampliar a visão multiempresa.';
  }
}

// ── Animate number ────────────────────────────────
function animateNum(el, target) {
  if (!el) return;
  const start = performance.now();
  const update = (now) => {
    const p = Math.min((now-start)/400, 1);
    const ease = 1 - Math.pow(1-p, 3);
    el.textContent = Math.round(ease * target);
    if (p < 1) requestAnimationFrame(update); else el.textContent = target;
  };
  requestAnimationFrame(update);
}

// ── Hydrate (carrega dados e renderiza) ───────────
async function hydrateDashboard() {
  const refreshIcon = document.getElementById('refreshIcon');
  if (refreshIcon) refreshIcon.style.transform = 'rotate(360deg)';
  try {
    let data = await loadStore('dashboardData');
    if (!data) { data = DEFAULT_DATA; await saveStore('dashboardData', data); }
    const certsRes = await apiGet('/api/certs');
    const certs    = certsRes.certs || [];
    STATE.data  = data;
    STATE.certs = certs;
    renderSection(STATE.currentSection);
    return { data, certs };
  } catch(err) {
    console.error('Dashboard hydrate error:', err);
    const msg = document.getElementById('heroMessage');
    const sub = document.getElementById('heroSubtitle');
    if (msg) msg.textContent = 'Erro ao carregar o painel.';
    if (sub) sub.textContent = 'Verifique se o servidor FiscoBot está em execução na porta 3737.';
    throw err;
  } finally {
    setTimeout(() => { if (refreshIcon) refreshIcon.style.transform = ''; }, 600);
  }
}

// ── CRUD: Empresas ────────────────────────────────
async function addEmpresa() {
  const nome   = prompt('Nome da empresa:'); if (!nome?.trim()) return;
  const cnpj   = prompt('CNPJ (formato: 00.000.000/0001-00):') || '';
  const regime = prompt('Regime (Simples Nacional / Lucro Presumido / Lucro Real):') || 'Simples Nacional';
  STATE.data.empresas = STATE.data.empresas || [];
  STATE.data.empresas.push({ id: Date.now(), nome: nome.trim(), cnpj: cnpj.trim(), regime: regime.trim(), status: 'Regular' });
  await saveStore('dashboardData', STATE.data);
  await hydrateDashboard();
}
async function editEmpresa(idx) {
  const e = STATE.data.empresas[idx]; if (!e) return;
  const nome = prompt('Nome:', e.nome); if (!nome?.trim()) return;
  STATE.data.empresas[idx].nome = nome.trim();
  await saveStore('dashboardData', STATE.data);
  await hydrateDashboard();
}
async function deleteEmpresa(idx) {
  if (!confirm('Remover empresa?')) return;
  STATE.data.empresas.splice(idx, 1);
  await saveStore('dashboardData', STATE.data);
  await hydrateDashboard();
}

// ── CRUD: Obrigações ──────────────────────────────
async function addObrigacao() {
  const titulo     = prompt('Nome da obrigação:'); if (!titulo?.trim()) return;
  const empresa    = prompt('Empresa responsável:') || 'Geral';
  const vencimento = prompt('Prazo (ex: amanhã, 3 dias, 15/04/2026):') || 'a definir';
  const prioridade = prompt('Prioridade (Crítica / Atenção / Regular):') || 'Atenção';
  STATE.data.obrigacoes = STATE.data.obrigacoes || [];
  STATE.data.obrigacoes.unshift({ id: Date.now(), titulo: titulo.trim(), empresa: empresa.trim(), vencimento: vencimento.trim(), prioridade: prioridade.trim() });
  await saveStore('dashboardData', STATE.data);
  await hydrateDashboard();
}
async function deleteObrigacao(idx) {
  if (!confirm('Remover obrigação?')) return;
  STATE.data.obrigacoes.splice(idx, 1);
  await saveStore('dashboardData', STATE.data);
  await hydrateDashboard();
}

// ── CRUD: Tarefas ─────────────────────────────────
async function deleteTask(idx) {
  STATE.data.tarefas.splice(idx, 1);
  await saveStore('dashboardData', STATE.data);
  await hydrateDashboard();
}
async function addTask() {
  const title = prompt('Nome da tarefa fiscal:'); if (!title?.trim()) return;
  STATE.data.tarefas = STATE.data.tarefas || [];
  STATE.data.tarefas.unshift({
    id: Date.now(), titulo: title.trim(),
    empresa: STATE.data.empresas?.[0]?.nome || 'Geral',
    prioridade: 'Atenção',
  });
  await saveStore('dashboardData', STATE.data);
  await hydrateDashboard();
}

// ── Seed ──────────────────────────────────────────
async function seedData() {
  if (!confirm('Substituir dados atuais pelos dados de exemplo?')) return;
  STATE.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  await saveStore('dashboardData', STATE.data);
  await hydrateDashboard();
}

// ── Dashboard actions ─────────────────────────────
async function runAnalysis() {
  const box = document.getElementById('analysisBox');
  if (!box) return;
  box.classList.remove('empty');
  box.innerHTML = '<span style="color:var(--t3)">Gerando análise...</span>';
  try {
    const { data, certs } = await hydrateDashboard();
    box.innerHTML = buildAnalysis(data, certs);
  } catch {
    box.innerHTML = '<span style="color:var(--red)">Erro ao gerar análise.</span>';
  }
}
function copyAnalysis() {
  const box = document.getElementById('analysisBox');
  const text = box?.innerText;
  if (!text || box.classList.contains('empty')) return;
  navigator.clipboard?.writeText(text).then(() => {
    const btn = document.getElementById('btnCopyAnalysis');
    if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = '⎘', 1500); }
  });
}

// ── Event listeners ───────────────────────────────
document.getElementById('btnAnalyze')?.addEventListener('click', runAnalysis);
document.getElementById('btnRefresh')?.addEventListener('click', hydrateDashboard);
document.getElementById('btnAddTask')?.addEventListener('click', addTask);
document.getElementById('btnSeed')?.addEventListener('click', seedData);
document.getElementById('btnCopyAnalysis')?.addEventListener('click', copyAnalysis);

// Navegação sidebar
document.querySelectorAll('.menu-item[data-section]').forEach(btn => {
  btn.addEventListener('click', () => switchSection(btn.dataset.section));
});

// ── Boot ──────────────────────────────────────────
startClock();
hydrateDashboard();
