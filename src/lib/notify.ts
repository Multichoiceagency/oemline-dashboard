import { logger } from "./logger.js";

// All email notifications disabled.

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

export interface SyncSummaryReport {
  worker: string;
  updated: number;
  stillPending: number;
  totalWithIcSku: number;
  totalProducts: number;
  newMappings?: number;
  durationMs?: number;
  detail?: string;
}

export async function sendSyncSummary(report: SyncSummaryReport): Promise<void> {
  logger.debug({ worker: report.worker }, "sendSyncSummary: notifications disabled");
}

export async function sendProgressNotification(report: { worker: string; progress: number }): Promise<void> {
  logger.debug({ worker: report.worker, progress: report.progress }, "sendProgressNotification: notifications disabled");
}

export async function sendWorkerNotification(report: WorkerReport): Promise<void> {
  logger.debug({ worker: report.worker, status: report.status }, "sendWorkerNotification: notifications disabled");
}
