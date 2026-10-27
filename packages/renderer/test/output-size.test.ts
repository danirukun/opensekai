import { expect, it } from 'vitest';
import { QUALITY_PROFILES } from '@opensekai/contracts';
import { drawingBufferSize } from '../src/renderer';

it('multiplies the output size by the render scale and the quality profile scale (B22 R5)', () => {
    const { production_v1: production, preview_v1: preview } = QUALITY_PROFILES;
    expect(drawingBufferSize({ width: 1920, height: 1080 }, production)).toEqual({ width: 1920, height: 1080 });
    expect(drawingBufferSize({ width: 1920, height: 1080 }, preview)).toEqual({ width: 960, height: 540 });
    expect(drawingBufferSize({ width: 1280, height: 720, renderScale: 0.75 }, production)).toEqual({ width: 960, height: 540 });
    expect(drawingBufferSize({ width: 1280, height: 720, renderScale: 0.75 }, preview)).toEqual({ width: 480, height: 270 });
    expect(drawingBufferSize({ width: 960, height: 540, renderScale: 0.5 }, preview)).toEqual({ width: 240, height: 135 });
    // Math.round keeps a whole pixel count; the small aspect error is accepted.
    expect(drawingBufferSize({ width: 1600, height: 900, renderScale: 0.75 }, preview)).toEqual({ width: 600, height: 338 });
});
