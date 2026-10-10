export interface FrameScheduler { request(callback: () => void): number; cancel(id: number): void }
const displayFrames: FrameScheduler = { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) };

/** The preview consumes evaluated frames at display rate. It owns no simulation clock. */
export function createPreviewPump<T>(apply: (frame: T) => Promise<void>, fail: (error: unknown) => void, scheduler: FrameScheduler = displayFrames) {
 let latest: T | undefined;
 let active = false;
 let stopped = false;
 const tick = () => {
  if (stopped) return;
  handle = scheduler.request(tick);
  if (active || latest === undefined) return;
  const frame = latest;
  latest = undefined;
  active = true;
  void Promise.resolve().then(() => apply(frame)).catch(error => {
   if (!stopped) fail(error);
  }).finally(() => { active = false; });
 };
 let handle = scheduler.request(tick);
 return {
  offer(frame: T) { if (!stopped) latest = frame; },
  stop() { stopped = true; latest = undefined; scheduler.cancel(handle); }
 };
}
