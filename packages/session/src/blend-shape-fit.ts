import { DEFAULT_TRACKING_MAPPING, type ArkitName, type BlendShapeRange, type TrackingMapping } from '@opensekai/contracts';

export const RISE = .05;

type Levels = Partial<Record<ArkitName, number>>;

// Each channel whose peak rose at least RISE above its neutral gets a range. A missing neutral counts as 0.
export function fitRanges(neutral: Levels, peaks: Levels): Partial<Record<ArkitName, BlendShapeRange>> {
 const fitted: Partial<Record<ArkitName, BlendShapeRange>> = {};
 for (const [name, peak] of Object.entries(peaks) as [ArkitName, number][]) {
  const rest = neutral[name] ?? 0;
  if (peak - rest < RISE) continue;
  const inputMin = Math.min(rest + .02, peak - .05);
  fitted[name] = { inputMin, inputMax: Math.min(1, Math.max(peak * .9, inputMin + .05)), outputMin: 0, outputMax: 1 };
 }
 return fitted;
}

// Keeps every field and range of the mapping and replaces only the fitted channels.
export const mergeFit = (mapping: TrackingMapping | undefined, fitted: Partial<Record<ArkitName, BlendShapeRange>>): TrackingMapping => {
 const base = structuredClone(mapping ?? DEFAULT_TRACKING_MAPPING) as TrackingMapping;
 return { ...base, blendShapes: { ...base.blendShapes, ...structuredClone(fitted) } };
};
