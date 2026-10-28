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
 it('applies nothing while disabled and applies only the newest frame when enabled again', async () => {
  const display = manualScheduler();
  const apply = vi.fn().mockResolvedValue(undefined);
  const pump = createPreviewPump<number>(apply, vi.fn(), display.scheduler);
  pump.setEnabled(false);
  pump.offer(1); await display.tick();
  pump.offer(2); pump.offer(3); await display.tick();
  expect(apply).not.toHaveBeenCalled();
  pump.setEnabled(true);
  await display.tick(); await display.tick();
  expect(apply.mock.calls).toEqual([[3]]);
  pump.stop();
 });
 it('applies frames while a wake hold is open and stops after its release', async () => {
  const display = manualScheduler();
  const apply = vi.fn().mockResolvedValue(undefined);
  const pump = createPreviewPump<number>(apply, vi.fn(), display.scheduler);
  pump.setEnabled(false);
  pump.offer(1);
  const release = pump.wake();
  await display.tick();
  pump.offer(2); await display.tick();
  expect(apply.mock.calls).toEqual([[1], [2]]);
  release();
  pump.offer(3); await display.tick();
  expect(apply.mock.calls).toEqual([[1], [2]]);
  pump.setEnabled(true); await display.tick();
  expect(apply.mock.calls).toEqual([[1], [2], [3]]);
  pump.stop();
 });
 it('ignores a second release of the same wake hold', async () => {
  const display = manualScheduler();
  const apply = vi.fn().mockResolvedValue(undefined);
  const pump = createPreviewPump<number>(apply, vi.fn(), display.scheduler);
  pump.setEnabled(false);
  const first = pump.wake(), second = pump.wake();
  first(); first();
  pump.offer(1); await display.tick();
  expect(apply.mock.calls).toEqual([[1]]);
  second(); second();
  pump.offer(2); await display.tick();
  pump.offer(3); await display.tick();
  expect(apply.mock.calls).toEqual([[1]]);
  const third = pump.wake();
  await display.tick();
  expect(apply.mock.calls).toEqual([[1], [3]]);
  third();
  pump.stop();
 });
 it('never starts a second application while one is in flight, for any order of enable and wake', async () => {
  const display = manualScheduler();
  let finish!: () => void;
  const apply = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  const pump = createPreviewPump<number>(apply, vi.fn(), display.scheduler);
  pump.offer(1); await display.tick();
  pump.setEnabled(false);
  const release = pump.wake();
  pump.offer(2); await display.tick();
  pump.setEnabled(true); release(); pump.setEnabled(false);
  const again = pump.wake(); pump.setEnabled(true);
  pump.offer(3); await display.tick(); await display.tick();
  expect(apply.mock.calls).toEqual([[1]]);
  finish(); await settle();
  again(); pump.setEnabled(false); pump.setEnabled(true);
  await display.tick();
  expect(apply.mock.calls).toEqual([[1], [3]]);
  pump.stop();
 });
 it('stops everything on stop, also with a wake hold open', async () => {
  const display = manualScheduler();
  const apply = vi.fn().mockResolvedValue(undefined);
  const pump = createPreviewPump<number>(apply, vi.fn(), display.scheduler);
  pump.setEnabled(false);
  const release = pump.wake();
  pump.offer(1); pump.stop();
  pump.setEnabled(true); pump.offer(2); release();
  expect(display.pending()).toBe(0);
  await display.tick();
  expect(apply).not.toHaveBeenCalled();
 });
});
