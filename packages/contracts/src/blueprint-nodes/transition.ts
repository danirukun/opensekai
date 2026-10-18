import { z } from 'zod';
import { EasingSchema } from '../easing';
import { finite } from './define';

export const MAX_TRANSITION_SECONDS = 600;
// Optional, so graphs saved before transitions existed keep their shape and logic key.
export const transitionSettings = {
 transitionSeconds: finite.min(0).max(MAX_TRANSITION_SECONDS).optional(),
 easing: EasingSchema.optional(),
};
export const transitionFields = [
 { key: 'transitionSeconds', label: 'Transition (s)', kind: 'number', min: 0, max: MAX_TRANSITION_SECONDS },
 { key: 'easing', label: 'Easing', kind: 'easing' },
] as const;
