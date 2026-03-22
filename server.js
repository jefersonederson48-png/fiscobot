'use strict';

const express  = require('express');
const http     = require('http');
const WebSocket = require('ws');
const path     = require('path');
const fs       = require('fs');
const https    = require('https');
const crypto   = require('crypto');
const os       = require('os');
const { exec } = require('child_process');

const PORT      = process.env.PORT || 3737;
const DATA_DIR  = process.env.DATA_DIR || path.join(os.homedir(), '.fiscobot');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const KEY_FILE  = path.join(DATA_DIR, 'key.enc');
const CERT_DIR  = path.join(DATA_DIR, 'certs');
const AUTH_FILE = path.join(DATA_DIR, 'users.enc');  // usuários criptografados
const SESS_FILE = path.join(DATA_DIR, 'sessions.json'); // sessões ativas

// ── Express + HTTP server ─────────────────────────
const app    = express();
const server = http.createServer(app);
const { IpFilter } = require('express-ipfilter');

app.use(express.json({ limit:'10mb' }));

// Lista de IPs permitidos (incluindo Localhost e os solicitados)
const allowedIps = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '74.220.48.0/24', '74.220.56.0/24'];
app.use(IpFilter(allowedIps, { mode: 'allow', log: false }));

app.use(express.static(path.join(__dirname,'public')));

// Garante pastas de dados
[DATA_DIR, CERT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Storage ───────────────────────────────────────
function loadData()       { try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf-8')); } catch { return {}; } }
function getData(k)       { return loadData()[k] ?? null; }
function setData(k, v)    { const d=loadData(); d[k]=v; fs.writeFileSync(DATA_FILE, JSON.stringify(d,null,2)); }

// ══════════════════════════════════════════════════
// SISTEMA DE AUTENTICAÇÃO
// ══════════════════════════════════════════════════

// Usuário admin padrão (criado na primeira execução)
const DEFAULT_ADMIN = {
  id: 1,
  nome: 'Administrador',
  email: 'admin@fiscobot.local',
  senha: 'admin123',  // será criptografada no save
  role: 'admin',
};

// Carrega lista de usuários (descriptografada)
function loadUsers() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return [DEFAULT_ADMIN];
    return JSON.parse(decrypt(fs.readFileSync(AUTH_FILE, 'utf8')));
  } catch { return [DEFAULT_ADMIN]; }
}

// Salva lista de usuários (criptografada)
function saveUsers(users) {
  fs.writeFileSync(AUTH_FILE, encrypt(JSON.stringify(users)), { mode: 0o600 });
}

// Garante que o admin padrão existe
function ensureDefaultAdmin() {
  if (!fs.existsSync(AUTH_FILE)) {
    saveUsers([DEFAULT_ADMIN]);
  }
}

// Sessões em memória + persistência
let SESSIONS = {};
function loadSessions() {
  try {
    if (fs.existsSync(SESS_FILE))
      SESSIONS = JSON.parse(fs.readFileSync(SESS_FILE, 'utf8'));
  } catch { SESSIONS = {}; }
}
function saveSessions() {
  try { fs.writeFileSync(SESS_FILE, JSON.stringify(SESSIONS), { mode: 0o600 }); } catch {}
}
function createToken() { return crypto.randomBytes(32).toString('hex'); }
function getSession(token) {
  const s = SESSIONS[token];
  if (!s) return null;
  // Sessão expira em 8 horas
  if (Date.now() - s.createdAt > 8 * 60 * 60 * 1000) {
    delete SESSIONS[token]; saveSessions(); return null;
  }
  return s;
}
function requireAuth(req, res, next) {
  const token = req.headers['x-fb-token'] || req.query.token;
  if (!token || !getSession(token)) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  req.session = getSession(token);
  next();
}

// ── Rota: Login ──────────────────────────────────
app.post('/api/auth/login', (q, r) => {
  const { email, senha } = q.body || {};
  if (!email || !senha) return r.status(400).json({ error: 'Email e senha obrigatórios.' });

  const users = loadUsers();
  const user  = users.find(u =>
    u.email.toLowerCase() === email.toLowerCase().trim() && u.senha === senha
  );

  if (!user) return r.status(401).json({ error: 'Email ou senha incorretos.' });

  const token = createToken();
  SESSIONS[token] = {
    token,
    userId:    user.id,
    userName:  user.nome,
    userEmail: user.email,
    role:      user.role || 'user',
    createdAt: Date.now(),
  };
  saveSessions();

  r.json({
    ok: true,
    token,
    user: { id: user.id, nome: user.nome, email: user.email, role: user.role || 'user' },
  });
});

// ── Rota: Verificar sessão ────────────────────────
app.get('/api/auth/check', (q, r) => {
  const token = q.headers['x-fb-token'] || q.query.token;
  const sess  = token ? getSession(token) : null;
  if (sess) {
    r.json({ ok: true, user: { nome: sess.userName, email: sess.userEmail, role: sess.role } });
  } else {
    r.json({ ok: false });
  }
});

// ── Rota: Logout ──────────────────────────────────
app.post('/api/auth/logout', (q, r) => {
  const token = q.headers['x-fb-token'] || q.body?.token;
  if (token && SESSIONS[token]) { delete SESSIONS[token]; saveSessions(); }
  r.json({ ok: true });
});

// ── Rota: Listar usuários (admin) ─────────────────
app.get('/api/auth/users', requireAuth, (q, r) => {
  if (q.session.role !== 'admin')
    return r.status(403).json({ error: 'Apenas administradores podem listar usuários.' });
  const users = loadUsers().map(u => ({ id:u.id, nome:u.nome, email:u.email, role:u.role||'user' }));
  r.json({ users });
});

// ── Rota: Criar usuário (admin) ───────────────────
app.post('/api/auth/users', requireAuth, (q, r) => {
  if (q.session.role !== 'admin')
    return r.status(403).json({ error: 'Apenas administradores podem criar usuários.' });

  const { nome, email, senha, role } = q.body || {};
  if (!nome || !email || !senha)
    return r.status(400).json({ error: 'nome, email e senha são obrigatórios.' });

  const users = loadUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
    return r.status(409).json({ error: 'Email já cadastrado.' });

  const newUser = {
    id:    Date.now(),
    nome:  nome.trim(),
    email: email.trim().toLowerCase(),
    senha: senha,
    role:  role === 'admin' ? 'admin' : 'user',
  };
  users.push(newUser);
  saveUsers(users);
  r.json({ ok: true, user: { id:newUser.id, nome:newUser.nome, email:newUser.email, role:newUser.role } });
});

