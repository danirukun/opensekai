import { tagId } from '@opensekai/contracts';
import type { CaptureRecord, DiagnosticMarker, EvidenceManifest } from '@opensekai/contracts';
import type { ObsCounters, SmokeCheck } from './types';
export function evaluationError(code: import('@opensekai/contracts').ErrorCode, message: string): Error & {
    code: import('@opensekai/contracts').ErrorCode;
} {
    return Object.assign(new Error(message), {
        code
    });
}
export function counterDelta(before: ObsCounters, after: ObsCounters): ObsCounters | null {
    const result = {} as ObsCounters;
    for (const key of Object.keys(before) as (keyof ObsCounters)[]) {
        if (!Number.isSafeInteger(before[key]) || !Number.isSafeInteger(after[key]) || before[key] < 0 || after[key] < before[key])
            return null;
        result[key] = after[key] - before[key];
    }
    return result;
}
export function correlateMarker(marker: DiagnosticMarker, expected: {
    sessionId: string;
    cameraId: string;
    revision: number;
    tick: number;
    sequence: number;
}, elapsedMs: number): SmokeCheck {
    const tickDelta = marker.tick - expected.tick, sequenceDelta = marker.sequence - expected.sequence;
    const matches = marker.sessionTag === tagId(expected.sessionId) && marker.cameraTag === tagId(expected.cameraId) && marker.revision === expected.revision && tickDelta >= 0 && tickDelta <= 30 && sequenceDelta >= 0 && sequenceDelta <= 30 && elapsedMs >= 0 && elapsedMs <= 500;
    return {
        name: 'marker-correlation', result: matches ? 'pass' : 'fail', detail: matches ? 'Session, camera, revision and bounded tick match' : 'Source marker is unrelated, stale or outside 500 ms'
    };
}
export function verifyCaptureEvidence(capture: Pick<CaptureRecord, 'id' | 'resourceUri' | 'sha256' | 'bytes'>, manifest: Pick<EvidenceManifest, 'id' | 'kind' | 'sessionId' | 'fixtureId' | 'resources'>, sessionId: string): SmokeCheck {
    const uri = `opensekai://evidence/${capture.id}/capture.png`;
    const record = manifest.resources.find(resource => resource.uri === uri);
    const valid = /^[A-Za-z0-9_-]+$/.test(capture.id) && manifest.id === capture.id && manifest.kind === 'capture' && manifest.sessionId === sessionId && manifest.fixtureId === 'smoke_v1' && capture.resourceUri === uri && record?.mimeType === 'image/png' && record.sha256 === capture.sha256 && record.bytes === capture.bytes && /^[a-f0-9]{64}$/.test(capture.sha256) && capture.bytes > 0 && capture.bytes <= 2 * 1024 * 1024;
    return {
        name: 'capture-evidence', result: valid ? 'pass' : 'fail', detail: valid ? 'Registered capture identity and hash match' : 'Capture evidence identity or hash mismatch'
    };
}
export function skippedFrameCheck(delta: ObsCounters | null): SmokeCheck {
    if (!delta || delta.renderTotalFrames <= 0)
        return {
            name: 'obs-render-skips', result: 'unknown', detail: 'Counter reset or no measured render frames'
        };
    return {
        name: 'obs-render-skips', result: delta.renderSkippedFrames / delta.renderTotalFrames < 0.001 ? 'pass' : 'fail', detail: `${delta.renderSkippedFrames}/${delta.renderTotalFrames} render frames skipped`
    };
}
export function sanitizedFailure(error: unknown): {
    error: string;
} {
    const code = (error as {
        code?: unknown;
    })?.code;
    const allowed = ['INVALID_INPUT', 'CONFLICT', 'FORBIDDEN', 'UNAVAILABLE', 'NOT_FOUND', 'UNSUPPORTED', 'TIMEOUT', 'RATE_LIMITED', 'BUSY', 'CANCELLED', 'VERSION_MISMATCH', 'STALE_FRAME'];
    return {
        error: typeof code === 'string' && allowed.includes(code) ? code : 'UNAVAILABLE'
    };
}
