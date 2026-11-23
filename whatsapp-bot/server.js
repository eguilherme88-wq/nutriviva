'use strict';
/* NutriViva · servidor do atendimento automático (WhatsApp Cloud API).
 * Sem dependências externas: Node.js 18 ou mais recente.
 *   GET  /webhook   verificação do webhook pela Meta
 *   POST /webhook   mensagens recebidas → robô → resposta pelo WhatsApp
 *   POST /api/agent resposta de um atendente humano (protegida por ADMIN_TOKEN)
 *   GET  /health    verificação de funcionamento
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const NVBot = require('./bot-engine');

loadEnv(path.join(__dirname, '.env'));
const {
  PORT = '3000',
  VERIFY_TOKEN,
  APP_SECRET,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  ADMIN_TOKEN = '',
  SITE_URL = 'https://eguilherme88-wq.github.io/nutriviva/',
  GRAPH_VERSION = 'v26.0',
  DB_FILE = path.join(__dirname, 'data', 'db.json'),
} = process.env;
if (!process.env.TZ) process.env.TZ = 'America/Sao_Paulo';

for (const [k, v] of Object.entries({ VERIFY_TOKEN, APP_SECRET, WHATSAPP_TOKEN, PHONE_NUMBER_ID })) {
  if (!v) { console.error(`Variável ${k} não configurada. Veja o arquivo .env.example.`); process.exit(1); }
}

// ---------- Banco de dados em arquivo JSON (mesmo formato do site) ----------
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    console.error(`Arquivo ${DB_FILE} não encontrado. Exporte os dados no painel (Atendimento WhatsApp → Exportar dados) e salve aqui.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
let db = loadDb();
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
// Processa uma mensagem por vez para não haver dois agendamentos no mesmo horário.
let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn));

// ---------- Envio pela WhatsApp Cloud API ----------
async function sendText(to, body) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body: body.slice(0, 4096) } }),
  });
  if (!res.ok) console.error('Falha ao enviar mensagem:', res.status, await res.text());
}

// ---------- Mensagens recebidas ----------
const seen = new Set();
function textOf(msg) {
  if (msg.type === 'text') return msg.text?.body || '';
  if (msg.type === 'interactive') return msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || '';
  if (msg.type === 'button') return msg.button?.payload || msg.button?.text || '';
  return null;
}
async function handleMessage(msg) {
  if (!msg?.id || seen.has(msg.id)) return;
  seen.add(msg.id);
  if (seen.size > 5000) seen.delete(seen.values().next().value);
  const text = textOf(msg);
  if (text === null) {
    await sendText(msg.from, 'Por enquanto eu entendo apenas mensagens de texto. Envie *menu* para ver as opções.');
    return;
  }
  const result = await NVBot.reply(db, msg.from, text, {
    uid: () => crypto.randomUUID(),
    now: () => new Date(),
    hash: p => crypto.createHash('sha256').update(p, 'utf8').digest('hex'),
    siteUrl: SITE_URL,
  });
  if (result.changed) saveDb();
  for (const r of result.replies) await sendText(msg.from, r);
}

// ---------- HTTP ----------
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function validSignature(raw, header) {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex'));
  const got = Buffer.from(header);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, chats: (db.waChats || []).length }));
    }
    if (req.method === 'GET' && url.pathname === '/webhook') {
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && safeEqual(url.searchParams.get('hub.verify_token') || '', VERIFY_TOKEN);
      res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain' });
      return res.end(ok ? url.searchParams.get('hub.challenge') || '' : 'Forbidden');
    }
    if (req.method === 'POST' && url.pathname === '/webhook') {
      const raw = await readBody(req);
      if (!validSignature(raw, req.headers['x-hub-signature-256'])) { res.writeHead(401); return res.end(); }
      res.writeHead(200); res.end(); // responde rápido; a Meta reenvia se demorar
      const payload = JSON.parse(raw.toString('utf8'));
      for (const entry of payload.entry || [])
        for (const change of entry.changes || [])
          for (const msg of change.value?.messages || [])
            serial(() => handleMessage(msg).catch(e => console.error('Erro ao processar mensagem:', e)));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/agent') {
      if (!ADMIN_TOKEN || !safeEqual((req.headers.authorization || '').replace(/^Bearer /, ''), ADMIN_TOKEN)) { res.writeHead(401); return res.end(); }
      const { phone, text, by = 'Equipe', handoff = true } = JSON.parse((await readBody(req, 20_000)).toString('utf8'));
      const to = NVBot.normPhone(phone);
      const chat = (db.waChats || []).find(c => c.phone === to);
      if (!chat || !String(text || '').trim()) { res.writeHead(400); return res.end('Conversa ou texto inválido'); }
      await serial(async () => {
        const now = new Date().toISOString();
        chat.messages.push({ from: 'agent', text: String(text).slice(0, 4096), at: now, by: String(by).slice(0, 80) });
        chat.handoff = !!handoff; if (!handoff) chat.state = { step: 'menu' };
        chat.updated = now; saveDb();
        await sendText(to, String(text));
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true}');
    }
    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(400); res.end(); }
  }
}).listen(Number(PORT), () => console.log(`NutriViva WhatsApp ouvindo na porta ${PORT}`));

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