// ── Rota: Atualizar usuário (admin ou próprio) ────
app.put('/api/auth/users/:id', requireAuth, (q, r) => {
  const id    = parseInt(q.params.id);
  const sess  = q.session;
  const users = loadUsers();
  const idx   = users.findIndex(u => u.id === id);

  if (idx === -1) return r.status(404).json({ error: 'Usuário não encontrado.' });
  if (sess.role !== 'admin' && sess.userId !== id)
    return r.status(403).json({ error: 'Sem permissão para editar este usuário.' });

  const { nome, email, senha, role } = q.body || {};
  if (nome)  users[idx].nome  = nome.trim();
  if (email) users[idx].email = email.trim().toLowerCase();
  if (senha) users[idx].senha = senha;
  // Só admin pode mudar role
  if (role && sess.role === 'admin') users[idx].role = role === 'admin' ? 'admin' : 'user';

  saveUsers(users);
  r.json({ ok: true, user: { id:users[idx].id, nome:users[idx].nome, email:users[idx].email, role:users[idx].role } });
});

// ── Rota: Remover usuário (admin) ─────────────────
app.delete('/api/auth/users/:id', requireAuth, (q, r) => {
  if (q.session.role !== 'admin')
    return r.status(403).json({ error: 'Apenas administradores podem remover usuários.' });

  const id    = parseInt(q.params.id);
  let   users = loadUsers();
  if (!users.find(u => u.id === id)) return r.status(404).json({ error: 'Usuário não encontrado.' });
  if (users.filter(u => u.role === 'admin').length <= 1 && users.find(u => u.id === id)?.role === 'admin')
    return r.status(400).json({ error: 'Não é possível remover o único administrador.' });

  users = users.filter(u => u.id !== id);
  saveUsers(users);
  r.json({ ok: true });
});

// ── Rota da página de login ───────────────────────
app.get('/login', (_, r) => r.sendFile(path.join(__dirname, 'public', 'login.html')));


// ── Cripto API Key ────────────────────────────────
function secret() {
  const f = path.join(DATA_DIR,'.secret');
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const s = crypto.randomBytes(32);
  fs.writeFileSync(f, s, { mode:0o600 });
  return s;
}
function encrypt(text) {
  const iv=crypto.randomBytes(12), c=crypto.createCipheriv('aes-256-gcm',secret(),iv);
  const e=Buffer.concat([c.update(text,'utf8'),c.final()]);
  return Buffer.concat([iv,c.getAuthTag(),e]).toString('base64');
}
function decrypt(b64) {
  const b=Buffer.from(b64,'base64');
  const d=crypto.createDecipheriv('aes-256-gcm',secret(),b.slice(0,12));
  d.setAuthTag(b.slice(12,28));
  return Buffer.concat([d.update(b.slice(28)),d.final()]).toString('utf8');
}

// ── Express já inicializado no topo do arquivo ───

// Rota para a Conferência NF-e (React via CDN)
app.get('/conferencia', (_,res) => {
  res.sendFile(path.join(__dirname,'public','conferencia.html'));
});

// Rota para o Tutorial / Ajuda
app.get('/ajuda', (_,res) => {
  res.sendFile(path.join(__dirname,'public','ajuda.html'));
});

// Rota para o Dashboard fiscal
app.get('/dashboard', (_,res) => {
  res.sendFile(path.join(__dirname,'public','dashboard.html'));
});

// Rota para integração Domínio
app.get('/dominio', (_,res) => {
  res.sendFile(path.join(__dirname,'public','dominio.html'));
});

// ── Storage API ───────────────────────────────────
const VALID_KEY = /^[a-zA-Z0-9_\-:]{1,100}$/;
app.get ('/api/store/:k', (q,r) => {
  const k = q.params.k;
  if (!VALID_KEY.test(k)) return r.status(400).json({ error:'Chave inválida' });
  r.json({ value: getData(k) });
});
app.post('/api/store/:k', (q,r) => {
  const k = q.params.k;
  if (!VALID_KEY.test(k)) return r.status(400).json({ error:'Chave inválida' });
  const v = q.body?.value;
  if (v === undefined) return r.status(400).json({ error:'value obrigatório' });
  setData(k, v);
  r.json({ ok:true });
});

// ── API Key ───────────────────────────────────────
app.post('/api/key/save', (q,r) => {
  const k = q.body?.key||'';
  if (!k.startsWith('sk-ant-')||k.length<40) return r.status(400).json({ error:'Key inválida' });
  try { fs.writeFileSync(KEY_FILE, encrypt(k), { mode:0o600 }); r.json({ ok:true }); }
  catch(e) { r.status(500).json({ error:e.message }); }
});
app.get   ('/api/key/exists', (_,r) => r.json({ exists: fs.existsSync(KEY_FILE) }));
app.delete('/api/key',        (_,r) => { try { fs.unlinkSync(KEY_FILE); } catch {} r.json({ ok:true }); });

// ── Certificados ──────────────────────────────────
app.post('/api/certs/upload', (q,r) => {
  const { name, type='A1', data, password } = q.body||{};
  if (!name||!data) return r.status(400).json({ error:'name e data obrigatórios' });
  const safe = name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);
  try {
    fs.writeFileSync(path.join(CERT_DIR,safe), Buffer.from(data,'base64'), { mode:0o600 });
    fs.writeFileSync(path.join(CERT_DIR,safe+'.meta.json'),
      JSON.stringify({ name:safe, type, size:Buffer.from(data,'base64').length,
        added:new Date().toISOString(), encPass: password?encrypt(password):null }), { mode:0o600 });
    r.json({ ok:true, name:safe });
  } catch(e) { r.status(500).json({ error:e.message }); }
});
app.get('/api/certs', (_,r) => {
  try {
    const files = fs.readdirSync(CERT_DIR).filter(f=>!f.endsWith('.meta.json'));
    const certs = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(CERT_DIR,f+'.meta.json'),'utf8')); }
      catch { return { name:f, type:'A1', size:0, added:'' }; }
    });
    r.json({ certs });
  } catch { r.json({ certs:[] }); }
});
app.get('/api/certs/download/:name', (q,r) => {
  const safe = q.params.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);
  const p = path.join(CERT_DIR,safe);
  if (!fs.existsSync(p)) return r.status(404).json({ error:'Não encontrado' });
  r.setHeader('Content-Disposition',`attachment; filename="${safe}"`);
  fs.createReadStream(p).pipe(r);
});
app.delete('/api/certs/:name', (q,r) => {
  const safe = q.params.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);
  try {
    const p = path.join(CERT_DIR,safe);
    if (fs.existsSync(p))          fs.unlinkSync(p);
    if (fs.existsSync(p+'.meta.json')) fs.unlinkSync(p+'.meta.json');
    r.json({ ok:true });
  } catch(e) { r.status(500).json({ error:e.message }); }
});

// ══════════════════════════════════════════════════
// CONSULTA SEFAZ — NF-e (WebService real)
// ══════════════════════════════════════════════════

