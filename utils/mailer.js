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

// Shared brand wrapper for all transactional emails — table-based layout so it
// renders consistently in Outlook desktop too, not just Gmail/modern clients.
// `accentColor` lets each email tint its header band (e.g. green for reset,
// gold for a future "welcome" email) while keeping the same overall look.
const emailShell = ({ headerTitle, accentColor = '#0f4c3a', bodyHtml }) => `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#eef3f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f0;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 8px 30px rgba(15,76,58,0.12);">

            <!-- Header band -->
            <tr>
              <td align="center" style="background:${accentColor};background-image:linear-gradient(135deg,${accentColor} 0%,#1a7a5c 100%);padding:36px 24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="width:64px;height:64px;background:rgba(255,255,255,0.18);border-radius:18px;font-size:30px;line-height:64px;">🕌</td>
                  </tr>
                </table>
                <div style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:0.2px;margin-top:16px;">Masjid Finder</div>
                <div style="color:rgba(255,255,255,0.75);font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-top:4px;">${headerTitle}</div>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:36px 32px 8px;">
                ${bodyHtml}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:28px 32px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #eef2ef;padding-top:20px;" align="center">
                  <div style="color:#9ab5a8;font-size:12px;font-weight:600;">Masjid Finder &nbsp;·&nbsp; Find your nearest masjid, on time, every time</div>
                  <div style="color:#c3d3cb;font-size:11px;margin-top:6px;">© ${new Date().getFullYear()} Masjid Finder. All rights reserved.</div>
                </td></tr></table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

const sendPasswordResetEmail = async (toEmail, userName, resetLink) => {
  try {
    const transporter = createTransporter();
    const body = `
      <h2 style="color:#0f4c3a;font-size:22px;font-weight:800;margin:0 0 10px;text-align:center;">Reset Your Password</h2>
      <p style="color:#5a7a6a;font-size:15px;line-height:22px;margin:0 0 24px;text-align:center;">
        Hi <strong style="color:#0f4c3a;">${userName || 'there'}</strong>, we received a request to reset your password.
        Tap the button below to choose a new one.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="background:#0f4c3a;border-radius:14px;">
                  <a href="${resetLink}" style="display:inline-block;padding:16px 40px;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;">Reset Password</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;margin-bottom:20px;">
        <tr>
          <td style="padding:12px 16px;" align="center">
            <span style="color:#92400e;font-size:12px;font-weight:800;letter-spacing:0.3px;">⏱ THIS LINK EXPIRES IN 30 MINUTES</span>
          </td>
        </tr>
      </table>

      <p style="color:#9ab5a8;font-size:12px;line-height:18px;margin:0;text-align:center;">
        If the button doesn't work, copy and paste this link into your browser:<br/>
        <a href="${resetLink}" style="color:#1a7a5c;word-break:break-all;">${resetLink}</a>
      </p>
      <p style="color:#c3d3cb;font-size:12px;margin:20px 0 0;text-align:center;">
        Didn't request this? You can safely ignore this email — your password won't change.
      </p>
    `;

    await transporter.sendMail({
      from: `"Masjid Finder" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: 'Reset Your Password — Masjid Finder',
      html: emailShell({ headerTitle: 'Password Reset', accentColor: '#0f4c3a', bodyHtml: body }),
    });
  } catch (error) {
    console.error('Reset email error:', error.message);
  }
};

module.exports = { sendPasswordResetEmail };
