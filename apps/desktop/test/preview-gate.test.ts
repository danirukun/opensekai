import { describe, expect, it, vi } from 'vitest';
import { createPreviewPump, type FrameScheduler } from '../src/preview-pump';
import { previewActive } from '../src/editor/preview-gate';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function manualScheduler() {
 let next = 1;
 const callbacks = new Map<number, () => void>();
 const scheduler: FrameScheduler = { request(callback) { const id = next++; callbacks.set(id, callback); return id; }, cancel(id) { callbacks.delete(id); } };
 return { scheduler, async tick() { const due = [...callbacks.values()]; callbacks.clear(); for (const callback of due) callback(); await settle(); } };
}

describe('preview gate', () => {
 it('is active only with the toggle on and the Assets tab shown', () => {
  expect(previewActive({ toggleOn: true, assetsShown: true })).toBe(true);
  expect(previewActive({ toggleOn: true, assetsShown: false })).toBe(false);
  expect(previewActive({ toggleOn: false, assetsShown: true })).toBe(false);
  expect(previewActive({ toggleOn: false, assetsShown: false })).toBe(false);
 });
 it('a wake hold applies frames while the gate is closed', async () => {
  const display = manualScheduler();
  const apply = vi.fn().mockResolvedValue(undefined);
  const pump = createPreviewPump<number>(apply, vi.fn(), display.scheduler);
  pump.setEnabled(previewActive({ toggleOn: true, assetsShown: false }));
  pump.offer(1); await display.tick();
  expect(apply).not.toHaveBeenCalled();
  const release = pump.wake(); await display.tick();
  expect(apply.mock.calls).toEqual([[1]]);
  release(); pump.offer(2); await display.tick();
  expect(apply).toHaveBeenCalledTimes(1);
  pump.stop();
 });
 it('a tab change back to Assets applies the newest frame on the next display frame', async () => {
  const display = manualScheduler();
  const apply = vi.fn().mockResolvedValue(undefined);
  const pump = createPreviewPump<string>(apply, vi.fn(), display.scheduler);
  pump.setEnabled(previewActive({ toggleOn: true, assetsShown: false }));
  pump.offer('A'); pump.offer('B'); await display.tick();
  expect(apply).not.toHaveBeenCalled();
  pump.setEnabled(previewActive({ toggleOn: true, assetsShown: true })); await display.tick();
  expect(apply.mock.calls).toEqual([['B']]);
  pump.stop();
 });
});