// Mapa cUF → endpoint SEFAZ produção
const SEFAZ_ENDPOINTS = {
  // Estados com servidor próprio
  '13': { host:'nfe.sefaz.am.gov.br',   path:'/services2/NfeConsulta2' },  // AM
  '29': { host:'nfe.sefaz.ba.gov.br',   path:'/webservices/NfeConsulta2/NfeConsulta2.asmx' }, // BA
  '23': { host:'nfe.sefaz.ce.gov.br',   path:'/nfe2/services/NfeConsulta2' }, // CE
  '52': { host:'nfe.sefaz.go.gov.br',   path:'/nfe/services/NfeConsulta2' }, // GO
  '31': { host:'nfe.fazenda.mg.gov.br', path:'/nfe2/services/NfeConsulta2' }, // MG
  '50': { host:'nfe.fazenda.ms.gov.br', path:'/nfe2/services/NfeConsulta2' }, // MS
  '51': { host:'nfe.sefaz.mt.gov.br',   path:'/nfe/services/NfeConsulta2'  }, // MT
  '26': { host:'nfe.sefaz.pe.gov.br',   path:'/nfe-service/NfeConsulta2'  }, // PE
  '41': { host:'nfe.fazenda.pr.gov.br', path:'/nfe/NFeConsulta2Service'    }, // PR
  '43': { host:'nfe.sefaz.rs.gov.br',   path:'/ws/NfeConsulta/NfeConsulta2.asmx' }, // RS
  '42': { host:'nfe.sef.sc.gov.br',     path:'/nfe/services/NfeConsulta2'  }, // SC
  '35': { host:'nfe.fazenda.sp.gov.br', path:'/nfeWEB/services/NfeConsulta2.asmx' }, // SP
  // Demais estados usam SVRS (Sefaz Virtual RS)
  'svrs': { host:'nfe.svrs.fazenda.gov.br', path:'/ws/NfeConsulta/NfeConsulta2.asmx' },
};

// Estados que usam SVRS
const SVRS_STATES = new Set(['11','12','14','15','16','17','21','22','24','25','27','28','32','33','53']);

function getSefazEndpoint(cuf) {
  const cuF = String(cuf).padStart(2,'0');
  // Estados com webservice próprio têm prioridade
  if (SEFAZ_ENDPOINTS[cuF]) return SEFAZ_ENDPOINTS[cuF];
  // Demais estados usam SVRS (Sefaz Virtual do RS)
  if (SVRS_STATES.has(cuF)) return SEFAZ_ENDPOINTS['svrs'];
  // Fallback final: SVRS
  return SEFAZ_ENDPOINTS['svrs'];
}

