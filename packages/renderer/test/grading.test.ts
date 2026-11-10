import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_CAMERA_GRADING, QUALITY_PROFILES, makeSmokeFrame, type CameraGrading, type RuntimeFrame } from '@opensekai/contracts';
const ports = vi.hoisted(() => ({ chain: { render: vi.fn(), dispose: vi.fn() }, shot: vi.fn() }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgl2', renderer: { shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: vi.fn(), compileAsync: vi.fn(), dispose: vi.fn() } }) }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({ texture: null, dispose() {} }) }));
vi.mock('../src/screenshot', async original => ({ ...await original<typeof import('../src/screenshot')>(), renderScreenshot: ports.shot }));
vi.mock('../src/post-chain', async original => ({ ...await original<typeof import('../src/post-chain')>(), createPostChain: () => ports.chain }));
import { createRenderer } from '../src/renderer';
import { chainKey, needsChain } from '../src/post-chain';
import { CONTRAST_PIVOT, acesFilmic, bloomCompositePixel, bloomInputPixel, contrast, gradeColor, gradePixel, neutral, tintLinear, vibrance, type Rgb } from '../src/grading-math';

const graded = (change: Partial<CameraGrading>): CameraGrading => ({ ...DEFAULT_CAMERA_GRADING, ...change });
const close = (actual: readonly number[], expected: readonly number[], digits = 6) => actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], digits));
const sample: Rgb = [0.08, 0.34, 0.5];

