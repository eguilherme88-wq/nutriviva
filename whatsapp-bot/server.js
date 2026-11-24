'use strict';
/* NutriViva · servidor do atendimento automático (WhatsApp Cloud API + Firebase).
 * Usa o mesmo banco de dados do site (Cloud Firestore) e o mesmo login (Firebase Authentication).
 *   GET  /webhook   verificação do webhook pela Meta
 *   POST /webhook   mensagens recebidas → robô → resposta pelo WhatsApp
 *   GET  /health    verificação de funcionamento
 * As respostas da equipe, escritas no painel do site, chegam pela coleção waOutbox e são enviadas daqui.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const NVBot = require('./bot-engine');
const { createStore } = require('./firestore-store');

loadEnv(path.join(__dirname, '.env'));
if (!process.env.TZ) process.env.TZ = 'America/Sao_Paulo';
const {
  PORT = '3000',
  VERIFY_TOKEN,
  APP_SECRET,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  GRAPH_VERSION = 'v26.0',
  SITE_URL = 'https://eguilherme88-wq.github.io/nutriviva/',
  FIREBASE_SERVICE_ACCOUNT = '',
} = process.env;

for (const [k, v] of Object.entries({ VERIFY_TOKEN, APP_SECRET, WHATSAPP_TOKEN, PHONE_NUMBER_ID })) {
  if (!v) { console.error(`Variável ${k} não configurada. Veja o arquivo .env.example.`); process.exit(1); }
}

// ---------- Firebase (Admin SDK) ----------
const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
function credential() {
  const v = FIREBASE_SERVICE_ACCOUNT.trim();
  if (!v) return applicationDefault(); // GOOGLE_APPLICATION_CREDENTIALS ou ambiente do Google Cloud
  return cert(v.startsWith('{') ? JSON.parse(v) : JSON.parse(fs.readFileSync(path.resolve(__dirname, v), 'utf8')));
}
initializeApp({ credential: credential() });
const db = createStore(getFirestore(), getAuth());

// Processa uma mensagem por vez.
let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn));

// ---------- Envio pela WhatsApp Cloud API ----------
async function sendText(to, body) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body: String(body).slice(0, 4096) } }),
  });
  if (!res.ok) throw new Error(`WhatsApp respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
const sendSafe = (to, body) => sendText(to, body).catch(e => console.error('Falha ao enviar mensagem:', e.message));

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
  const phone = NVBot.normPhone(msg.from);
  if (!phone) return;
  const text = textOf(msg);
  if (text === null) return sendSafe(phone, 'Por enquanto eu entendo apenas mensagens de texto. Envie *menu* para ver as opções.');

  const { data, base } = await db.load(phone);
  const result = await NVBot.reply(data, phone, text, {
    uid: () => crypto.randomUUID(),
    now: () => new Date(),
    siteUrl: SITE_URL,
    createAccount: db.createAccount,
  });
  try {
    await db.save(phone, data, base, result.chat);
  } catch (e) {
    if (e.code !== 'SLOT_TAKEN') throw e;
    await db.resetChat(phone);
    return sendSafe(phone, 'Esse horário acabou de ser reservado por outra pessoa. 😕 Envie *1* para escolher outro horário.');
  }
  for (const r of result.replies) await sendSafe(phone, r);
}

// Respostas da equipe escritas no painel
db.watchOutbox((phone, text) => sendText(NVBot.normPhone(phone), text), serial, e => console.error('Erro ao enviar resposta da equipe:', e));

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
      return res.end('{"ok":true}');
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
