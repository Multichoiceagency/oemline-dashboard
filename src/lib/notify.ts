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

export interface SyncSummaryReport {
  worker: string;
  /** Products that were successfully updated (price/stock set) */
  updated: number;
  /** Products that still have no price after this sync */
  stillPending: number;
  /** Total products with IC SKU (= potential IC-priced products) */
  totalWithIcSku: number;
  /** Total active products in the catalog */
  totalProducts: number;
  /** New mappings added (ic-catalog only) */
  newMappings?: number;
  durationMs?: number;
  detail?: string;
}

/**
 * Send ONE summary email after a sync completes.
 * Shows: how many products were updated, how many still need pricing, percentages.
 * Fire-and-forget — never throws.
 */
export async function sendSyncSummary(report: SyncSummaryReport): Promise<void> {
  if (recipients.length === 0 || !config.SMTP_USER) return;

  try {
    const pctDone = report.totalWithIcSku > 0
      ? Math.round((report.totalWithIcSku - report.stillPending) / report.totalWithIcSku * 100)
      : 0;

    const isComplete = report.stillPending === 0;
    const statusLabel = isComplete ? "VOLLEDIG GEREED" : "DEELS GEREED";
    const statusColor = isComplete ? "#22c55e" : "#f59e0b";
    const progressBar = "█".repeat(Math.floor(pctDone / 5)) + "░".repeat(20 - Math.floor(pctDone / 5));

    const subject = `✅ OEMline ${report.worker}: ${report.updated.toLocaleString("nl-NL")} producten bijgewerkt`;

    const duration = report.durationMs
      ? (report.durationMs < 60000
          ? `${Math.round(report.durationMs / 1000)}s`
          : `${Math.floor(report.durationMs / 60000)}m ${Math.round((report.durationMs % 60000) / 1000)}s`)
      : null;

    const rows: Array<[string, string, string?]> = [
      ["✅ Producten bijgewerkt", report.updated.toLocaleString("nl-NL"), "#22c55e"],
      ["⏳ Nog zonder prijs", report.stillPending.toLocaleString("nl-NL"), report.stillPending > 0 ? "#f59e0b" : "#22c55e"],
      ["📦 Totaal met IC SKU", report.totalWithIcSku.toLocaleString("nl-NL"), undefined],
      ["🗂 Totaal producten", report.totalProducts.toLocaleString("nl-NL"), undefined],
      ["📊 Prijsdekking", `${pctDone}%  [${progressBar}]`, pctDone >= 80 ? "#22c55e" : "#f59e0b"],
    ];
    if (report.newMappings != null) {
      rows.push(["🆕 Nieuwe IC mappings", report.newMappings.toLocaleString("nl-NL"), "#3b82f6"]);
    }
    if (duration) rows.push(["⏱ Duur", duration, undefined]);
    if (report.detail) rows.push(["📝 Details", report.detail, undefined]);
    rows.push(["🕐 Tijd", new Date().toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" }), undefined]);

    const tableRows = rows.map(([k, v, color]) =>
      `<tr>
        <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;white-space:nowrap;">${k}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;color:${color ?? "#111827"};font-weight:${color ? "700" : "400"};font-family:monospace;">${v}</td>
      </tr>`
    ).join("");

    const html = `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#1a1a2e;padding:24px 28px;">
          <table width="100%"><tr>
            <td><div style="display:inline-block;width:40px;height:40px;background:#3b82f6;border-radius:8px;line-height:40px;color:#fff;font-weight:bold;font-size:16px;text-align:center;">OL</div></td>
            <td style="padding-left:14px;">
              <div style="color:#ffffff;font-size:18px;font-weight:700;">${report.worker}</div>
              <div style="color:#94a3b8;font-size:12px;">Synchronisatie voltooid</div>
            </td>
            <td style="text-align:right;"><span style="display:inline-block;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;color:#fff;background:${statusColor};">${statusLabel}</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:0 28px 4px;">
          <div style="background:#e5e7eb;border-radius:0 0 4px 4px;height:10px;overflow:hidden;">
            <div style="background:linear-gradient(90deg,#22c55e,#3b82f6);height:10px;width:${pctDone}%;"></div>
          </div>
          <div style="text-align:right;font-size:11px;color:#9ca3af;margin-top:4px;">${pctDone}% van alle IC-producten heeft een prijs</div>
        </td></tr>
        <tr><td style="padding:20px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            ${tableRows}
          </table>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:14px 28px;border-top:1px solid #e5e7eb;">
          <p style="color:#9ca3af;font-size:11px;margin:0;text-align:center;">OEMline B.V. &mdash; info@oemline.eu &mdash; Automatisch synchronisatierapport</p>
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
      text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
      html,
    });

    logger.info({ worker: report.worker, updated: report.updated, stillPending: report.stillPending }, "Sync summary email sent");
  } catch (err) {
    logger.warn({ err, worker: report.worker }, "Failed to send sync summary email");
  }
}

/** @deprecated Use sendSyncSummary instead — kept for backward compat */
export async function sendProgressNotification(report: { worker: string; progress: number; processed?: number; total?: number; detail?: string }): Promise<void> {
  // No-op: replaced by sendSyncSummary (one email per sync, not per-5% milestone)
  logger.debug({ worker: report.worker, progress: report.progress }, "sendProgressNotification called (no-op, use sendSyncSummary)");
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
