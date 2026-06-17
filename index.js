require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');

const app = express();

// Trust Render/proxy X-Forwarded-For so express-rate-limit works correctly
app.set('trust proxy', 1);

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
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/mosques', require('./routes/mosques'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/settings', require('./routes/settings'));

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
  <title>Reset Password — Masjid Finder</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f1;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:24px;padding:40px 32px;max-width:420px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.10)}
    .icon-wrap{width:72px;height:72px;border-radius:50%;background:#ecfdf5;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}
    .icon-wrap svg{width:36px;height:36px}
    h1{font-size:26px;font-weight:800;color:#1a2e25;text-align:center;margin-bottom:8px;letter-spacing:-0.3px}
    p{color:#5a7a6a;text-align:center;font-size:15px;line-height:1.6;margin-bottom:28px}
    label{display:block;font-size:13px;font-weight:600;color:#1a2e25;margin-bottom:6px}
    .field{position:relative;margin-bottom:16px}
    input[type=password],input[type=text]{width:100%;height:52px;border:1.5px solid #dce9e3;border-radius:14px;padding:0 48px 0 16px;font-size:15px;color:#1a2e25;font-weight:500;background:#f8fafc;outline:none;transition:border-color .2s}
    input:focus{border-color:#0f4c3a;background:#fff}
    .toggle{position:absolute;right:14px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:4px;color:#9ab5a8}
    .toggle:hover{color:#0f4c3a}
    button[type=submit]{width:100%;height:54px;border-radius:16px;background:#0f4c3a;color:#fff;font-size:16px;font-weight:700;border:none;cursor:pointer;margin-top:8px;transition:opacity .2s;letter-spacing:.2px}
    button[type=submit]:disabled{opacity:.6;cursor:not-allowed}
    .alert{display:none;padding:14px 16px;border-radius:14px;font-size:14px;font-weight:600;margin-bottom:20px;align-items:center;gap:10px}
    .alert.error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626}
    .alert.success{background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a}
    .alert.show{display:flex}
    .hint{font-size:12px;color:#9ab5a8;margin-top:4px}
    .brand{text-align:center;margin-top:28px;font-size:13px;color:#9ab5a8}
    .brand span{color:#0f4c3a;font-weight:700}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="#0f4c3a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </div>
    <h1>Choose New Password</h1>
    <p>Create a strong password to keep your Masjid Finder account secure.</p>

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
    <p class="brand">Masjid Finder &nbsp;·&nbsp; <span>🕌</span></p>
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

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;

// Self-ping mechanism to keep Render free tier alive
const selfPing = () => {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  setInterval(() => {
    const client = url.startsWith('https') ? require('https') : require('http');
    client.get(`${url}/api/ping`, (res) => {
      if (res.statusCode === 200) console.log(`Self-ping successful: ${url}`);
    }).on('error', (err) => {
      console.log('Self-ping error:', err.message);
    });
  }, 14 * 60 * 1000); // 14 minutes
};

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} at http://0.0.0.0:${PORT}`);
  selfPing();
});