function buildSoapEnvelope(chave, cuf) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeConsulta2">
      <cUF>${cuf}</cUF>
      <versaoDados>4.00</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeConsulta2">
      <consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>1</tpAmb>
        <xServ>CONSULTAR</xServ>
        <chNFe>${chave}</chNFe>
      </consSitNFe>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`;
}

function parseSefazResponse(xml) {
  // Extrai cStat e xMotivo do XML de resposta
  const cStatMatch  = xml.match(/<cStat>(\d+)<\/cStat>/);
  const xMotivoMatch = xml.match(/<xMotivo>([^<]+)<\/xMotivo>/);
  const cStat  = cStatMatch  ? parseInt(cStatMatch[1])  : null;
  const xMotivo = xMotivoMatch ? xMotivoMatch[1].trim()  : 'Sem resposta';

  if (!cStat) return { status:'Erro', motivo:'Resposta inválida da SEFAZ', cStat:null };

  // Mapeamento dos principais cStat NF-e
  const statusMap = {
    100: 'Autorizada',
    101: 'Cancelada',
    102: 'Inutilizada',
    110: 'Denegada',
    135: 'Cancelada',   // Cancelamento homologado fora do prazo
    155: 'Cancelada',   // Cancelamento extemporâneo homologado
    217: 'Não encontrada',
    301: 'Denegada',    // Uso Denegado - irregularidade fiscal emitente
    302: 'Denegada',    // Uso Denegado - irregularidade fiscal destinatário
  };

  const status = statusMap[cStat] || (cStat >= 200 && cStat < 300 ? 'Erro' : 'Desconhecido');
  return { status, motivo: xMotivo, cStat };
}

async function consultarNFeSEFAZ(chave, pfxBuffer, passphrase) {
  const cuf = chave.substring(0, 2);
  const endpoint = getSefazEndpoint(cuf);
  const soap = buildSoapEnvelope(chave, cuf);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: endpoint.host,
      port: 443,
      path: endpoint.path,
      method: 'POST',
      headers: {
        'Content-Type':  'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(soap),
        'SOAPAction':    '"http://www.portalfiscal.inf.br/nfe/wsdl/NfeConsulta2/nfeConsultaNF"',
      },
      // Certificado A1 para autenticação mútua TLS
      pfx: pfxBuffer,
      passphrase: passphrase || '',
      rejectUnauthorized: false, // Aceita certificado SEFAZ (cadeia ICP-Brasil)
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk.toString());
      res.on('end', () => {
        try {
          const result = parseSefazResponse(body);
          resolve(result);
        } catch(e) {
          reject(new Error('Erro ao interpretar resposta SEFAZ: ' + e.message));
        }
      });
    });

    req.on('error', (e) => reject(new Error('Conexão SEFAZ falhou: ' + e.message)));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout SEFAZ (15s)')); });
    req.write(soap);
    req.end();
  });
}

// Endpoint: consulta uma chave NF-e na SEFAZ real
app.post('/api/sefaz/consultar', async (q, r) => {
  const { chave, certName, passphrase } = q.body || {};

  if (!chave || chave.length !== 44) {
    return r.json({ status: 'Chave inválida', motivo: 'Chave deve ter 44 dígitos', cStat: null });
  }

  // Determina qual certificado usar
  let pfxBuffer = null;
  let pass      = passphrase || '';

  if (certName) {
    // Certificado específico informado
    const certPath = path.join(CERT_DIR, certName.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100));
    if (fs.existsSync(certPath)) {
      pfxBuffer = fs.readFileSync(certPath);
      // Tenta recuperar senha salva
      const metaPath = certPath + '.meta.json';
      if (!pass && fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          if (meta.encPass) pass = decrypt(meta.encPass);
        } catch {}
      }
    }
  } else {
    // Usa o primeiro certificado A1 disponível
    try {
      const files = fs.readdirSync(CERT_DIR).filter(f => !f.endsWith('.meta.json'));
      for (const f of files) {
        const ext = f.toLowerCase();
        if (ext.endsWith('.pfx') || ext.endsWith('.p12')) {
          pfxBuffer = fs.readFileSync(path.join(CERT_DIR, f));
          const metaPath = path.join(CERT_DIR, f + '.meta.json');
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              if (meta.encPass) pass = decrypt(meta.encPass);
            } catch {}
          }
          break;
        }
      }
    } catch {}
  }

  if (!pfxBuffer) {
    return r.json({ status: 'Sem certificado', motivo: 'Nenhum certificado A1 (.pfx) encontrado. Importe um na aba Certificados.', cStat: null });
  }

  try {
    const result = await consultarNFeSEFAZ(chave, pfxBuffer, pass);
    r.json(result);
  } catch(e) {
    r.json({ status: 'Erro', motivo: e.message, cStat: null });
  }
});

// Endpoint: consulta múltiplas chaves (batch) com progresso via SSE
app.post('/api/sefaz/consultar-lote', (q, r) => {
  const { chaves, certName, passphrase } = q.body || {};
  if (!Array.isArray(chaves) || chaves.length === 0) {
    return r.status(400).json({ error: 'Lista de chaves obrigatória' });
  }

  r.setHeader('Content-Type',  'text/event-stream');
  r.setHeader('Cache-Control', 'no-cache');
  r.setHeader('Connection',    'keep-alive');
  r.flushHeaders();

  const send = (ev, data) => r.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

  // Carrega certificado uma vez
  let pfxBuffer = null;
  let pass      = passphrase || '';

  (async () => {
    // Carrega certificado
    if (certName) {
      const cp = path.join(CERT_DIR, certName.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100));
      if (fs.existsSync(cp)) {
        pfxBuffer = fs.readFileSync(cp);
        const mp = cp + '.meta.json';
        if (!pass && fs.existsSync(mp)) {
          try { const m=JSON.parse(fs.readFileSync(mp,'utf8')); if(m.encPass)pass=decrypt(m.encPass); } catch {}
        }
      }
    } else {
      try {
        const files = fs.readdirSync(CERT_DIR).filter(f=>!f.endsWith('.meta.json'));
        for (const f of files) {
          if (f.toLowerCase().endsWith('.pfx')||f.toLowerCase().endsWith('.p12')) {
            pfxBuffer = fs.readFileSync(path.join(CERT_DIR,f));
            const mp = path.join(CERT_DIR,f+'.meta.json');
            if (fs.existsSync(mp)) { try{const m=JSON.parse(fs.readFileSync(mp,'utf8'));if(m.encPass)pass=decrypt(m.encPass);}catch{} }
            break;
          }
        }
      } catch {}
    }

    if (!pfxBuffer) {
      send('erro-global', { mensagem: 'Nenhum certificado A1 (.pfx) encontrado. Importe um na aba Certificados.' });
      r.end(); return;
    }

    for (let i = 0; i < chaves.length; i++) {
      const chave = chaves[i];
      try {
        const resultado = await consultarNFeSEFAZ(chave, pfxBuffer, pass);
        send('resultado', { chave, ...resultado, idx: i, total: chaves.length });
      } catch(e) {
        send('resultado', { chave, status: 'Erro', motivo: e.message, cStat: null, idx: i, total: chaves.length });
      }
      // Pequena pausa para não sobrecarregar a SEFAZ
      await new Promise(res => setTimeout(res, 80));
    }

    send('concluido', { total: chaves.length });
    r.end();
  })();
});

// ══════════════════════════════════════════════════
// SIEG HUB — Integração automática de NF-e
// ══════════════════════════════════════════════════

const SIEG_KEY_FILE = path.join(DATA_DIR, 'sieg.enc');

// Salva / lê API Key do SIEG criptografada
app.post('/api/sieg/key/save', (q, r) => {
  const k = q.body?.key || '';
  if (!k || k.length < 8) return r.status(400).json({ error: 'Key inválida' });
  try {
    fs.writeFileSync(SIEG_KEY_FILE, encrypt(k), { mode: 0o600 });
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});
app.get   ('/api/sieg/key/exists', (_,r) => r.json({ exists: fs.existsSync(SIEG_KEY_FILE) }));
app.delete('/api/sieg/key',        (_,r) => { try { fs.unlinkSync(SIEG_KEY_FILE); } catch {} r.json({ ok: true }); });

// ── Busca notas do SIEG e consulta SEFAZ — SSE stream ──
// SIEG Hub API: https://api.sieg.com
// Endpoint principal: GET /DownloadXmls?apiKey=...&...
app.post('/api/sieg/conferir', (q, r) => {
  if (!fs.existsSync(SIEG_KEY_FILE))
    return r.status(401).json({ error: 'API Key do SIEG não configurada.' });

  let siegKey;
  try { siegKey = decrypt(fs.readFileSync(SIEG_KEY_FILE, 'utf8')); }
  catch { return r.status(500).json({ error: 'Erro ao ler API Key do SIEG.' }); }

  r.setHeader('Content-Type',  'text/event-stream');
  r.setHeader('Cache-Control', 'no-cache');
  r.setHeader('Connection',    'keep-alive');
  r.flushHeaders();

  const send = (ev, data) => r.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

  const {
    cnpj,       // CNPJ da empresa (obrigatório)
    dataInicio, // YYYY-MM-DD
    dataFim,    // YYYY-MM-DD
    tipo,       // 'entrada' | 'saida' | 'ambos'
    certName,
    passphrase,
  } = q.body || {};

  if (!cnpj) {
    send('erro-global', { mensagem: 'CNPJ da empresa é obrigatório.' });
    r.end(); return;
  }

  (async () => {
    // ── 1. Carrega certificado ────────────────────────
    let pfxBuffer = null, pass = passphrase || '';
    if (certName) {
      const cp = path.join(CERT_DIR, certName.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100));
      if (fs.existsSync(cp)) {
        pfxBuffer = fs.readFileSync(cp);
        const mp = cp + '.meta.json';
        if (!pass && fs.existsSync(mp)) {
          try { const m=JSON.parse(fs.readFileSync(mp,'utf8')); if(m.encPass)pass=decrypt(m.encPass); } catch {}
        }
      }
    } else {
      try {
        const files = fs.readdirSync(CERT_DIR).filter(f=>!f.endsWith('.meta.json'));
        for (const f of files) {
          if (f.toLowerCase().endsWith('.pfx')||f.toLowerCase().endsWith('.p12')) {
            pfxBuffer = fs.readFileSync(path.join(CERT_DIR,f));
            const mp = path.join(CERT_DIR,f+'.meta.json');
            if (fs.existsSync(mp)) { try{const m=JSON.parse(fs.readFileSync(mp,'utf8'));if(m.encPass)pass=decrypt(m.encPass);}catch{} }
            break;
          }
        }
      } catch {}
    }

    // ── 2. Busca notas no SIEG Hub ────────────────────
    send('status', { mensagem: 'Buscando notas no SIEG Hub...' });

    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const hoje = new Date();
    const inicio = dataInicio || new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0,10);
    const fim    = dataFim    || hoje.toISOString().slice(0,10);

    let notas = [];

    try {
      // SIEG Hub API — busca NF-e por CNPJ e período
      const siegNotas = await buscarNotasSIEG(siegKey, cnpjLimpo, inicio, fim, tipo || 'ambos');
      notas = siegNotas;
      send('status', { mensagem: `${notas.length} nota(s) encontrada(s) no SIEG. Iniciando conferência SEFAZ...` });
    } catch(e) {
      send('erro-global', { mensagem: `Erro ao buscar no SIEG: ${e.message}` });
      r.end(); return;
    }

    if (!notas.length) {
      send('concluido', { total: 0, mensagem: 'Nenhuma nota encontrada no período informado.' });
      r.end(); return;
    }

    // ── 3. Confere cada nota na SEFAZ ─────────────────
    if (!pfxBuffer) {
      // Sem certificado → retorna só os dados SIEG sem conferência SEFAZ
      notas.forEach((nota, idx) => {
        send('resultado', { ...nota, statusSEFAZ: 'Sem certificado', motivo: 'Importe um certificado A1 para conferência SEFAZ.', idx, total: notas.length });
      });
    } else {
      for (let i = 0; i < notas.length; i++) {
        const nota = notas[i];
        let statusSEFAZ = '—', motivo = '';
        try {
          if (nota.chave && nota.chave.length === 44) {
            const res = await consultarNFeSEFAZ(nota.chave, pfxBuffer, pass);
            statusSEFAZ = res.status;
            motivo      = res.motivo;
          } else {
            statusSEFAZ = 'Chave inválida';
          }
        } catch(e) {
          statusSEFAZ = 'Erro'; motivo = e.message;
        }
        send('resultado', { ...nota, statusSEFAZ, motivo, idx: i, total: notas.length });
        await new Promise(res => setTimeout(res, 80));
      }
    }

    send('concluido', { total: notas.length });
    r.end();
  })();
});

// ── Busca notas no SIEG Hub API ───────────────────────────
async function buscarNotasSIEG(apiKey, cnpj, dataInicio, dataFim, tipo) {
  // SIEG Hub REST API
  // Docs: https://documentacao.sieg.com
  const baseUrl  = 'api.sieg.com';
  const notas    = [];
  const tipos    = tipo === 'ambos' ? ['entrada','saida'] : [tipo];

  for (const tp of tipos) {
    // Parâmetro takeIfNotDownloaded=false para buscar independente de já ter baixado
    const query = [
      `apiKey=${encodeURIComponent(apiKey)}`,
      `cnpj=${cnpj}`,
      `dataEmissaoInicio=${dataInicio}`,
      `dataEmissaoFim=${dataFim}`,
      `tipo=${tp === 'entrada' ? 0 : 1}`,   // 0=entrada, 1=saída
      `download=false`,
      `page=1`,
      `rows=500`,
    ].join('&');

    const resultado = await new Promise((resolve, reject) => {
      const reqOpts = {
        hostname: baseUrl,
        path:     `/DownloadXmls?${query}`,
        method:   'GET',
        headers:  { 'Accept': 'application/json' },
      };
      const req = https.request(reqOpts, res => {
        let body = '';
        res.on('data', c => body += c.toString());
        res.on('end', () => {
          if (res.statusCode === 401) { reject(new Error('API Key SIEG inválida ou sem permissão.')); return; }
          if (res.statusCode === 403) { reject(new Error('Acesso negado pelo SIEG. Verifique a API Key.')); return; }
          if (res.statusCode !== 200) { reject(new Error(`SIEG retornou HTTP ${res.statusCode}`)); return; }
          try {
            const data = JSON.parse(body);
            resolve(data);
          } catch {
            // Tenta parsear como XML (alguns endpoints retornam XML)
            resolve({ xmls: [], error: 'Formato de resposta inesperado' });
          }
        });
      });
      req.on('error', e => reject(new Error(`Conexão SIEG falhou: ${e.message}`)));
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout SIEG (20s)')); });
      req.end();
    });

    // Normaliza resposta SIEG para o formato interno
    const items = resultado?.xmls || resultado?.nfes || resultado?.notas || resultado || [];
    if (Array.isArray(items)) {
      items.forEach(item => {
        notas.push({
          id:            item.id || item.IdDownload || `${tp}_${notas.length}`,
          chave:         (item.chNfe || item.chave || item.ChaveAcesso || '').replace(/\s/g,''),
          numero:        item.nNf  || item.numero  || item.Numero  || '—',
          serie:         item.serie || item.Serie  || '—',
          empresa:       item.xNome || item.razao  || item.Emitente || '—',
          cnpj:          item.cnpj  || item.CNPJ   || cnpj,
          valor:         parseFloat(item.vNF || item.valor || item.Valor || 0),
          data:          (item.dhEmi || item.data  || item.DataEmissao || '—').slice(0,10),
          statusInterno: item.situacao || item.status || 'Ativa',
          tipo:          tp === 'entrada' ? 'Entrada' : 'Saída',
          statusSEFAZ:   '—',
          xml:           item.xml || null,
        });
      });
    }
  }

  return notas;
}

// Rota: salvar config SIEG (CNPJ padrão, período padrão etc.)
app.post('/api/sieg/config', (q,r) => {
  const { cnpj, diasPeriodo } = q.body || {};
  if (cnpj) setData('siegCnpj', cnpj.replace(/\D/g,''));
  if (diasPeriodo) setData('siegDias', parseInt(diasPeriodo)||30);
  r.json({ ok: true });
});
app.get('/api/sieg/config', (_,r) => r.json({
  cnpj:       getData('siegCnpj') || '',
  diasPeriodo:getData('siegDias') || 30,
  temKey:     fs.existsSync(SIEG_KEY_FILE),
}));

// ══════════════════════════════════════════════════
// SEFAZ AUTOMAÇÃO — Acesso automático com certificado
// ══════════════════════════════════════════════════

// Helper: carrega o certificado ativo
function loadActiveCert(certName, passphrase) {
  let pfxBuffer = null, pass = passphrase || '';
  if (certName) {
    const cp = path.join(CERT_DIR, certName.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100));
    if (fs.existsSync(cp)) {
      pfxBuffer = fs.readFileSync(cp);
      const mp = cp + '.meta.json';
      if (!pass && fs.existsSync(mp)) {
        try { const m=JSON.parse(fs.readFileSync(mp,'utf8')); if(m.encPass) pass=decrypt(m.encPass); } catch {}
      }
    }
  } else {
    try {
      const files = fs.readdirSync(CERT_DIR).filter(f=>!f.endsWith('.meta.json'));
      for (const f of files) {
        if (/\.(pfx|p12)$/i.test(f)) {
          pfxBuffer = fs.readFileSync(path.join(CERT_DIR,f));
          const mp = path.join(CERT_DIR,f+'.meta.json');
          if (fs.existsSync(mp)) { try{const m=JSON.parse(fs.readFileSync(mp,'utf8'));if(m.encPass)pass=decrypt(m.encPass);}catch{} }
          break;
        }
      }
    } catch {}
  }
  return { pfxBuffer, pass };
}

// ── 1. Status do Serviço SEFAZ por UF ──────────────
function buildStatusServicoSoap(cuf) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeStatusServico4">
      <cUF>${cuf}</cUF>
      <versaoDados>4.00</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeStatusServico4">
      <consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>1</tpAmb>
        <cUF>${cuf}</cUF>
        <xServ>STATUS</xServ>
      </consStatServ>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`;
}

