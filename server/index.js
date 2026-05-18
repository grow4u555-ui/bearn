const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bandwidth-earner-jwt-secret-key-2026';

const db = new sqlite3.Database('./bandwidth.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    email TEXT UNIQUE,
    referral_code TEXT UNIQUE,
    referred_by INTEGER,
    wallet_balance REAL DEFAULT 0,
    total_data_gb REAL DEFAULT 0,
    earnings REAL DEFAULT 0,
    theme TEXT DEFAULT 'dark',
    lang TEXT DEFAULT 'bn',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    amount REAL,
    data_gb REAL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER,
    referred_id INTEGER,
    bonus REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY,
    theme TEXT DEFAULT 'dark',
    lang TEXT DEFAULT 'bn',
    threads INTEGER DEFAULT 10,
    auto_start INTEGER DEFAULT 0
  )`);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web')));

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'no_token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'invalid_token' });
  }
}

// ===== AUTH =====
app.post('/api/auth/register', async (req, res) => {
  const { username, password, email, ref } = req.body;
  if (!username || !password || !email) return res.status(400).json({ error: 'required' });
  const refCode = crypto.randomBytes(4).toString('hex');
  const hash = await bcrypt.hash(password, 10);
  let refBy = null;
  if (ref) {
    const u = await new Promise(r => db.get('SELECT id FROM users WHERE referral_code=?', [ref], (e, row) => r(row)));
    if (u) refBy = u.id;
  }
  db.run('INSERT INTO users (username,password,email,referral_code,referred_by) VALUES (?,?,?,?,?)',
    [username, hash, email, refCode, refBy], function(err) {
      if (err) return res.status(400).json({ error: 'exists' });
      if (refBy) {
        db.run('UPDATE users SET wallet_balance=wallet_balance+0.50 WHERE id=?', [refBy]);
        db.run('INSERT INTO referrals (referrer_id,referred_id,bonus) VALUES (?,?,0.50)', [refBy, this.lastID]);
        db.run('INSERT INTO transactions (user_id,type,amount,description) VALUES (?,?,?,?)',
          [refBy, 'referral_bonus', 0.50, 'New referral bonus']);
      }
      db.run('INSERT INTO settings (user_id) VALUES (?)', [this.lastID]);
      const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET, { expiresIn: '30d' });
      res.json({ token, username, refCode, id: this.lastID });
    });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username=?', [username], async (err, user) => {
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(400).json({ error: 'invalid' });
    const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username, refCode: user.referral_code, id: user.id, theme: user.theme, lang: user.lang });
  });
});

// ===== PROFILE =====
app.get('/api/profile', auth, (req, res) => {
  db.get('SELECT id,username,email,referral_code,wallet_balance,total_data_gb,earnings,theme,lang FROM users WHERE id=?',
    [req.user.id], (e, u) => res.json(u));
});

app.get('/api/transactions', auth, (req, res) => {
  db.all('SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 100', [req.user.id], (e, r) => res.json(r));
});

app.get('/api/referrals', auth, (req, res) => {
  db.all(`SELECT u.username,r.bonus,r.created_at FROM referrals r JOIN users u ON u.id=r.referred_id WHERE r.referrer_id=? ORDER BY r.created_at DESC`, [req.user.id], (e, r) => res.json(r));
});

// ===== DATA =====
app.post('/api/data/report', auth, (req, res) => {
  const { gb } = req.body;

  if (!gb || gb <= 0) {
    return res.status(400).json({ error: 'invalid' });
  }

  const earn = gb * 0.50;

  db.run(
    'UPDATE users SET total_data_gb=total_data_gb+?, earnings=earnings+?, wallet_balance=wallet_balance+? WHERE id=?',
    [gb, earn, earn, req.user.id],
    function(err) {

      if (err) {
        return res.status(500).json({ error: 'db_update_failed' });
      }

      db.run(
        'INSERT INTO transactions (user_id,type,amount,data_gb,description) VALUES (?,?,?,?,?)',
        [req.user.id, 'earned', earn, gb, `${gb.toFixed(2)}GB shared`],
        function(err2) {

          if (err2) {
            return res.status(500).json({ error: 'transaction_failed' });
          }

          db.get(
            'SELECT wallet_balance FROM users WHERE id=?',
            [req.user.id],
            (e, u) => {

              if (e || !u) {
                return res.status(500).json({ error: 'balance_fetch_failed' });
              }

              return res.json({
                success: true,
                earned: earn,
                balance: u.wallet_balance
              });
            }
          );
        }
      );
    }
  );
});

// ===== SETTINGS =====
app.post('/api/settings/theme', auth, (req, res) => {
  const { theme } = req.body;
  if (!['dark','light','hacker'].includes(theme)) return res.status(400).json({ error: 'invalid' });
  db.run('UPDATE users SET theme=? WHERE id=?', [theme, req.user.id]);
  db.run('UPDATE settings SET theme=? WHERE user_id=?', [theme, req.user.id]);
  res.json({ success: true, theme });
});

app.post('/api/settings/lang', auth, (req, res) => {
  const { lang } = req.body;
  if (!['bn','en'].includes(lang)) return res.status(400).json({ error: 'invalid' });
  db.run('UPDATE users SET lang=? WHERE id=?', [lang, req.user.id]);
  db.run('UPDATE settings SET lang=? WHERE user_id=?', [lang, req.user.id]);
  res.json({ success: true, lang });
});

app.post('/api/settings/threads', auth, (req, res) => {
  const { threads } = req.body;
  const t = parseInt(threads);
  if (t < 1 || t > 50) return res.status(400).json({ error: 'invalid' });
  db.run('UPDATE settings SET threads=? WHERE user_id=?', [t, req.user.id]);
  res.json({ success: true, threads: t });
});

app.get('/api/settings', auth, (req, res) => {
  db.get('SELECT * FROM settings WHERE user_id=?', [req.user.id], (e, s) => {
    if (!s) {
      db.run('INSERT INTO settings (user_id) VALUES (?)', [req.user.id]);
      return res.json({ theme: 'dark', lang: 'bn', threads: 10, auto_start: 0 });
    }
    res.json(s);
  });
});

// ===== WITHDRAW =====
app.post('/api/withdraw', auth, (req, res) => {
  const { amount, method } = req.body;
  if (!amount || amount < 5) return res.status(400).json({ error: 'min_5' });
  db.get('SELECT wallet_balance FROM users WHERE id=?', [req.user.id], (e, u) => {
    if (!u || u.wallet_balance < amount) return res.status(400).json({ error: 'insufficient' });
    db.run('UPDATE users SET wallet_balance=wallet_balance-? WHERE id=?', [amount, req.user.id]);
    db.run('INSERT INTO transactions (user_id,type,amount,description) VALUES (?,?,?,?)',
      [req.user.id, 'withdrawal', -amount, `Withdrawal $${amount} via ${method || 'paypal'}`]);
    res.json({ success: true, amount });
  });
});

// ===== WS =====
const wss = new WebSocket.Server({ noServer: true });
wss.on('connection', (ws, req) => {
  const params = new URLSearchParams(req.url.split('?')[1]);
  const token = params.get('token');
  if (!token) { ws.close(); return; }
  try {
    const user = jwt.verify(token, JWT_SECRET);
    ws.userId = user.id;
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'data_report') {
          const gb = parseFloat(msg.gb) || 0;
          if (gb > 0) {
            const earn = gb * 0.50;
            db.run('UPDATE users SET total_data_gb=total_data_gb+?, earnings=earnings+?, wallet_balance=wallet_balance+? WHERE id=?',
              [gb, earn, earn, user.id]);
            ws.send(JSON.stringify({ type: 'earned', gb, earn }));
          }
        }
      } catch(e) {}
    });
  } catch(e) { ws.close(); }
});

const server = app.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('   BANDWIDTH EARNER SERVER v2.0');
  console.log('   Running on: http://localhost:' + PORT);
  console.log('========================================');
  console.log('');
});

server.on('upgrade', (req, s, head) => {
  wss.handleUpgrade(req, s, head, (ws) => wss.emit('connection', ws, req));
});