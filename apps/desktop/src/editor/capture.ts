import { CaptureSourceSchema, type AppError, type AppStatus, type CaptureSource, type CaptureState, type Id, type Reply, type ScreenCapture } from '@opensekai/contracts';
// The editor side of capture screens (B31 R6, R17). The list and the permission state come only from the host commands.
export const CAPTURE_LIST_ERRORS = ['Screen Recording permission needed', 'Capture not supported on this platform'] as const;
export const PERMISSION_NEEDED = CAPTURE_LIST_ERRORS[0];
export type CaptureListError = typeof CAPTURE_LIST_ERRORS[number];
export interface CaptureEntry { source: CaptureSource; label: string; width: number; height: number }
export interface CaptureSourceList { sources: CaptureEntry[]; error: CaptureListError | null }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const size = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;
// The capture_source_list reply (R6). An entry that fails the source rule is left out; a reply of another shape shows nothing.
export const parseSourceList = (raw: unknown): CaptureSourceList => {
    if (!record(raw) || !Array.isArray(raw.sources) || raw.sources.length > 80) return { sources: [], error: null };
    const error = CAPTURE_LIST_ERRORS.find(item => item === raw.error) ?? null;
    const sources = raw.sources.flatMap((entry): CaptureEntry[] => {
        if (!record(entry) || typeof entry.label !== 'string' || entry.label === '' || !size(entry.width) || !size(entry.height)) return [];
        const source = CaptureSourceSchema.safeParse(entry.source);
        return source.success ? [{ source: source.data, label: entry.label, width: entry.width as number, height: entry.height as number }] : [];
    });
    return { sources, error };
};
export const sameSource = (a: CaptureSource | null, b: CaptureSource | null): boolean => a !== null && b !== null && (a.kind === 'display' && b.kind === 'display' ? a.name === b.name && a.ordinal === b.ordinal : a.kind === 'window' && b.kind === 'window' && a.app === b.app && a.title === b.title);
// The saved description of a source: the display name (with the ordinal suffix of the R6 label), or `<app> — <title>`.
export const sourceDescription = (source: CaptureSource): string => source.kind === 'display'
    ? source.ordinal === 0 ? source.name : `${source.name} (${source.ordinal + 1})`
    : source.title === '' ? source.app : `${source.app} — ${source.title}`;
const sourceKey = (source: CaptureSource) => JSON.stringify(source.kind === 'display' ? [source.kind, source.name, source.ordinal] : [source.kind, source.app, source.title]);
export interface SourceOption { value: string; label: string }
// The Source select: the empty option, the listed sources of the target kind, and the saved source when the list does not have it.
export function sourceOptions(target: ScreenCapture['target'], saved: CaptureSource | null, list: readonly CaptureEntry[]): { options: SourceOption[]; value: string; missing: boolean } {
    const entries = list.filter(entry => entry.source.kind === target);
    const listed = saved !== null && entries.some(entry => sameSource(entry.source, saved));
    const missing = saved !== null && !listed;
    const options = [{ value: '', label: target === 'display' ? 'Choose display…' : 'Choose window…' }, ...entries.map(entry => ({ value: sourceKey(entry.source), label: entry.label })), ...(missing ? [{ value: sourceKey(saved), label: sourceDescription(saved) }] : [])];
    return { options, value: saved === null ? '' : sourceKey(saved), missing };
}
export const sourceForValue = (value: string, list: readonly CaptureEntry[]): CaptureSource | null => list.find(entry => sourceKey(entry.source) === value)?.source ?? null;
// The three editor-only host commands (R18). Only the Editor window has them.
export interface CaptureCommands { list(): Promise<unknown>; allow(source: CaptureSource): Promise<void>; openSettings(): Promise<void> }
export interface CapturePorts {
    allow(source: CaptureSource): Promise<void>;
    commit(capture: ScreenCapture): Promise<Reply<unknown> | undefined>;
}
// R5, R17: a chosen source is allowed in this run first, then the patch sends it. A failed allow sends no patch.
export async function chooseSource(ports: CapturePorts, current: ScreenCapture, source: CaptureSource | null): Promise<Reply<unknown> | undefined> {
    if (source !== null) await ports.allow(source);
    return ports.commit({ target: current.target, source, cursor: current.cursor });
}
// A change of Content to Display or Window starts without a source; the cursor shows by default.
export const startCapture = (target: ScreenCapture['target']): ScreenCapture => ({ target, source: null, cursor: true });
export const CAPTURE_PREFIX = 'Capture: ';
// R15: the Inspector shows the preview_main message of this screen. The host state decides the Allow button.
export function captureMessage(entityId: Id, warnings: readonly AppError[]): string | null {
    const warning = warnings.find(item => item.message.startsWith(CAPTURE_PREFIX) && item.ids.includes(entityId));
    return warning ? warning.message.slice(CAPTURE_PREFIX.length) : null;
}
export const captureState = (entityId: Id, status: Pick<AppStatus, 'captures'> | null): CaptureState | null => status?.captures?.find(entry => entry.entityId === entityId)?.state ?? null;
export const previewWarnings = (status: Pick<AppStatus, 'outputs'> | null): AppError[] => status?.outputs.find(output => output.outputId === 'preview_main')?.lastFrame?.warnings ?? [];