// Endpoints de StatusServico (caminho diferente do NfeConsulta)
const SEFAZ_STATUS_ENDPOINTS = {
  '35': { host:'nfe.fazenda.sp.gov.br',   path:'/nfeWEB/services/NfeStatusServico4.asmx' },
  '43': { host:'nfe.sefaz.rs.gov.br',     path:'/ws/NfeStatusServico/NfeStatusServico4.asmx' },
  '31': { host:'nfe.fazenda.mg.gov.br',   path:'/nfe2/services/NfeStatusServico4' },
  '41': { host:'nfe.fazenda.pr.gov.br',   path:'/nfe/NFeStatusServico4Service' },
  '42': { host:'nfe.sef.sc.gov.br',       path:'/nfe/services/NfeStatusServico4' },
  '26': { host:'nfe.sefaz.pe.gov.br',     path:'/nfe-service/NfeStatusServico4' },
  '52': { host:'nfe.sefaz.go.gov.br',     path:'/nfe/services/NfeStatusServico4' },
  '51': { host:'nfe.sefaz.mt.gov.br',     path:'/nfe/services/NfeStatusServico4' },
  '50': { host:'nfe.fazenda.ms.gov.br',   path:'/nfe2/services/NfeStatusServico4' },
  '29': { host:'nfe.sefaz.ba.gov.br',     path:'/webservices/NfeStatusServico4/NfeStatusServico4.asmx' },
  '13': { host:'nfe.sefaz.am.gov.br',     path:'/services2/NfeStatusServico4' },
  '23': { host:'nfe.sefaz.ce.gov.br',     path:'/nfe2/services/NfeStatusServico4' },
  'svrs': { host:'nfe.svrs.fazenda.gov.br', path:'/ws/NfeStatusServico/NfeStatusServico4.asmx' },
};

