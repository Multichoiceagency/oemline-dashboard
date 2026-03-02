import nodemailer from "nodemailer";
import { config } from "../config.js";
import { logger } from "./logger.js";

const transporter = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_PORT === 465,
  auth: {
    user: config.SMTP_USER,
    pass: config.SMTP_PASSWORD,
  },
  // Security: enforce TLS, reject self-signed certs
  tls: {
    rejectUnauthorized: true,
  },
  // Timeouts to prevent hanging connections
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
});

export async function sendVerificationCode(
  to: string,
  code: string
): Promise<void> {
  // Security: sanitize email display in HTML to prevent XSS
  const safeEmail = to.replace(/[<>&"']/g, "");
  const safeCode = code.replace(/\D/g, "").slice(0, 6);

  await transporter.sendMail({
    from: `"OEMline Dashboard" <${config.EMAIL_FROM}>`,
    to,
    subject: `Your OEMline login code: ${safeCode}`,
    text: [
      `Your verification code is: ${safeCode}`,
      "",
      "This code expires in 5 minutes.",
      "If you did not request this, please ignore this email.",
      "",
      "— OEMline Dashboard",
    ].join("\n"),
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="420" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#1a1a2e;padding:24px 32px;text-align:center;">
          <div style="display:inline-block;width:40px;height:40px;background:#3b82f6;border-radius:8px;line-height:40px;color:#fff;font-weight:bold;font-size:16px;">OL</div>
          <h1 style="color:#ffffff;font-size:20px;margin:12px 0 0;font-weight:600;">OEMline Dashboard</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="color:#374151;font-size:15px;margin:0 0 8px;">Hello,</p>
          <p style="color:#374151;font-size:15px;margin:0 0 24px;">Use the code below to sign in to the OEMline Dashboard:</p>
          <div style="background:#f0f4ff;border:2px solid #3b82f6;border-radius:8px;padding:20px;text-align:center;margin:0 0 24px;">
            <span style="font-size:36px;font-weight:700;letter-spacing:12px;color:#1a1a2e;font-family:monospace;">${safeCode}</span>
          </div>
          <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">This code expires in <strong>5 minutes</strong>.</p>
          <p style="color:#6b7280;font-size:13px;margin:0;">If you did not request this code, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="color:#9ca3af;font-size:11px;margin:0;text-align:center;">OEMline B.V. — Automotive Parts Platform</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });

  logger.info({ to: safeEmail }, "Verification code email sent");
}
