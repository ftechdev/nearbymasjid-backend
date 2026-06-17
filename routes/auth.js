const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { OAuth2Client } = require('google-auth-library');
const { protect } = require('../middleware/auth');
const { sendOtpEmail, sendPasswordResetEmail } = require('../utils/mailer');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { message: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please provide name, email, and password' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const userExists = await User.findOne({ where: { email } });
    if (userExists) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    const user = await User.create({ name, email, password });

    res.status(201).json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user.id)
    });
  } catch (error) {
    console.error('Register Error:', error);
    res.status(500).json({ message: 'Server error during registration. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    const user = await User.findOne({ where: { email } });

    if (!user || !user.password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user.id)
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Server error during login. Please try again.' });
  }
});

// POST /api/auth/google
router.post('/google', authLimiter, async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: 'Google token is required' });
    }

    // Create client fresh each request so it always uses current env value
    const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    const ticket = await googleClient.verifyIdToken({
      idToken: idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    if (!email) {
      return res.status(400).json({ message: 'Could not get email from Google account' });
    }

    let user = await User.findOne({ where: { email } });

    if (!user) {
      user = await User.create({
        name: name || email.split('@')[0],
        email,
        // No password for Google users
      });
    }

    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user.id)
    });
  } catch (error) {
    console.error('Google Auth Error:', error.message);
    console.error('GOOGLE_CLIENT_ID in use:', process.env.GOOGLE_CLIENT_ID);
    if (error.message && error.message.includes('Token used too late')) {
      return res.status(401).json({ message: 'Google session expired. Please try again.' });
    }
    if (error.message && error.message.includes('Wrong recipient')) {
      return res.status(401).json({ message: 'Google Client ID mismatch. Contact support.' });
    }
    res.status(401).json({ message: 'Google sign-in failed. Please try again.' });
  }
});

// GET /api/auth/me - Get current user profile
router.get('/me', protect, async (req, res) => {
  try {
    res.json({
      _id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/forgot-password — sends 6-digit OTP to email
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ where: { email } });

    if (user) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      user.resetOtp = otp;
      user.resetOtpExpiry = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();
      // Fire-and-forget — don't block the response on SMTP
      sendOtpEmail(user.email, user.name, otp).catch(e => console.error('OTP email failed:', e.message));
    }

    res.json({ message: 'If an account with that email exists, an OTP has been sent.' });
  } catch (error) {
    console.error('Forgot Password Error:', error);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// POST /api/auth/verify-otp — verifies OTP, returns short-lived reset token
router.post('/verify-otp', authLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

    const user = await User.findOne({ where: { email } });

    if (
      !user ||
      !user.resetOtp ||
      user.resetOtp !== otp.trim() ||
      !user.resetOtpExpiry ||
      new Date() > new Date(user.resetOtpExpiry)
    ) {
      return res.status(400).json({ message: 'Invalid or expired OTP. Please try again.' });
    }

    // Clear OTP immediately after use
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    await user.save();

    const resetToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    res.json({ message: 'OTP verified', resetToken });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Missing token or new password' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id);

    if (!user) {
      return res.status(404).json({ message: 'Invalid or expired token' });
    }

    // Update password (model hook will hash it)
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ message: 'Token has expired. Please request a new link.' });
    }
    console.error('Reset Password Error:', error);
    res.status(500).json({ message: 'Invalid or expired token. Please try again.' });
  }
});

module.exports = router;