async function consultarStatusServico(cuf, pfxBuffer, pass) {
  const cuF = String(cuf).padStart(2,'0');
  const ep = SEFAZ_STATUS_ENDPOINTS[cuF] || SEFAZ_STATUS_ENDPOINTS['svrs'];
  const soap = buildStatusServicoSoap(cuF);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: ep.host, port: 443, path: ep.path, method: 'POST',
      headers: {
        'Content-Type':  'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(soap),
        'SOAPAction': '"http://www.portalfiscal.inf.br/nfe/wsdl/NfeStatusServico4/nfeStatusServicoNF"',
      },
      pfx: pfxBuffer, passphrase: pass, rejectUnauthorized: false,
    }, res => {
      let body='';
      res.on('data',c=>body+=c.toString());
      res.on('end',()=>{
        const cStat  = (body.match(/<cStat>(\d+)<\/cStat>/)    ||[])[1];
        const xMotivo= (body.match(/<xMotivo>([^<]+)<\/xMotivo>/)  ||[])[1] || '';
        const tMed   = (body.match(/<tMed>(\d+)<\/tMed>/)         ||[])[1] || '—';
        const dhRecbto=(body.match(/<dhRecbto>([^<]+)<\/dhRecbto>/)||[])[1] || '';
        if (!cStat) return reject(new Error('Resposta inválida'));
        resolve({
          cStat: parseInt(cStat),
          online: cStat === '107',
          status: cStat==='107' ? 'Online' : cStat==='108' ? 'Paralisado temporariamente' : `cStat ${cStat}`,
          motivo: xMotivo,
          tMed,
          dhRecbto,
          host: ep.host,
        });
      });
    });
    req.on('error', e=>reject(new Error(e.message)));
    req.setTimeout(12000, ()=>{req.destroy();reject(new Error('Timeout 12s'));});
    req.write(soap); req.end();
  });
}

