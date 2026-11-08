import { z } from 'zod';

export const PROPOSAL_LIMITS = { sceneOps: 64, entities: 64, blueprints: 16 } as const;

export const ExpectationSchema = z.strictObject({ id: z.string().min(1).max(256), fingerprint: z.string().regex(/^[0-9a-f]{16}$/).nullable() });
export type Expectation = z.infer<typeof ExpectationSchema>;
