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
  tls: { rejectUnauthorized: true },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
});

const recipients = config.NOTIFY_EMAILS
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

export interface WorkerReport {
  worker: string;
  status: "completed" | "failed";
  supplierCode?: string;
  totalProducts?: number;
  totalUpdated?: number;
  totalErrors?: number;
  durationMs?: number;
  throughput?: string;
  subJobs?: number;
  errorMessage?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

function statusColor(status: string): string {
  return status === "completed" ? "#22c55e" : "#ef4444";
}

function statusEmoji(status: string): string {
  return status === "completed" ? "\u2705" : "\u274c";
}

/**
 * Send a worker status notification email to all configured recipients.
 * Fire-and-forget — never throws.
 */
export async function sendWorkerNotification(report: WorkerReport): Promise<void> {
  if (recipients.length === 0 || !config.SMTP_USER) return;

  try {
    const subject = `${statusEmoji(report.status)} OEMline ${report.worker}: ${report.status}${report.supplierCode ? ` (${report.supplierCode})` : ""}`;

    const rows: Array<[string, string]> = [
      ["Worker", report.worker],
      ["Status", report.status.toUpperCase()],
    ];
    if (report.supplierCode) rows.push(["Supplier", report.supplierCode]);
    if (report.totalProducts != null) rows.push(["Total Products", report.totalProducts.toLocaleString()]);
    if (report.totalUpdated != null) rows.push(["Updated", report.totalUpdated.toLocaleString()]);
    if (report.totalErrors != null && report.totalErrors > 0) rows.push(["Errors", report.totalErrors.toLocaleString()]);
    if (report.durationMs != null) rows.push(["Duration", formatDuration(report.durationMs)]);
    if (report.throughput) rows.push(["Throughput", report.throughput]);
    if (report.subJobs != null) rows.push(["Sub-Jobs", report.subJobs.toLocaleString()]);
    if (report.errorMessage) rows.push(["Error", report.errorMessage.slice(0, 500)]);

    const textBody = rows.map(([k, v]) => `${k}: ${v}`).join("\n");

    const tableRows = rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;white-space:nowrap;">${k}</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#111827;">${v}</td></tr>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#1a1a2e;padding:20px 28px;">
          <table width="100%"><tr>
            <td><div style="display:inline-block;width:36px;height:36px;background:#3b82f6;border-radius:8px;line-height:36px;color:#fff;font-weight:bold;font-size:14px;text-align:center;">OL</div></td>
            <td style="padding-left:12px;"><span style="color:#ffffff;font-size:18px;font-weight:600;">Worker Status Report</span></td>
            <td style="text-align:right;"><span style="display:inline-block;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;color:#fff;background:${statusColor(report.status)};">${report.status.toUpperCase()}</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            ${tableRows}
          </table>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:14px 28px;border-top:1px solid #e5e7eb;">
          <p style="color:#9ca3af;font-size:11px;margin:0;text-align:center;">OEMline B.V. — Automated Worker Notification</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await transporter.sendMail({
      from: `"OEMline Workers" <${config.EMAIL_FROM}>`,
      to: recipients.join(", "),
      subject,
      text: textBody,
      html,
    });

    logger.info({ worker: report.worker, status: report.status, to: recipients }, "Worker notification email sent");
  } catch (err) {
    logger.warn({ err, worker: report.worker }, "Failed to send worker notification email");
  }
}
