// B31 R2: one text rule for capture source names and titles. `normalize_capture_text` in crates/contracts
// is the same rule; fixtures/protocol/capture-sources.json pins both. Lengths count Unicode code points.
export const CAPTURE_TEXT_LIMITS = { name: 128, app: 255, title: 512 } as const;
const isControl = (code: number) => code <= 0x1f || (code >= 0x7f && code <= 0x9f);
export const normalizeCaptureText = (value: string, max: number = CAPTURE_TEXT_LIMITS.title): string =>
    Array.from(Array.from(value, char => isControl(char.codePointAt(0)!) ? ' ' : char).join('').replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '')).slice(0, max).join('').replace(/ +$/, '');
export const captureTextLength = (value: string): number => Array.from(value).length;
export const CAPTURE_STATES = ['starting', 'idle', 'live', 'paused', 'ended', 'notAllowed', 'notFound', 'permissionNeeded', 'unsupported', 'failed'] as const;
export type CaptureState = typeof CAPTURE_STATES[number];
// B31 R15: the frame warning text of each host state that is not drawn.
export const CAPTURE_STATE_MESSAGES: Partial<Record<CaptureState, string>> = {
    notAllowed: 'Choose the source again',
    notFound: 'Source not found',
    ended: 'Source not found',
    paused: 'Source hidden',
    permissionNeeded: 'Screen Recording permission needed',
    unsupported: 'Capture not supported on this platform',
    failed: 'Capture failed'
};