describe('grading reference', () => {
    it('changes no color at the defaults', () => {
        close(gradeColor(sample, DEFAULT_CAMERA_GRADING), sample, 12);
        // A channel of 0 takes the contrast floor: 0.18 · 10⁻⁶, far below one step of 8-bit color.
        close(gradeColor([0.7, 0, 0.18], DEFAULT_CAMERA_GRADING), [0.7, 0, 0.18], 6);
    });
    it('reads exposure in stops', () => {
        close(gradeColor(sample, graded({ exposure: 1 })), sample.map(x => x * 2));
        close(gradeColor(sample, graded({ exposure: -2 })), sample.map(x => x / 4));
    });
    it('multiplies by 1 + brightness', () => {
        close(gradeColor(sample, graded({ brightness: -0.5 })), sample.map(x => x * 0.5));
        close(gradeColor(sample, graded({ brightness: -1 })), [0, 0, 0]);
    });
    it('keeps middle gray under contrast and moves the other values away from it or toward it', () => {
        close(contrast([CONTRAST_PIVOT, CONTRAST_PIVOT, CONTRAST_PIVOT], 0.7), [CONTRAST_PIVOT, CONTRAST_PIVOT, CONTRAST_PIVOT]);
        const more = contrast([0.09, 0.18, 0.36], 1), less = contrast([0.09, 0.18, 0.36], -0.5);
        close(more, [0.045, 0.18, 0.72]);
        close(less, [0.18 * Math.SQRT1_2, 0.18, 0.18 * Math.SQRT2]);
        close(contrast([0.09, 0.5, 2], -1), [CONTRAST_PIVOT, CONTRAST_PIVOT, CONTRAST_PIVOT]);
        close(contrast([-0.2, 0, 0], 0.5), [0, 0, 0]);
        // A zero channel at contrast -1 has the power 0: the result is the pivot, not NaN.
        close(contrast([1, 0, 0], -1), [CONTRAST_PIVOT, CONTRAST_PIVOT, CONTRAST_PIVOT]);
        close(gradeColor([1, 0, 0], graded({ contrast: -1 })), [CONTRAST_PIVOT, CONTRAST_PIVOT, CONTRAST_PIVOT]);
    });
    it('leaves a gray unchanged under vibrance and removes the saturation at -1', () => {
        close(vibrance([0.4, 0.4, 0.4], 1), [0.4, 0.4, 0.4]);
        const flat = vibrance([0.2, 0.5, 0.8], -1);
        // Each channel moves toward the brightest channel by 3 · (peak − average) = 0.9 of the way.
        close(flat, [0.2 + 0.6 * 0.9, 0.5 + 0.3 * 0.9, 0.8]);
        expect(vibrance([0.2, 0.5, 0.8], 1)[0]).toBe(0);
    });
    it('multiplies by the tint as a linear color', () => {
        close(tintLinear('#ffffff'), [1, 1, 1]);
        close(tintLinear('#000000'), [0, 0, 0]);
        expect(tintLinear('#808080')[0]).toBeCloseTo(0.2158605, 6);
        close(gradeColor([0.5, 0.5, 0.5], graded({ tint: '#ff0000' })), [0.5, 0, 0]);
    });
    it('gives the three.js ACES and Neutral curves at known points', () => {
        close(acesFilmic([0, 0, 0], 1), [0, 0, 0]);
        // A middle gray stays near 0.12 to 0.13 after the 1 / 0.6 input scale; a very bright value clamps at 1.
        const gray = acesFilmic([0.18, 0.18, 0.18], 1);
        expect(gray[0]).toBeGreaterThan(0.1); expect(gray[0]).toBeLessThan(0.3);
        expect(Math.abs(gray[0] - gray[2])).toBeLessThan(0.01);
        close(acesFilmic([100, 100, 100], 1), [1, 1, 1]);
        // Neutral: the identity minus the 0.04 offset below the compression start.
        close(neutral([0.5, 0.4, 0.3], 1), [0.46, 0.36, 0.26]);
        const bright = neutral([4, 4, 4], 1);
        expect(bright[0]).toBeGreaterThan(0.9); expect(bright[0]).toBeLessThan(1);
        expect(neutral([1, 0.2, 0.2], 2)[0]).toBeLessThan(1);
    });
    it('applies exposure, curve, brightness, contrast, vibrance, and tint in that order', () => {
        const grading = graded({ toneMapping: 'neutral', exposure: 1, brightness: 0.2, contrast: 0.3, vibrance: -0.4, tint: '#808080' });
        const tint = tintLinear('#808080');
        const expected = vibrance(contrast(neutral(sample, 2).map(x => x * 1.2) as unknown as Rgb, 0.3), -0.4).map((x, i) => x * tint[i]);
        close(gradeColor(sample, grading), expected, 12);
    });
    it('gives a color from 0 to 1, so a graded edge pixel has no channel above its alpha', () => {
        close(gradeColor([0.8, 0.5, 0.1], graded({ exposure: 4 })), [1, 1, 1]);
        close(gradeColor([0.8, 0.5, 0.1], graded({ brightness: 1 })), [1, 1, 0.2]);
        const edge = gradePixel([0.4, 0.25, 0.05, 0.5], graded({ exposure: 2 }));
        for (const channel of edge.slice(0, 3)) expect(channel).toBeLessThanOrEqual(edge[3]);
        close(edge, [0.5, 0.5, 0.2, 0.5]);
    });
    it('grades the color of a premultiplied pixel and keeps its alpha', () => {
        const pixel = gradePixel([0.2, 0.1, 0.05, 0.5], graded({ exposure: 1 }));
        close(pixel, [0.4, 0.2, 0.1, 0.5]);
        expect(gradePixel([0, 0, 0, 0], graded({ exposure: 4, toneMapping: 'neutral' }))).toEqual([0, 0, 0, 0]);
        expect(gradePixel([0.3, 0.3, 0.3, 0], graded({ brightness: 1 }))).toEqual([0, 0, 0, 0]);
    });
    it('takes only the luminance above the threshold into the bloom', () => {
        const white: Rgb = [1, 1, 1];
        close(bloomInputPixel(white, 0), white);
        close(bloomInputPixel(white, 0.76), [0.24, 0.24, 0.24]);
        close(bloomInputPixel(white, 1), [0, 0, 0]);
        close(bloomInputPixel([4, 4, 4], 1), [3, 3, 3]);
        close(bloomInputPixel([0.5, 0.5, 0.5], 0.8), [0, 0, 0]);
        close(bloomInputPixel([0, 0, 0], 0), [0, 0, 0]);
        // The color stays: a red light at luminance 0.4252 with the threshold 0.2126 gives half of itself.
        close(bloomInputPixel([2, 0, 0], 0.2126), [1, 0, 0]);
    });
    it('turns the brightest bloom channel into coverage', () => {
        close(bloomCompositePixel([0, 0, 0, 0], [0.1, 0.4, 0.2]), [0.1, 0.4, 0.2, 0.4]);
        close(bloomCompositePixel([0.2, 0.2, 0.2, 0.5], [0.1, 0.4, 0.2]), [0.3, 0.6, 0.4, 0.7]);
        close(bloomCompositePixel([0.5, 0.5, 0.5, 1], [3, 0, 0]), [3.5, 0.5, 0.5, 1]);
        close(bloomCompositePixel([0, 0, 0, 0], [2, 2, 2]), [2, 2, 2, 1]);
        close(bloomCompositePixel([0, 0, 0, 0], [0, 0, 0]), [0, 0, 0, 0]);
    });
});

