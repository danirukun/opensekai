/** The preview consumes evaluated frames. It owns no simulation clock. */
export function createPreviewPump<T>(apply: (frame: T) => Promise<void>, fail: (error: unknown) => void) {
 let latest: T | undefined;
 let active = false;
 let stopped = false;
 const timer = setInterval(() => {
  if (stopped || active || latest === undefined) return;
  const frame = latest;
  latest = undefined;
  active = true;
  void Promise.resolve().then(() => apply(frame)).catch(error => {
   if (!stopped) fail(error);
  }).finally(() => { active = false; });
 }, 1000 / 15);
 return {
  offer(frame: T) { if (!stopped) latest = frame; },
  stop() { stopped = true; latest = undefined; clearInterval(timer); }
 };
}
