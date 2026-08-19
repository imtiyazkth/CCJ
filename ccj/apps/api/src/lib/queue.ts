/**
 * CCJ In-Memory Job Queue
 *
 * Zero-dependency queue for Android/Termux dev.
 * Same interface as a Redis-backed queue — swap in BullMQ later
 * by replacing this module.
 *
 * Limitations vs BullMQ:
 * - Jobs are lost on process restart (acceptable in dev)
 * - No cross-process coordination (single Node.js process only)
 * - No delayed jobs persistence
 */

export type JobStatus = "pending" | "running" | "done" | "failed";

export interface Job<T = unknown> {
  id: string;
  queue: string;
  data: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

type JobHandler<T> = (job: Job<T>) => Promise<void>;

class InMemoryQueue<T = unknown> {
  private jobs = new Map<string, Job<T>>();
  private handler: JobHandler<T> | null = null;
  private processing = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  process(handler: JobHandler<T>, concurrency = 1): void {
    this.handler = handler;
    // Poll every 500ms for pending jobs
    this.interval = setInterval(() => void this._tick(concurrency), 500);
  }

  async add(id: string, data: T, opts?: { maxAttempts?: number }): Promise<Job<T>> {
    const job: Job<T> = {
      id,
      queue: this.name,
      data,
      status: "pending",
      attempts: 0,
      maxAttempts: opts?.maxAttempts ?? 3,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    };
    this.jobs.set(id, job);
    return job;
  }

  getJob(id: string): Job<T> | undefined {
    return this.jobs.get(id);
  }

  getPending(): Job<T>[] {
    return [...this.jobs.values()].filter((j) => j.status === "pending");
  }

  private async _tick(concurrency: number): Promise<void> {
    if (!this.handler || this.processing) return;
    const pending = this.getPending().slice(0, concurrency);
    if (pending.length === 0) return;

    this.processing = true;
    await Promise.all(pending.map((job) => this._run(job)));
    this.processing = false;
  }

  private async _run(job: Job<T>): Promise<void> {
    if (!this.handler) return;
    job.status = "running";
    job.startedAt = new Date();
    job.attempts += 1;

    try {
      await this.handler(job);
      job.status = "done";
      job.completedAt = new Date();
    } catch (err) {
      job.error = String(err);
      if (job.attempts >= job.maxAttempts) {
        job.status = "failed";
        job.completedAt = new Date();
      } else {
        job.status = "pending"; // retry
      }
    }
  }

  close(): void {
    if (this.interval) clearInterval(this.interval);
  }
}

// ── Singleton queues ──────────────────────────────────────────

interface ResearchJobData {
  runId: string;
  projectId: string;
  topic: string;
  depth: string;
  requestedLanguage: string;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
}

let _researchQueue: InMemoryQueue<ResearchJobData> | null = null;

export function getResearchQueue(): InMemoryQueue<ResearchJobData> {
  if (!_researchQueue) {
    _researchQueue = new InMemoryQueue<ResearchJobData>("research");
  }
  return _researchQueue;
}

// ── In-memory rate limiter ─────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const _rateLimits = new Map<string, RateLimitEntry>();

/**
 * Simple sliding-window rate limiter (in-memory).
 * Returns true if the request is allowed, false if rate-limited.
 */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = _rateLimits.get(key);

  if (!entry || now > entry.resetAt) {
    _rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) return false;

  entry.count += 1;
  return true;
}

/** Clean up expired rate limit entries (call periodically) */
export function cleanRateLimits(): void {
  const now = Date.now();
  for (const [key, entry] of _rateLimits) {
    if (now > entry.resetAt) _rateLimits.delete(key);
  }
}
