import { describe, expect, it, vi } from 'vitest';
import { createPreviewPump, type FrameScheduler } from '../src/preview-pump';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function manualScheduler() {
 let next = 1;
 const callbacks = new Map<number, () => void>();
 const scheduler: FrameScheduler = {
  request(callback) { const id = next++; callbacks.set(id, callback); return id; },
  cancel(id) { callbacks.delete(id); },
 };
 return {
  scheduler,
  pending: () => callbacks.size,
  async tick() {
   const due = [...callbacks.values()];
   callbacks.clear();
   for (const callback of due) callback();
   await settle();
  },
 };
}

describe('preview pump', () => {
 it('applies the newest frame on each display frame and never overlaps GPU work', async () => {
  const display = manualScheduler();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const apply = vi.fn().mockImplementationOnce(() => pending).mockResolvedValue(undefined);
  const pump = createPreviewPump<number>(apply, vi.fn(), display.scheduler);
  pump.offer(1); pump.offer(2);
  await display.tick();
  expect(apply.mock.calls).toEqual([[2]]);
  pump.offer(3); pump.offer(4);
  await display.tick(); await display.tick();
  expect(apply).toHaveBeenCalledTimes(1);
  release(); await settle();
  await display.tick();
  expect(apply.mock.calls).toEqual([[2], [4]]);
  pump.offer(5);
  await display.tick();
  expect(apply.mock.calls).toEqual([[2], [4], [5]]);
  pump.stop();
 });
 it('skips display frames that have no new state', async () => {
  const display = manualScheduler();
  const apply = vi.fn().mockResolvedValue(undefined);
  const pump = createPreviewPump<number>(apply, vi.fn(), display.scheduler);
  await display.tick(); await display.tick();
  expect(apply).not.toHaveBeenCalled();
  pump.offer(1);
  await display.tick(); await display.tick();
  expect(apply.mock.calls).toEqual([[1]]);
  pump.stop();
 });
 it('releases queued state on stop and reports a failed submission once', async () => {
  const display = manualScheduler();
  const error = { code: 'UNSUPPORTED', message: 'GPU failure' };
  const apply = vi.fn().mockRejectedValue(error), fail = vi.fn();
  const pump = createPreviewPump<number>(apply, fail, display.scheduler);
  pump.offer(1); await display.tick();
  expect(fail).toHaveBeenCalledExactlyOnceWith(error);
  pump.offer(2); pump.stop(); pump.stop(); pump.offer(3);
  expect(display.pending()).toBe(0);
  await display.tick();
  expect(apply).toHaveBeenCalledTimes(1);
 });
});