// ── 2. Consulta Cadastro CNPJ na SEFAZ ─────────────
function buildConsultaCadastroSoap(cnpj, cuf) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4">
      <cUF>${cuf}</cUF>
      <versaoDados>2.00</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4">
      <ConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00">
        <infCons>
          <xServ>CONS-CAD</xServ>
          <UF>${cuf}</UF>
          <CNPJ>${cnpj.replace(/\D/g,'')}</CNPJ>
        </infCons>
      </ConsCad>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`;
}

const SEFAZ_CAD_ENDPOINTS = {
  '35': { host:'www.nfe.fazenda.sp.gov.br',  path:'/nfeWEB/services/CadConsultaCadastro4.asmx' },
  '43': { host:'cad.svrs.fazenda.gov.br',    path:'/ws/cadconsultacadastro/cadconsultacadastro4.asmx' },
  '31': { host:'nfe.fazenda.mg.gov.br',      path:'/nfe2/services/CadConsultaCadastro4' },
  '41': { host:'nfe.fazenda.pr.gov.br',      path:'/nfe/CadConsultaCadastro4Service' },
  'svrs': { host:'cad.svrs.fazenda.gov.br',  path:'/ws/cadconsultacadastro/cadconsultacadastro4.asmx' },
};

async function consultarCadastroCNPJ(cnpj, cuf, pfxBuffer, pass) {
  const cuF = String(cuf).padStart(2,'0');
  const ep = SEFAZ_CAD_ENDPOINTS[cuF] || SEFAZ_CAD_ENDPOINTS['svrs'];
  const soap = buildConsultaCadastroSoap(cnpj, cuF);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: ep.host, port: 443, path: ep.path, method: 'POST',
      headers: {
        'Content-Type':  'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(soap),
        'SOAPAction': '"http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4/consultaCadastro"',
      },
      pfx: pfxBuffer, passphrase: pass, rejectUnauthorized: false,
    }, res => {
      let body='';
      res.on('data',c=>body+=c.toString());
      res.on('end',()=>{
        const cStat    = (body.match(/<cStat>(\d+)<\/cStat>/)    ||[])[1];
        const xMotivo  = (body.match(/<xMotivo>([^<]+)<\/xMotivo>/)  ||[])[1] || '';
        const xNome    = (body.match(/<xNome>([^<]+)<\/xNome>/)      ||[])[1] || '';
        const xFant    = (body.match(/<xFant>([^<]+)<\/xFant>/)      ||[])[1] || '';
        const IE       = (body.match(/<IE>([^<]+)<\/IE>/)            ||[])[1] || '';
        const IEST     = (body.match(/<IEST>([^<]+)<\/IEST>/)        ||[])[1] || '';
        const indCredNFe=(body.match(/<indCredNFe>([^<]+)<\/indCredNFe>/)||[])[1]||'';
        const indCredCTe=(body.match(/<indCredCTe>([^<]+)<\/indCredCTe>/)||[])[1]||'';
        const cRegTrib =(body.match(/<cRegTrib>([^<]+)<\/cRegTrib>/) ||[])[1] || '';
        resolve({
          cStat: parseInt(cStat)||0,
          ok: cStat==='111',
          xMotivo, xNome, xFant, IE, IEST, indCredNFe, indCredCTe, cRegTrib,
        });
      });
    });
    req.on('error',e=>reject(new Error(e.message)));
    req.setTimeout(12000,()=>{req.destroy();reject(new Error('Timeout 12s'));});
    req.write(soap); req.end();
  });
}

// ── 3. Ping de todos os UF (SSE stream) ─────────────
app.post('/api/sefaz/ping-all', async (q, r) => {
  const { certName, passphrase } = q.body || {};
  const { pfxBuffer, pass } = loadActiveCert(certName, passphrase);

  r.setHeader('Content-Type','text/event-stream');
  r.setHeader('Cache-Control','no-cache');
  r.setHeader('Connection','keep-alive');
  r.flushHeaders();
  const send = (ev, data) => r.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!pfxBuffer) {
    send('erro', { mensagem: 'Nenhum certificado A1 encontrado. Importe um .pfx na aba Certificados.' });
    r.end(); return;
  }

  const UFS = [
    {cuf:'35',uf:'SP'},{cuf:'43',uf:'RS'},{cuf:'31',uf:'MG'},{cuf:'41',uf:'PR'},
    {cuf:'42',uf:'SC'},{cuf:'26',uf:'PE'},{cuf:'52',uf:'GO'},{cuf:'51',uf:'MT'},
    {cuf:'50',uf:'MS'},{cuf:'29',uf:'BA'},{cuf:'13',uf:'AM'},{cuf:'23',uf:'CE'},
    {cuf:'svrs',uf:'SVRS'},
  ];

  for (const {cuf, uf} of UFS) {
    try {
      const t0 = Date.now();
      const res = await consultarStatusServico(cuf, pfxBuffer, pass);
      send('uf', { uf, ...res, ms: Date.now()-t0 });
    } catch(e) {
      send('uf', { uf, online:false, status:'Erro', motivo:e.message, ms:0, host:'' });
    }
    await new Promise(r=>setTimeout(r,200));
  }
  send('done', {});
  r.end();
});

// ── 4. Status serviço para um único UF ──────────────
app.post('/api/sefaz/status-uf', async (q, r) => {
  const { cuf, certName, passphrase } = q.body || {};
  if (!cuf) return r.status(400).json({ error:'cuf obrigatório' });
  const { pfxBuffer, pass } = loadActiveCert(certName, passphrase);
  if (!pfxBuffer) return r.json({ online:false, status:'Sem certificado', motivo:'Importe um .pfx' });
  try {
    const result = await consultarStatusServico(cuf, pfxBuffer, pass);
    r.json(result);
  } catch(e) {
    r.json({ online:false, status:'Erro', motivo:e.message });
  }
});

// ── 5. Consulta cadastro CNPJ ────────────────────────
app.post('/api/sefaz/consulta-cadastro', async (q, r) => {
  const { cnpj, cuf, certName, passphrase } = q.body || {};
  if (!cnpj || !cuf) return r.status(400).json({ error:'cnpj e cuf obrigatórios' });
  const { pfxBuffer, pass } = loadActiveCert(certName, passphrase);
  if (!pfxBuffer) return r.json({ ok:false, xMotivo:'Sem certificado A1' });
  try {
    const result = await consultarCadastroCNPJ(cnpj, cuf, pfxBuffer, pass);
    r.json(result);
  } catch(e) {
    r.json({ ok:false, xMotivo:e.message });
  }
});

// ── 6. Consulta NF-e por chave de acesso ─────────────
// (já existe em /api/sefaz/consultar — expõe alias para o painel SEFAZ)
app.post('/api/sefaz/consulta-nfe', async (q, r) => {
  const { chave, certName, passphrase } = q.body || {};
  if (!chave || chave.replace(/\D/g,'').length !== 44) return r.json({ status:'Inválida', motivo:'Chave deve ter 44 dígitos' });
  const { pfxBuffer, pass } = loadActiveCert(certName, passphrase);
  if (!pfxBuffer) return r.json({ status:'Sem certificado', motivo:'Importe um .pfx' });
  try {
    const result = await consultarNFeSEFAZ(chave.replace(/\D/g,''), pfxBuffer, pass);
    r.json(result);
  } catch(e) {
    r.json({ status:'Erro', motivo:e.message, cStat:null });
  }
});

// ── 7. Rota da página SEFAZ Automação ────────────────
app.get("/sefaz",    (_, r) => r.sendFile(path.join(__dirname, 'public', 'sefaz.html')));
app.get("/usuarios", (_, r) => r.sendFile(path.join(__dirname, 'public', 'usuarios.html')));

app.post('/api/agent/stream', (q, r) => {
  if (!fs.existsSync(KEY_FILE))
    return r.status(401).json({ error:'API Key não configurada.' });

  let apiKey;
  try { apiKey = decrypt(fs.readFileSync(KEY_FILE,'utf8')); }
  catch { return r.status(500).json({ error:'Erro ao ler API Key.' }); }

  r.setHeader('Content-Type','text/event-stream');
  r.setHeader('Cache-Control','no-cache');
  r.setHeader('Connection','keep-alive');
  r.flushHeaders();

  const send = (ev,d) => r.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`);

  const settings = getData('settings') || {};
  const model     = settings.model   || 'claude-sonnet-4-6';
  const maxTokens = settings.tokens  || 1024;
  const histLimit = settings.history || 10;
  const toneMap = {
    casual:  'Tom descontraído, gírias, estilo brasileiro jovem adulto 2025.',
    formal:  'Tom formal e profissional.',
    tecnico: 'Tom técnico e detalhado com termos contábeis precisos.',
  };
  const toneExtra = toneMap[settings.tone] || toneMap.casual;

  const messages = (q.body?.messages||[])
    .filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string')
    .slice(-histLimit)
    .map(m=>({ role:m.role, content:m.content.slice(0,4000) }));

  const body = JSON.stringify({
    model, max_tokens: maxTokens, stream:true,
    system:`Você é o Léo, assistente interno nativo do FiscoBot Pro.
Você É parte do app — fale como dono da casa, cofundador, espírito do app.
Nunca diga que é IA, LLM ou assistente genérico.
Tom: ${toneExtra}

PERSONALIDADE:
• Use gírias naturais: mano, véi, tranquilo, de boa, bora, fechou, demorou, mitou, saquei, etc.
• Bordões: "Deixa comigo", "Tô ligado, já saquei", "Bora destravar essa parada?", "Fechou, partiu!"
• Quando o usuário parece perdido → entre proativamente com ajuda curta e objetiva
• Abertura preferida: "Fala aí, o que tá pegando?", "Qual é a boa?", "Manda o papo"
• NUNCA use "Como posso ajudar você hoje?"

CONHECIMENTO DO APP:
• Certificados digitais A1/A3 → sidebar esquerda, arrastar .pfx ou clicar
• Portais fiscais → cards na tela principal, clique abre no navegador
• Macros → menu ☰ > aba Macros > Gravar
• AutoFill → menu ☰ > aba Fill
• Downloads → menu ☰ > aba Down
• Configurações → ícone ⚙ no header
• Agente IA (você!) → menu ☰ > aba IA → configurar API Key primeiro

TRIBUTAÇÃO BRASILEIRA:
• Simples Nacional/PGDAS: anexos I-V, alíquotas efetivas, DAS, parcelamentos, exclusão
• ICMS/EFD-ICMS: CFOP, CST, ST, DIFAL, SEFAZ RS, GIA, SPED Fiscal
• PIS/COFINS: cumulativo (3%+0,65%) e não-cumulativo, créditos, EFD-Contribuições
• CSLL/IRPJ: Lucro Presumido (coeficientes), Lucro Real, ECF, LALUR
• eSocial: S-1200, S-2200, S-2300, S-2400, prazos, competências
• SPED: EFD-ICMS/IPI, EFD-Contribuições, ECD, ECF — leiautes e prazos
• NF-e/NFC-e/CT-e: emissão, cancelamento, carta de correção, CFOP, XML, DANFE

REGRAS:
• Responda SEMPRE em português brasileiro
• Use markdown quando ajudar
• Respostas diretas e objetivas`,
    messages
  });

  const req = https.request({
    hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
    headers:{ 'Content-Type':'application/json', 'x-api-key':apiKey,
              'anthropic-version':'2023-06-01', 'Content-Length':Buffer.byteLength(body) }
  }, res => {
    let buf='';
    res.on('data', c => {
      buf += c.toString();
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type==='content_block_delta'&&ev.delta?.type==='text_delta')
            send('delta', { text: ev.delta.text });
          if (ev.type==='message_stop') { send('done',{}); r.end(); }
          if (ev.type==='error') { send('error',{ message:ev.error?.message }); r.end(); }
        } catch {}
      }
    });
    res.on('end', () => { send('done',{}); r.end(); });
  });
  req.on('error', e => { send('error',{ message:e.message }); r.end(); });
  req.setTimeout(60000, () => { req.destroy(); send('error',{ message:'Timeout.' }); r.end(); });
  q.on('close', () => req.destroy());
  req.write(body); req.end();
});

