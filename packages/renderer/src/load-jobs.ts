export type LoadStage = 'download' | 'textures' | 'prepare' | 'failed';
export interface LoadReport { stage: Exclude<LoadStage, 'failed'>; progress: number | null; count?: { done: number; total: number } }
export interface AssetLoadStatus { entityId: string; assetId: string; stage: LoadStage; progress: number | null; count?: { done: number; total: number }; message?: string }
/**
 * `retryKey` is the content of a video screen: a change of it, or of the asset ID, starts a new retry count (B29 R15).
 * It is not part of the request identity, so a change of Loop or Volume does not load the video again.
 */
export interface LoadRequest { kind: 'avatar' | 'mesh' | 'environment' | 'screen' | 'video'; assetId: string; retryKey?: string }
/** A failed video job retries at most this many times for one asset ID in one renderer instance (B29 R15). */
export const VIDEO_RETRY_LIMIT = 3;

type Job<T> = { request: LoadRequest; state: 'loading' | 'ready' | 'failed'; status: AssetLoadStatus; value?: T; cancelled: boolean; dismissed: boolean; failed?: { revision: number; time: number } };
const sameRequest = (a: LoadRequest, b: LoadRequest) => a.kind === b.kind && a.assetId === b.assetId;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function createLoadJobs<T extends { dispose(): void }>(
  start: (request: LoadRequest, report: (report: LoadReport) => void, cancelled: () => boolean) => Promise<T>,
  onStatus: (entries: AssetLoadStatus[]) => void,
  { now = () => performance.now(), retryAfterMs = 3000 }: { now?: () => number; retryAfterMs?: number } = {},
) {
  const jobs = new Map<string, Job<T>>();
  const retries = new Map<string, { assetId: string; key: string | undefined; count: number }>();
  let closed = false, revision = -Infinity;
  const status = () => [...jobs.values()].filter(job => job.state === 'loading' || (job.state === 'failed' && !job.dismissed)).map(job => ({ ...job.status }));
  const emit = () => { if (!closed) onStatus(status()); };
  const cancel = (entityId: string) => {
    const job = jobs.get(entityId);
    if (!job) return;
    jobs.delete(entityId);
    job.cancelled = true;
    job.value?.dispose();
    job.value = undefined;
  };
  const failJob = (job: Job<T>, entityId: string, message: string) => {
    job.state = 'failed';
    job.failed = { revision, time: now() };
    job.status = { entityId, assetId: job.request.assetId, stage: 'failed', progress: null, message };
  };
  const begin = (entityId: string, request: LoadRequest) => {
    const job: Job<T> = { request, state: 'loading', status: { entityId, assetId: request.assetId, stage: 'download', progress: null }, cancelled: false, dismissed: false };
    jobs.set(entityId, job);
    const report = (next: LoadReport) => {
      if (job.cancelled || job.state !== 'loading') return;
      job.status = { entityId, assetId: request.assetId, ...next };
      emit();
    };
    let running: Promise<T>;
    try { running = start(request, report, () => job.cancelled); } catch (error) { running = Promise.reject(error); }
    void running.then(value => {
      if (job.cancelled) { value.dispose(); return; }
      job.value = value;
      job.state = 'ready';
      emit();
    }, error => {
      if (job.cancelled) return;
      failJob(job, entityId, messageOf(error));
      emit();
    });
  };
  return {
    reconcile(needed: ReadonlyMap<string, LoadRequest>, frameRevision: number, videoScreens: ReadonlySet<string> = new Set()) {
      if (closed) return;
      revision = frameRevision;
      let changed = false;
      // An installed video keeps its count, so an element error after the load does not reset the cap.
      for (const entityId of [...retries.keys()]) if (needed.get(entityId)?.kind !== 'video' && !videoScreens.has(entityId)) retries.delete(entityId);
      for (const [entityId, request] of needed) {
        const count = retries.get(entityId);
        if (request.kind === 'video' && (count?.assetId !== request.assetId || count.key !== request.retryKey)) retries.set(entityId, { assetId: request.assetId, key: request.retryKey, count: 0 });
      }
      for (const [entityId, job] of [...jobs]) {
        const request = needed.get(entityId);
        const count = retries.get(entityId);
        const capped = request?.kind === 'video' && count !== undefined && count.count >= VIDEO_RETRY_LIMIT;
        const retry = job.failed !== undefined && frameRevision > job.failed.revision && now() - job.failed.time >= retryAfterMs && !capped;
        if (!request || !sameRequest(request, job.request) || retry) {
          if (retry && request && sameRequest(request, job.request) && request.kind === 'video' && count) count.count++;
          cancel(entityId); changed = true;
        }
      }
      for (const [entityId, request] of needed) if (!jobs.has(entityId)) { begin(entityId, request); changed = true; }
      if (changed) emit();
    },
    take(entityId: string): T | undefined {
      const job = jobs.get(entityId);
      if (job?.state !== 'ready') return undefined;
      jobs.delete(entityId);
      return job.value;
    },
    /** Marks a loaded and taken value as failed (a video element error after `loadeddata`), so the retry rule applies. */
    fail(entityId: string, request: LoadRequest, message: string) {
      if (closed) return;
      cancel(entityId);
      const job: Job<T> = { request, state: 'loading', status: { entityId, assetId: request.assetId, stage: 'download', progress: null }, cancelled: false, dismissed: false };
      failJob(job, entityId, message);
      jobs.set(entityId, job);
      emit();
    },
    failure: (entityId: string) => { const job = jobs.get(entityId); return job?.state === 'failed' ? job.status.message : undefined; },
    dismiss(entityId: string) { const job = jobs.get(entityId); if (job?.state === 'failed' && !job.dismissed) { job.dismissed = true; emit(); } },
    assetIds: () => new Set([...jobs.values()].map(job => job.request.assetId)),
    status,
    dispose() { if (closed) return; for (const entityId of [...jobs.keys()]) cancel(entityId); closed = true; },
  };
}
