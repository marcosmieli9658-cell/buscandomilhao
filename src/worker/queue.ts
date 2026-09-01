import crypto from "node:crypto";
import { database } from "@/db/client";

export interface DurableJob<T = Record<string, unknown>> {
  id: number;
  type: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
}

export function enqueueJob(type: string, payload: Record<string, unknown>, options?: { dedupeKey?: string; runAt?: Date; maxAttempts?: number }) {
  const now = Date.now();
  const dedupeKey = options?.dedupeKey ?? crypto.createHash("sha256").update(`${type}:${JSON.stringify(payload)}`).digest("hex");
  database.sqlite.prepare(`
    INSERT INTO jobs (type, status, payload_json, dedupe_key, attempts, max_attempts, run_at, created_at, updated_at)
    VALUES (?, 'pending', ?, ?, 0, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO NOTHING
  `).run(type, JSON.stringify(payload), dedupeKey, options?.maxAttempts ?? 3, (options?.runAt ?? new Date()).getTime(), now, now);
  return database.sqlite.prepare("SELECT * FROM jobs WHERE dedupe_key = ?").get(dedupeKey) as Record<string, unknown>;
}

export function recoverStaleJobs(staleAfterMs = 5 * 60_000): number {
  const result = database.sqlite.prepare(`
    UPDATE jobs SET status = 'retry', locked_at = NULL, locked_by = NULL, updated_at = ?
    WHERE status = 'running' AND locked_at < ?
  `).run(Date.now(), Date.now() - staleAfterMs);
  return result.changes;
}

export function claimNextJob(workerId: string): DurableJob | null {
  const transaction = database.sqlite.transaction(() => {
    const settings = database.sqlite.prepare("SELECT globally_paused FROM system_settings WHERE id = 1").get() as { globally_paused: number } | undefined;
    if (settings?.globally_paused) return null;
    const row = database.sqlite.prepare(`
      SELECT * FROM jobs
      WHERE status IN ('pending', 'retry') AND run_at <= ?
      ORDER BY run_at ASC, id ASC LIMIT 1
    `).get(Date.now()) as { id: number; type: string; payload_json: string; attempts: number; max_attempts: number } | undefined;
    if (!row) return null;
    const result = database.sqlite.prepare(`
      UPDATE jobs SET status = 'running', locked_at = ?, locked_by = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'retry')
    `).run(Date.now(), workerId, Date.now(), row.id);
    if (result.changes !== 1) return null;
    return { id: row.id, type: row.type, payload: JSON.parse(row.payload_json) as Record<string, unknown>, attempts: row.attempts + 1, maxAttempts: row.max_attempts };
  });
  return transaction();
}

export function completeJob(jobId: number): void {
  database.sqlite.prepare("UPDATE jobs SET status = 'completed', completed_at = ?, locked_at = NULL, locked_by = NULL, updated_at = ? WHERE id = ?").run(Date.now(), Date.now(), jobId);
}

export function failJob(job: DurableJob, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const deadLetter = job.attempts >= job.maxAttempts;
  const retryDelay = Math.min(60 * 60_000, 2 ** job.attempts * 30_000);
  database.sqlite.prepare(`
    UPDATE jobs SET status = ?, run_at = ?, last_error = ?, locked_at = NULL, locked_by = NULL, updated_at = ? WHERE id = ?
  `).run(deadLetter ? "dead_letter" : "retry", Date.now() + retryDelay, message.slice(0, 2000), Date.now(), job.id);
  if (deadLetter) {
    database.sqlite.prepare(`INSERT INTO exceptions (job_id, code, message, details_json, status, created_at, updated_at) VALUES (?, 'job_dead_letter', ?, '{}', 'open', ?, ?)`)
      .run(job.id, message.slice(0, 1000), Date.now(), Date.now());
  }
}

export function setGlobalPause(paused: boolean, reason: string | null): void {
  database.sqlite.prepare("UPDATE system_settings SET globally_paused = ?, pause_reason = ?, updated_at = ? WHERE id = 1").run(paused ? 1 : 0, reason, Date.now());
}

export function pauseBrowserQueue(reason: string): void {
  database.sqlite.prepare("UPDATE system_settings SET browser_queue_paused = 1, browser_pause_reason = ?, updated_at = ? WHERE id = 1").run(reason, Date.now());
}