// ── Browser: abre portais no navegador do usuário ─
// (sem Puppeteer — usa o navegador padrão do Windows)
const ALLOWED = [
  'receita.fazenda.gov.br','nfe.fazenda.gov.br','cav.receita.fazenda.gov.br',
  'sped.rfb.gov.br','esocial.gov.br','sefaz.rs.gov.br',
  'www8.receita.fazenda.gov.br','www.gov.br','acesso.gov.br','cnpj.com.br',
  'pgfn.fazenda.gov.br','servicos.receita.fazenda.gov.br',
  'portaldosimples.receita.fazenda.gov.br',
];
function isAllowed(url) {
  try {
    const u = new URL(url.startsWith('http')?url:'https://'+url);
    return ALLOWED.some(h=>u.hostname===h||u.hostname.endsWith('.'+h));
  } catch { return false; }
}

app.post('/api/browser/navigate', (q, r) => {
  const url = q.body?.url;
  if (!url||!isAllowed(url)) return r.status(403).json({ error:'URL não autorizada' });
  // Abre no navegador padrão do usuário
  const cmds = { win32:'start ""', darwin:'open', linux:'xdg-open' };
  const cmd  = (cmds[process.platform]||'xdg-open') + ' "' + url + '"';
  exec(cmd, err => {
    if (err) r.status(500).json({ error:err.message });
    else r.json({ ok:true, url, title:'Abrindo no navegador...' });
  });
});

app.post('/api/browser/back',    (_,r) => r.json({ ok:false, msg:'Use o navegador' }));
app.post('/api/browser/forward', (_,r) => r.json({ ok:false, msg:'Use o navegador' }));
app.post('/api/browser/reload',  (_,r) => r.json({ ok:false, msg:'Use o navegador' }));
app.post('/api/browser/resize',  (_,r) => r.json({ ok:true }));
app.post('/api/macro/play', (q, r) => {
  // No modo Electron sem Puppeteer, macros gravam do painel
  // e rodam via broadcast para o frontend executar no navegador ativo
  const { steps, delay } = q.body || {};
  if (!Array.isArray(steps)) return r.status(400).json({ error: 'steps inválido' });
  r.json({ ok: true, message: 'Macro iniciado' });
  // Transmite via WebSocket para o renderer executar
  broadcast('macro:run', { steps, delay: delay || 600 });
});

app.post('/api/autofill', (q, r) => {
  const data = q.body?.data || {};
  // Transmite via WebSocket para o renderer executar no contexto da página ativa
  broadcast('autofill:run', { data });
  // Retorna ok imediatamente — o resultado chega via log/toast no frontend
  r.json({ ok: true, filled: 0, async: true });
});
app.get ('/api/browser/status',  (_,r) => r.json({ open:true }));

// ── WebSocket ─────────────────────────────────────
const wss     = new WebSocket.Server({ server });
const clients = new Set();

// Broadcast para todos os clientes WebSocket conectados
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch {}
    }
  }
}

wss.on('connection', ws => {
  clients.add(ws);
  ws.send(JSON.stringify({ event:'browser:status', data:{ open:true } }));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// ── Inicia ────────────────────────────────────────
server.on('error', e => {
  if (e.code==='EADDRINUSE') {
    if (!process.env.FISCOBOT_ELECTRON) {
      exec('start http://localhost:3737');
    }
    process.exit(0);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  ensureDefaultAdmin();
  loadSessions();
  // No modo Electron, o electron.js cuida de abrir a janela
  if (!process.env.FISCOBOT_ELECTRON) {
    exec('start http://localhost:3737/login');
  }
});
