import { describe, expect, it, vi } from 'vitest';
import { createPreviewPump } from '../src/preview-pump';

describe('preview pump', () => {
 it('coalesces to the newest frame at 15 FPS and never overlaps GPU work', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const apply = vi.fn().mockImplementationOnce(() => pending).mockResolvedValue(undefined);
  const pump = createPreviewPump<number>(apply, vi.fn());
  pump.offer(1); pump.offer(2);
  await vi.advanceTimersByTimeAsync(67);
  expect(apply.mock.calls).toEqual([[2]]);
  pump.offer(3); pump.offer(4);
  await vi.advanceTimersByTimeAsync(200);
  expect(apply).toHaveBeenCalledTimes(1);
  release(); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(67);
  expect(apply.mock.calls).toEqual([[2], [4]]);
  pump.stop(); vi.useRealTimers();
 });
 it('releases queued state on stop and reports a failed submission once', async () => {
  vi.useFakeTimers();
  const error = { code: 'UNSUPPORTED', message: 'GPU failure' };
  const apply = vi.fn().mockRejectedValue(error), fail = vi.fn();
  const pump = createPreviewPump<number>(apply, fail);
  pump.offer(1); await vi.advanceTimersByTimeAsync(67);
  expect(fail).toHaveBeenCalledExactlyOnceWith(error);
  pump.offer(2); pump.stop(); pump.stop(); pump.offer(3);
  await vi.advanceTimersByTimeAsync(200);
  expect(apply).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
 });
});
