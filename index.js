require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { connectDB } = require('./config/db');

// Without a handler, Node already exits on these — but silently, with no log
// line explaining why (Render just shows "exited"). Log first, then exit the
// same way, so Render's restart is accompanied by a reason in the logs.
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const app = express();

// Trust Render/proxy X-Forwarded-For so express-rate-limit works correctly
app.set('trust proxy', 1);

app.use(helmet({
  // This API serves a plain HTML page (/reset-password) with inline <script>/<style> —
  // helmet's default CSP would block that, and there's no separate web frontend here
  // to justify a strict policy.
  contentSecurityPolicy: false,
  // Mosque photos under /uploads are public and meant to be embeddable from any
  // origin (the app, a future website, etc.) — same-origin would needlessly block that.
  crossOriginResourcePolicy: false,
}));

app.use(compression());

connectDB();

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json());

// Ensure uploads directory exists before serving it
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Baseline protection for every /api route — auth.js and mosques.js already
// layer tighter limiters (authLimiter, writeLimiter) on their sensitive
// endpoints; this just ensures nothing (admin.js, quotes.js, reviews.js,
// settings.js, and the public GET /api/mosques) is left completely open.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { message: 'Too many requests. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/mosques', require('./routes/mosques'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/settings', require('./routes/settings'));

// Push notification token registration endpoint
app.post('/api/notifications/register-token', (req, res) => {
  res.json({ status: 'ok', message: 'Notification push token registered successfully' });
});