describe('post chain plan', () => {
    it('needs no chain for a missing or neutral grading', () => {
        expect(needsChain('none', false)).toBe(false);
        expect(needsChain('none', false, null)).toBe(false);
        expect(needsChain('none', false, DEFAULT_CAMERA_GRADING)).toBe(false);
        expect(needsChain('none', false, graded({ bloom: { intensity: 0, threshold: 0.1, radius: 1 } }))).toBe(false);
        expect(needsChain('none', false, graded({ exposure: 0.5 }))).toBe(true);
        expect(needsChain('none', false, graded({ bloom: { intensity: 0.5, threshold: 0.8, radius: 0.4 } }))).toBe(true);
    });
    it('keeps the chain key while only numbers change', () => {
        const key = chainKey('none', false, graded({ exposure: 0.5 }));
        expect(chainKey('none', false, graded({ exposure: -3, contrast: 1, tint: '#102030' }))).toBe(key);
        expect(chainKey('fxaa', false, graded({ exposure: 0.5 }))).not.toBe(key);
        expect(chainKey('none', true, graded({ exposure: 0.5 }))).not.toBe(key);
        expect(chainKey('none', false, graded({ toneMapping: 'aces' }))).not.toBe(key);
        expect(chainKey('none', false, graded({ exposure: 0.5, bloom: { intensity: 1, threshold: 0.8, radius: 0.4 } }))).not.toBe(key);
        expect(chainKey('none', false, graded({ exposure: 0.5, bloom: { intensity: 3, threshold: 0.2, radius: 0.9 } }))).toBe(chainKey('none', false, graded({ bloom: { intensity: 1, threshold: 0.8, radius: 0.4 } })));
        expect(chainKey('none', false, DEFAULT_CAMERA_GRADING)).toBe(chainKey('none', false));
    });
});

describe('renderer', () => {
    let sequence = 0;
    const frame = (grading?: CameraGrading): RuntimeFrame => {
        const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
        f.scene.entities = f.scene.entities.filter(e => e.kind === 'camera');
        const cameraId = f.scene.outputs.find(o => o.id === 'output_main')!.cameraId;
        for (const e of f.scene.entities) if (e.kind === 'camera') { if (e.id === cameraId) { if (grading) e.grading = grading; } else e.grading = graded({ toneMapping: 'aces' }); }
        return f;
    };
    beforeEach(() => { ports.chain.render.mockReset().mockResolvedValue(undefined); ports.chain.dispose.mockReset(); });
    it('draws with the grading of the output camera only', async () => {
        const renderer = await createRenderer({ canvas: { width: 0, height: 0 } as HTMLCanvasElement, outputId: 'output_main', mode: 'force-webgl2', resources: { readAsset: vi.fn() }, diagnostics: false, quality: QUALITY_PROFILES.production_v1 });
        await renderer.applyFrame(frame());
        expect(ports.chain.render.mock.lastCall![4]).toBeNull();
        const grading = graded({ exposure: 1, bloom: { intensity: 1, threshold: 0.76, radius: 0.4 } });
        await renderer.applyFrame(frame(grading));
        expect(ports.chain.render.mock.lastCall![4]).toEqual(grading);
        renderer.dispose();
    });
    it('gives the grading of the screenshot camera to the screenshot (R12)', async () => {
        ports.shot.mockReset().mockResolvedValue(new Uint8Array([1]));
        const renderer = await createRenderer({ canvas: { width: 0, height: 0 } as HTMLCanvasElement, outputId: 'output_main', mode: 'force-webgl2', resources: { readAsset: vi.fn() }, diagnostics: false, quality: QUALITY_PROFILES.production_v1 });
        const grading = graded({ exposure: 1 });
        const shown = frame(grading);
        const output = shown.scene.outputs.find(o => o.id === 'output_main')!.cameraId;
        const other = shown.scene.entities.find(e => e.kind === 'camera' && e.id !== output)!.id;
        await renderer.applyFrame(shown);
        await renderer.screenshot(output, shown.scene.revision);
        expect(ports.shot.mock.lastCall![0].grading).toEqual(grading);
        // Another camera gives its own grading, not the grading of the output camera.
        await renderer.screenshot(other, shown.scene.revision);
        expect(ports.shot.mock.lastCall![0].grading).toEqual(graded({ toneMapping: 'aces' }));
        renderer.dispose();
    });
});
