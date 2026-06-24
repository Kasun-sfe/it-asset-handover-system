// ================================================================
//  CareCloud WFH System — Backend Server with Nodemailer
//  Node.js + Nodemailer (uses built-in modules + nodemailer)
//  Data saved to: data/db.json
//  Email via: Outlook SMTP
//  Run: npm install nodemailer
//       node server.js
//  Port: 3000
// ================================================================

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const nodemailer = require('nodemailer');

const PORT    = 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const WEB_DIR = path.join(__dirname, 'www');

// ========== EMAIL CONFIGURATION ==========
const emailConfig = {
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'itsupportcarecloud@gmail.com',
    pass: 'dauv tlse kvom fzsj'
  }
};

let transporter;
try {
  transporter = nodemailer.createTransport(emailConfig);
  console.log('[Email] Nodemailer configured for Outlook SMTP');
} catch(e) {
  console.error('[Email] Configuration error:', e.message);
}

async function sendEmail(to, subject, html) {
  try {
    if (!transporter) throw new Error('Email transporter not initialized');
    const result = await transporter.sendMail({
      from: '"CareCloud IT" <itsupportcarecloud@gmail.com>',
      to: to,
      subject: subject,
      html: html
    });
    console.log(`[✓] Email sent to ${to} — ${subject.slice(0, 40)}...`);
    return { ok: true };
  } catch(err) {
    console.error(`[✗] Email failed to ${to}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ========== DATABASE FUNCTIONS ==========
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

function defaultDB() {
  return { requests: [], activities: [], inventory: [], lastPurge: 0 };
}
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return defaultDB();
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) { return defaultDB(); }
}
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// 30-day auto purge
function purgeExpired(db) {
  const EXPIRY = 30 * 24 * 60 * 60 * 1000;
  const now    = Date.now();
  if (now - (db.lastPurge||0) < 24*60*60*1000) return db;
  db.requests   = db.requests.filter(r => (now - new Date(r.submitted||r.completedAt||0).getTime()) < EXPIRY);
  db.activities = db.activities.filter(a => (now - new Date(a.time||0).getTime()) < EXPIRY);
  db.lastPurge  = now;
  writeDB(db);
  console.log('[CareCloud] Auto-purge completed.');
  return db;
}

const MIME = {
  '.html':'text/html', '.css':'text/css', '.js':'application/javascript',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon'
};

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch(e) { resolve({}); } });
  });
}

function json(res, data, status=200) {
  const CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  res.writeHead(status, CORS);
  res.end(JSON.stringify(data));
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); }
    else { res.writeHead(200, { 'Content-Type': MIME[ext]||'application/octet-stream' }); res.end(data); }
  });
}

// ================================================================
const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method   = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // GET /api/data
  if (pathname === '/api/data' && method === 'GET') {
    let db = readDB(); db = purgeExpired(db);
    return json(res, db);
  }

  // POST /api/requests
  if (pathname === '/api/requests' && method === 'POST') {
    const body = await parseBody(req);
    const db   = readDB();
    db.requests.unshift(body);
    writeDB(db);
    console.log(`[+] New request: ${body.ref} — ${body.name}`);
    return json(res, { ok: true });
  }

  // PUT /api/requests/:ref
  if (pathname.startsWith('/api/requests/') && method === 'PUT') {
    const ref  = decodeURIComponent(pathname.replace('/api/requests/', ''));
    const body = await parseBody(req);
    const db   = readDB();
    const idx  = db.requests.findIndex(r => r.ref === ref);
    if (idx === -1) return json(res, { ok: false, error: 'Not found' }, 404);
    db.requests[idx] = { ...db.requests[idx], ...body };
    writeDB(db);
    console.log(`[~] Updated: ${ref} → ${body.status||'?'}`);
    return json(res, { ok: true, request: db.requests[idx] });
  }

  // POST /api/activities
  if (pathname === '/api/activities' && method === 'POST') {
    const body = await parseBody(req);
    const db   = readDB();
    db.activities.unshift({ ...body, time: body.time || new Date().toISOString() });
    if (db.activities.length > 100) db.activities = db.activities.slice(0, 100);
    writeDB(db);
    return json(res, { ok: true });
  }

  // POST /api/inventory
  if (pathname === '/api/inventory' && method === 'POST') {
    const body = await parseBody(req);
    const db   = readDB();
    db.inventory.push(body);
    writeDB(db);
    return json(res, { ok: true });
  }

  // PUT /api/inventory/:id
  if (pathname.startsWith('/api/inventory/') && method === 'PUT') {
    const id   = decodeURIComponent(pathname.replace('/api/inventory/', ''));
    const body = await parseBody(req);
    const db   = readDB();
    const idx  = db.inventory.findIndex(a => a.id === id);
    if (idx === -1) return json(res, { ok: false, error: 'Not found' }, 404);
    db.inventory[idx] = { ...db.inventory[idx], ...body };
    writeDB(db);
    return json(res, { ok: true });
  }

  // DELETE /api/inventory/:id
  if (pathname.startsWith('/api/inventory/') && method === 'DELETE') {
    const id = decodeURIComponent(pathname.replace('/api/inventory/', ''));
    const db = readDB();
    db.inventory = db.inventory.filter(a => a.id !== id);
    writeDB(db);
    return json(res, { ok: true });
  }

  // ===== NEW EMAIL API =====
  // POST /api/sendmail — Send email via backend
  if (pathname === '/api/sendmail' && method === 'POST') {
    const body = await parseBody(req);
    const result = await sendEmail(body.to, body.subject, body.html);
    return json(res, result, result.ok ? 200 : 500);
  }

  // Static files from www/
  if (method === 'GET') {
    let filePath = path.join(WEB_DIR, pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveStatic(res, filePath);
    }
  }

  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  +-----------------------------------------+');
  console.log('  |   CareCloud WFH System — Backend        |');
  console.log('  |   Running on http://0.0.0.0:' + PORT + '          |');
  console.log('  |   LAN: http://<server-ip>:' + PORT + '            |');
  console.log('  |   Data: data/db.json                    |');
  console.log('  |   Email: Outlook SMTP (Nodemailer)      |');
  console.log('  +-----------------------------------------+');
  console.log('');
});