// ── TEMPORARY one-time file seed endpoint ──────────────────────────────────
// Lets us upload existing local image files to the hosted server's /uploads/
// folder without needing FTP. Secured by ADMIN_SEED_SECRET env var.
// REMOVE this endpoint once seeding is complete.
const multerSeed = require('multer');
const seedUpload = multerSeed({ storage: multerSeed.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.post('/api/admin/seed-file', seedUpload.single('file'), async (req, res) => {
  const secret = req.headers['x-seed-secret'];
  if (!process.env.ADMIN_SEED_SECRET || secret !== process.env.ADMIN_SEED_SECRET) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  if (!req.file || !req.query.filename) {
    return res.status(400).json({ message: 'file and filename query param required' });
  }
  const filename = path.basename(req.query.filename); // prevent path traversal
  const dest = path.join(uploadsDir, filename);
  await fs.promises.writeFile(dest, req.file.buffer);
  res.json({ message: 'File saved', url: `/uploads/${filename}` });
});


// Basic health check
app.get('/', (req, res) => {
  res.send('Islamic Utility App API is running');
});

// Password reset page — served by backend so no frontend is needed
app.get('/reset-password', (req, res) => {
  const token = req.query.token || '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset Password — NearbyMosque</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(160deg,#e8f3ee 0%,#f5f8f6 45%,#fdf9ef 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:26px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(15,76,58,.16);overflow:hidden}
    .card-header{background:linear-gradient(135deg,#0f4c3a 0%,#1a7a5c 100%);padding:32px 32px 28px;text-align:center}
    .icon-wrap{width:64px;height:64px;border-radius:18px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
    .icon-wrap svg{width:32px;height:32px}
    .brand-name{color:#fff;font-size:18px;font-weight:800;letter-spacing:.2px}
    .brand-tag{color:rgba(255,255,255,.75);font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-top:3px}
    .card-body{padding:32px}
    h1{font-size:23px;font-weight:800;color:#1a2e25;text-align:center;margin-bottom:8px;letter-spacing:-0.3px}
    p{color:#5a7a6a;text-align:center;font-size:14px;line-height:1.6;margin-bottom:24px}
    label{display:block;font-size:13px;font-weight:600;color:#1a2e25;margin-bottom:6px}
    .field{position:relative;margin-bottom:16px}
    input[type=password],input[type=text]{width:100%;height:52px;border:1.5px solid #dce9e3;border-radius:14px;padding:0 48px 0 16px;font-size:15px;color:#1a2e25;font-weight:500;background:#f8fafc;outline:none;transition:border-color .2s}
    input:focus{border-color:#0f4c3a;background:#fff}
    .toggle{position:absolute;right:14px;top:38px;background:none;border:none;cursor:pointer;padding:4px;color:#9ab5a8}
    .toggle:hover{color:#0f4c3a}
    button[type=submit]{width:100%;height:54px;border-radius:16px;background:linear-gradient(135deg,#0f4c3a 0%,#1a7a5c 100%);color:#fff;font-size:16px;font-weight:700;border:none;cursor:pointer;margin-top:8px;transition:opacity .2s,transform .2s;letter-spacing:.2px;box-shadow:0 8px 20px rgba(15,76,58,.3)}
    button[type=submit]:active{transform:scale(.98)}
    button[type=submit]:disabled{opacity:.6;cursor:not-allowed}
    .alert{display:none;padding:14px 16px;border-radius:14px;font-size:14px;font-weight:600;margin-bottom:20px;align-items:center;gap:10px}
    .alert.error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626}
    .alert.success{background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a}
    .alert.show{display:flex}
    .hint{font-size:12px;color:#9ab5a8;margin-top:4px}
    .secure-badge{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:22px;color:#c9a84c;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <div class="icon-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <div class="brand-name">NearbyMosque</div>
      <div class="brand-tag">Password Reset</div>
    </div>
    <div class="card-body">
      <h1>Choose New Password</h1>
      <p>Create a strong password to keep your NearbyMosque account secure.</p>

      <div id="alert" class="alert" role="alert"></div>

      <form id="form">
        <div class="field">
          <label for="pw">New Password</label>
          <input type="password" id="pw" placeholder="At least 6 characters" autocomplete="new-password" />
          <button type="button" class="toggle" onclick="toggle('pw',this)" aria-label="Show password">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <div class="hint" id="pw-hint"></div>
        </div>
        <div class="field">
          <label for="pw2">Confirm Password</label>
          <input type="password" id="pw2" placeholder="Repeat your password" autocomplete="new-password" />
          <button type="button" class="toggle" onclick="toggle('pw2',this)" aria-label="Show password">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <button type="submit" id="submit-btn">Reset Password</button>
      </form>
      <div class="secure-badge">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Secure Reset
      </div>
    </div>
  </div>

  <script>
    const TOKEN = ${JSON.stringify(token)};
    const API = window.location.origin;

    function toggle(id, btn) {
      var inp = document.getElementById(id);
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.innerHTML = show
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    }

    function showAlert(type, msg) {
      var el = document.getElementById('alert');
      el.className = 'alert show ' + type;
      el.textContent = msg;
    }

    if (!TOKEN) {
      showAlert('error', 'Invalid or missing reset link. Please request a new one from the app.');
      document.getElementById('form').style.display = 'none';
    }

    document.getElementById('pw').addEventListener('input', function() {
      var hint = document.getElementById('pw-hint');
      hint.textContent = this.value.length > 0 && this.value.length < 6 ? 'Too short — minimum 6 characters' : '';
    });

    document.getElementById('form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var pw = document.getElementById('pw').value;
      var pw2 = document.getElementById('pw2').value;
      var btn = document.getElementById('submit-btn');

      if (pw.length < 6) return showAlert('error', 'Password must be at least 6 characters.');
      if (pw !== pw2) return showAlert('error', 'Passwords do not match.');

      btn.disabled = true;
      btn.textContent = 'Resetting…';
      document.getElementById('alert').className = 'alert';

      try {
        var res = await fetch(API + '/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: TOKEN, newPassword: pw })
        });
        var data = await res.json();
        if (res.ok) {
          showAlert('success', '✓ ' + (data.message || 'Password reset! You can now sign in on the app.'));
          document.getElementById('form').style.display = 'none';
        } else {
          showAlert('error', data.message || 'Reset failed. Please request a new link.');
          btn.disabled = false;
          btn.textContent = 'Reset Password';
        }
      } catch(err) {
        showAlert('error', 'Network error. Please check your connection and try again.');
        btn.disabled = false;
        btn.textContent = 'Reset Password';
      }
    });
  </script>
</body>
</html>`);
});

// Ping route for keep-alive services (like UptimeRobot)
app.get('/api/ping', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Pong! Server is hot.', timestamp: new Date() });
});

// Global error handler — deliberate client-fault errors (4xx, set by a route)
// pass their message through; anything else (500s: raw DB/library errors,
// unexpected throws) is logged in full server-side but never shown to the client.
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  const status = err.statusCode || err.status || 500;
  const message = status < 500 ? err.message : 'Internal Server Error';
  res.status(status).json({ message });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} at http://0.0.0.0:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received — closing server gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});
