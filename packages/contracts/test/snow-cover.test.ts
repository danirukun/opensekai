import { expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/snow-cover.json';
import frame from '../../../fixtures/protocol/valid-frame.json';
import { RuntimeFrameSchema } from '../src/index';
// Snow cover R5: the same vectors as crates/contracts/tests/snow_cover.rs.
it.each(vectors.valid)('accepts the snow cover vector $name', ({ snow }) => {
    expect(RuntimeFrameSchema.safeParse({ ...frame, snow }).success).toBe(true);
});
it.each(vectors.invalid)('rejects the snow cover vector $name', ({ snow }) => {
    expect(RuntimeFrameSchema.safeParse({ ...frame, snow }).success).toBe(false);
});
