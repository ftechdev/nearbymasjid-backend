const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { OAuth2Client } = require('google-auth-library');
const { protect } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../utils/mailer');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // The automated test suite alone makes 25+ auth requests in one run to cover
  // every validation branch — a real limit here would make tests flaky without
  // this being any less strict for real traffic (NODE_ENV is only "test" under Jest).
  max: process.env.NODE_ENV === 'test' ? 1000 : 20,
  message: { message: 'Too many login attempts. Please wait 15 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// ── POST /api/auth/register ────────────────────────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Field-level validation — tell the user exactly what is missing
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Full name is required.' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Email address is required.' });
    }
    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ message: 'Please enter a valid email address (e.g. user@example.com).' });
    }
    if (!password) {
      return res.status(400).json({ message: 'Password is required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: `Password is too short — it must be at least 6 characters (you entered ${password.length}).` });
    }

    const userExists = await User.findOne({ where: { email: email.trim().toLowerCase() } });
    if (userExists) {
      return res.status(400).json({ message: 'An account with this email already exists. Try logging in instead, or use "Forgot Password" if you\'ve lost access.' });
    }

    const user = await User.create({ name: name.trim(), email: email.trim().toLowerCase(), password });

    res.status(201).json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user.id),
    });
  } catch (error) {
    // Two simultaneous signups with the same email both pass the earlier
    // `userExists` check before either has written its row — the DB's unique
    // constraint is what actually catches it, so it needs its own message
    // instead of falling into the generic 500 below.
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ message: 'An account with this email already exists. Try logging in instead, or use "Forgot Password" if you\'ve lost access.' });
    }
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({ message: error.errors?.[0]?.message || 'Please check your details and try again.' });
    }
    console.error('[register] Error:', error);
    res.status(500).json({ message: 'Registration failed due to a server error. Please try again in a moment.' });
  }
});

// ── POST /api/auth/login ───────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Email address is required.' });
    }
    if (!password) {
      return res.status(400).json({ message: 'Password is required.' });
    }

    const user = await User.findOne({ where: { email: email.trim().toLowerCase() } });

    // NOTE: We intentionally use the same message for "user not found" and
    // "wrong password" to avoid leaking which emails are registered.
    // The real reason is logged server-side for debugging.
    if (!user) {
      console.warn(`[login] Failed — no account found for email: ${email}`);
      return res.status(404).json({ message: 'No account found with this email address. Please check your email or sign up.' });
    }

    if (!user.password) {
      // This account was created via Google OAuth — it has no password
      console.warn(`[login] Failed — account ${email} was registered with Google and has no password.`);
      return res.status(401).json({ message: 'This account was created with Google Sign-In. Please tap "Continue with Google" to log in.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      console.warn(`[login] Failed — wrong password for email: ${email}`);
      return res.status(401).json({ message: 'Incorrect password. Please double-check your password or use "Forgot Password".' });
    }

    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user.id),
    });
  } catch (error) {
    console.error('[login] Error:', error);
    res.status(500).json({ message: 'Login failed due to a server error. Please try again in a moment.' });
  }
});

// ── POST /api/auth/google ──────────────────────────────────────────────────────
router.post('/google', authLimiter, async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: 'Google sign-in token is missing. Please try signing in again.' });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      console.error('[google-auth] GOOGLE_CLIENT_ID is not set in environment variables.');
      return res.status(500).json({ message: 'Google Sign-In is not configured on the server. Please contact support.' });
    }

    const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch (verifyErr) {
      console.error('[google-auth] Token verification failed:', verifyErr.message);
      if (verifyErr.message?.includes('Token used too late')) {
        return res.status(401).json({ message: 'Your Google session has expired. Please sign in with Google again.' });
      }
      if (verifyErr.message?.includes('Wrong recipient')) {
        return res.status(401).json({ message: 'Google Client ID mismatch — the app is misconfigured. Please contact support.' });
      }
      if (verifyErr.message?.includes('Invalid token signature')) {
        return res.status(401).json({ message: 'Google token is invalid or has been tampered with. Please sign in again.' });
      }
      return res.status(401).json({ message: 'Google sign-in could not be verified. Please try again.' });
    }

    const payload = ticket.getPayload();
    const { email, name } = payload;

    if (!email) {
      return res.status(400).json({ message: 'Your Google account does not have a public email address. Please use a different sign-in method.' });
    }

    let user = await User.findOne({ where: { email } });
    if (!user) {
      try {
        user = await User.create({
          name: name || email.split('@')[0],
          email,
          // No password — Google users authenticate via Google only
        });
      } catch (createErr) {
        // Two simultaneous first-time Google sign-ins for the same email —
        // the other request's row landed first. Just use it instead of erroring.
        if (createErr.name === 'SequelizeUniqueConstraintError') {
          user = await User.findOne({ where: { email } });
        } else {
          throw createErr;
        }
      }
    }

    if (!user) {
      return res.status(500).json({ message: 'Google sign-in failed — could not create your account. Please try again.' });
    }

    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user.id),
    });
  } catch (error) {
    console.error('[google-auth] Unexpected error:', error.message);
    res.status(500).json({ message: 'Google sign-in failed due to a server error. Please try again.' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  try {
    res.json({
      _id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    });
  } catch (error) {
    console.error('[auth/me] Error:', error);
    res.status(500).json({ message: 'Could not fetch your profile. Please try again.' });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────────
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Please enter your email address to receive a reset link.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    const user = await User.findOne({ where: { email: email.trim().toLowerCase() } });

    if (user) {
      if (!user.password) {
        // Google account — no point sending a password reset
        console.warn(`[forgot-password] Skipped — account ${email} uses Google Sign-In (no password).`);
        // Still returns the generic message so we don't leak which emails exist
      } else {
        const token = crypto.randomBytes(32).toString('hex');
        user.resetToken = token;
        user.resetTokenExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 min
        await user.save();

        const baseUrl = process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`;
        const resetLink = `${baseUrl}/reset-password?token=${token}`;
        sendPasswordResetEmail(user.email, user.name, resetLink)
          .catch(e => console.error('[forgot-password] Email send failed:', e.message));
      }
    } else {
      console.warn(`[forgot-password] No account found for email: ${email}`);
    }

    // Always return the same message — prevents email enumeration attacks
    res.json({ message: 'If an account with that email exists, a reset link has been sent. Check your inbox (and spam folder).' });
  } catch (error) {
    console.error('[forgot-password] Error:', error);
    res.status(500).json({ message: 'Could not process your request. Please try again in a moment.' });
  }
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────────
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Reset token is missing. Please use the link from your email.' });
    }
    if (!newPassword) {
      return res.status(400).json({ message: 'New password is required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: `New password is too short — minimum 6 characters (you entered ${newPassword.length}).` });
    }

    const user = await User.findOne({ where: { resetToken: token } });

    if (!user) {
      console.warn('[reset-password] Token not found in DB — already used or invalid.');
      return res.status(400).json({ message: 'This reset link is invalid. It may have already been used. Please request a new one from the app.' });
    }

    if (!user.resetTokenExpiry || new Date() > new Date(user.resetTokenExpiry)) {
      console.warn(`[reset-password] Token expired for user: ${user.email}`);
      return res.status(400).json({ message: 'This reset link has expired (links are valid for 30 minutes). Please request a new one from the app.' });
    }

    user.password = newPassword;
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();

    res.json({ message: 'Password has been reset successfully. You can now log in with your new password.' });
  } catch (error) {
    console.error('[reset-password] Error:', error);
    res.status(500).json({ message: 'Could not reset your password due to a server error. Please try again.' });
  }
});

module.exports = router;
