export type LoadStage = 'download' | 'textures' | 'prepare' | 'failed';
export interface LoadReport { stage: Exclude<LoadStage, 'failed'>; progress: number | null; count?: { done: number; total: number } }
export interface AssetLoadStatus { entityId: string; assetId: string; stage: LoadStage; progress: number | null; count?: { done: number; total: number }; message?: string }
export interface LoadRequest { kind: 'avatar' | 'mesh'; assetId: string }

type Job<T> = { request: LoadRequest; state: 'loading' | 'ready' | 'failed'; status: AssetLoadStatus; value?: T; cancelled: boolean; dismissed: boolean; failed?: { revision: number; time: number } };
const sameRequest = (a: LoadRequest, b: LoadRequest) => a.kind === b.kind && a.assetId === b.assetId;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function createLoadJobs<T extends { dispose(): void }>(
  start: (request: LoadRequest, report: (report: LoadReport) => void, cancelled: () => boolean) => Promise<T>,
  onStatus: (entries: AssetLoadStatus[]) => void,
  { now = () => performance.now(), retryAfterMs = 3000 }: { now?: () => number; retryAfterMs?: number } = {},
) {
  const jobs = new Map<string, Job<T>>();
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
      job.state = 'failed';
      job.failed = { revision, time: now() };
      job.status = { entityId, assetId: request.assetId, stage: 'failed', progress: null, message: messageOf(error) };
      emit();
    });
  };
  return {
    reconcile(needed: ReadonlyMap<string, LoadRequest>, frameRevision: number) {
      if (closed) return;
      revision = frameRevision;
      let changed = false;
      for (const [entityId, job] of [...jobs]) {
        const request = needed.get(entityId);
        const retry = job.failed !== undefined && frameRevision > job.failed.revision && now() - job.failed.time >= retryAfterMs;
        if (!request || !sameRequest(request, job.request) || retry) { cancel(entityId); changed = true; }
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
    failure: (entityId: string) => { const job = jobs.get(entityId); return job?.state === 'failed' ? job.status.message : undefined; },
    dismiss(entityId: string) { const job = jobs.get(entityId); if (job?.state === 'failed' && !job.dismissed) { job.dismissed = true; emit(); } },
    assetIds: () => new Set([...jobs.values()].map(job => job.request.assetId)),
    status,
    dispose() { if (closed) return; for (const entityId of [...jobs.keys()]) cancel(entityId); closed = true; },
  };
}
