const nodemailer = require('nodemailer');

const createTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: true,
  family: 4, // Force IPv4 — Render doesn't support IPv6 outbound
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendOtpEmail = async (toEmail, userName, otp) => {
  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"Masjid Finder" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: 'Your Password Reset OTP',
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#f0f4f1;padding:32px 16px">
          <div style="background:#fff;border-radius:24px;padding:36px 32px;text-align:center">
            <div style="width:64px;height:64px;background:#ecfdf5;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px">
              <span style="font-size:28px">🕌</span>
            </div>
            <h2 style="color:#0f4c3a;font-size:22px;font-weight:800;margin:0 0 8px">Reset Your Password</h2>
            <p style="color:#5a7a6a;font-size:15px;margin:0 0 28px">Hi ${userName || 'there'}, use this OTP to reset your password. It expires in <strong>15 minutes</strong>.</p>
            <div style="background:#f0fdf4;border:2px dashed #86efac;border-radius:16px;padding:24px;margin-bottom:28px">
              <p style="color:#5a7a6a;font-size:12px;font-weight:700;letter-spacing:1px;margin:0 0 10px;text-transform:uppercase">Your OTP Code</p>
              <div style="letter-spacing:12px;font-size:40px;font-weight:900;color:#0f4c3a;font-family:monospace">${otp}</div>
            </div>
            <p style="color:#9ab5a8;font-size:13px;margin:0">Never share this code. If you did not request this, ignore this email.</p>
          </div>
          <p style="text-align:center;color:#9ab5a8;font-size:12px;margin-top:20px">Masjid Finder &nbsp;·&nbsp; 🕌</p>
        </div>
      `,
    });
  } catch (error) {
    console.error('OTP email error:', error.message);
  }
};

const sendPasswordResetEmail = async (toEmail, resetLink) => {
  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"Masjid Finder" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family:Arial,sans-serif;padding:20px;line-height:1.5;color:#333">
          <h2 style="color:#0f4c3a">Password Reset</h2>
          <p>Click the button below to reset your password. This link is valid for 15 minutes.</p>
          <a href="${resetLink}" style="display:inline-block;padding:12px 24px;margin-top:10px;background:#0f4c3a;color:white;text-decoration:none;border-radius:6px;font-weight:bold">Reset Password</a>
          <p style="margin-top:20px;font-size:14px;color:#666">If you did not request this, ignore this email.</p>
        </div>
      `,
    });
  } catch (error) {
    console.error('Reset email error:', error.message);
  }
};

module.exports = { sendOtpEmail, sendPasswordResetEmail };
