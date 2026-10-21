import { describe, expect, it } from 'vitest';
import { makeSmokeScene, type FpsCounterSettings, type SceneView } from '@opensekai/contracts';
import { EMPTY_METER, counterView, createFpsCounterOverlay, readFps, recordFrame } from '../src/fps-counter';

const settings = (patch: Partial<FpsCounterSettings> = {}): FpsCounterSettings => ({ corner: 'topRight', size: 32, color: '#ffffff', ...patch });
const scene = (counter: { visible?: boolean; settings?: FpsCounterSettings } | null): SceneView => {
    const view = makeSmokeScene();
    if (counter) view.entities.push({ id: 'fps', name: 'FPS Counter', visible: counter.visible ?? true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'fpsCounter', fpsCounter: counter.settings ?? settings() });
    return view;
};
const frames = (from: number, count: number, step: number) => Array.from({ length: count }, (_, i) => from + i * step).reduce(recordFrame, EMPTY_METER);

describe('FPS meter (B19 R8)', () => {
    it('is unknown until one full window has passed since the first frame', () => {
        const meter = frames(0, 60, 16);
        expect(readFps(EMPTY_METER, 5000)).toBeNull();
        expect(readFps(meter, 999)).toBeNull();
        expect(readFps(meter, 1000)).not.toBeNull();
    });
    it('counts the frames of the last 1000 ms and drops older ones', () => {
        const meter = frames(0, 120, 1000 / 60);
        expect(readFps(meter, 1990)).toBe(60);
        expect(meter.times.length).toBeLessThanOrEqual(61);
        expect(readFps(frames(0, 31, 1000 / 30), 1000)).toBe(30);
    });
    it('reads 0 after a stall of one full window without a frame', () => {
        const meter = frames(0, 60, 16);
        expect(readFps(meter, 1500)).toBeGreaterThan(0);
        expect(readFps(meter, 2000)).toBe(0);
    });
});

describe('counter view (B19 R9)', () => {
    it('scales the size to a 1080-pixel output', () => {
        expect(counterView(settings(), 60, 1080)).toEqual({ text: '60 FPS', corner: 'topRight', fontPx: 32, marginPx: 16, color: '#ffffff' });
        expect(counterView(settings({ size: 33 }), null, 540)).toMatchObject({ text: '-- FPS', fontPx: 17, marginPx: 8 });
        expect(counterView(settings(), 0, 1080).text).toBe('0 FPS');
    });
});

function harness(height = 1080) {
    let time = 0; const timers = new Map<number, () => void>(); let nextTimer = 1; const children: FakeElement[] = [];
    type FakeElement = { textContent: string | null; style: Record<string, string>; attributes: Record<string, string>; removed: boolean; setAttribute(name: string, value: string): void; remove(): void };
    const host = {
        appendChild: (child: FakeElement) => children.push(child),
        ownerDocument: { createElement: (): FakeElement => { const element: FakeElement = { textContent: null, style: {}, attributes: {}, removed: false, setAttribute(name, value) { element.attributes[name] = value; }, remove() { element.removed = true; } }; return element; } },
    };
    const overlay = createFpsCounterOverlay({ host: host as unknown as HTMLElement, canvas: { clientHeight: height }, now: () => time, setInterval: run => { timers.set(nextTimer, run); return nextTimer++; }, clearInterval: handle => timers.delete(handle as number) });
    return {
        overlay, children, timers,
        advance(ms: number, frame?: SceneView, step = 1000 / 60) {
            const end = time + ms;
            for (let next = time + step; next <= end + 1e-9; next += step) { time = next; if (frame) overlay.frameApplied(frame); }
            time = end;
        },
        tick() { for (const run of timers.values()) run(); },
        live: () => children.filter(child => !child.removed),
    };
}

describe('FPS counter overlay (B19 R7, R8, R9, R11)', () => {
    it('adds nothing and runs no timer without a visible counter', () => {
        const h = harness();
        h.overlay.frameApplied(scene(null));
        h.overlay.frameApplied(scene({ visible: false }));
        expect(h.children).toEqual([]);
        expect(h.timers.size).toBe(0);
    });
    it('shows -- FPS first, then the value, in the set corner with aria-hidden', () => {
        const h = harness();
        const view = scene({ settings: settings({ corner: 'bottomLeft', color: '#00ff00' }) });
        h.overlay.frameApplied(view);
        const [element] = h.live();
        expect(element.textContent).toBe('-- FPS');
        expect(element.attributes['aria-hidden']).toBe('true');
        expect(element.style).toMatchObject({ position: 'absolute', bottom: '16px', left: '16px', top: '', right: '', color: '#00ff00', pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' });
        expect(element.style.fontSize).toBe('32px');
        h.advance(1000, view); h.tick();
        expect(element.textContent).toBe('60 FPS');
        expect(h.timers.size).toBe(1);
    });
    it('updates the text from the timer only, and the style when the settings change', () => {
        const h = harness(540);
        const view = scene({});
        h.overlay.frameApplied(view);
        h.advance(1200, view);
        const [element] = h.live();
        expect(element.textContent).toBe('-- FPS');
        h.tick();
        expect(element.textContent).toBe('60 FPS');
        h.overlay.frameApplied(scene({ settings: settings({ corner: 'topLeft', size: 64 }) }));
        expect(element.style).toMatchObject({ top: '16px', left: '16px', right: '', bottom: '' });
        expect(element.style.fontSize).toBe('32px');
        expect(element.style.fontVariantNumeric).toBe('tabular-nums');
    });
    it('shows 0 FPS after a stall, from the timer without a frame', () => {
        const h = harness();
        const view = scene({});
        h.overlay.frameApplied(view);
        h.advance(1000, view);
        h.advance(1000);
        h.tick();
        expect(h.live()[0].textContent).toBe('0 FPS');
    });
    it('removes the element, stops the timer, and starts a new window after the counter is hidden', () => {
        const h = harness();
        const view = scene({});
        h.overlay.frameApplied(view);
        h.advance(1500, view);
        h.overlay.frameApplied(scene({ visible: false }));
        expect(h.live()).toEqual([]);
        expect(h.timers.size).toBe(0);
        h.overlay.frameApplied(view);
        h.advance(500, view); h.tick();
        expect(h.live()[0].textContent).toBe('-- FPS');
        h.overlay.dispose();
        expect(h.live()).toEqual([]);
        expect(h.timers.size).toBe(0);
    });
});
