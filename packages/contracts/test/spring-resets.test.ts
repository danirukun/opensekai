import { expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/spring-resets.json';
import frame from '../../../fixtures/protocol/valid-frame.json';
import { RuntimeFrameSchema } from '../src/index';
// B43 R1: the same vectors as crates/contracts/tests/spring_resets.rs.
it.each(vectors.valid)('accepts the spring reset vector $name', ({ springResets }) => {
    expect(RuntimeFrameSchema.safeParse({ ...frame, springResets }).success).toBe(true);
});
it.each(vectors.invalid)('rejects the spring reset vector $name', ({ springResets }) => {
    expect(RuntimeFrameSchema.safeParse({ ...frame, springResets }).success).toBe(false);
});
