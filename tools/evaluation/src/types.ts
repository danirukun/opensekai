import type { AppApi, BenchmarkParams, DiagnosticMarker, Id } from '@opensekai/contracts';
export interface ObsCounters {
    renderSkippedFrames: number;
    renderTotalFrames: number;
    outputSkippedFrames: number;
    outputTotalFrames: number;
}
export interface OwnedObsScene {
    sceneName: string;
    sourceName: string;
}
export interface SmokeOptions {
    profileId: BenchmarkParams['profileId'];
    outputUrl: string;
    destinationDir: string;
    sceneName: string;
    sourceName: string;
}
export interface SmokeReport {
    runId: Id;
    appEvidenceIds: Id[];
    obsCaptureHashes: string[];
    checks: {
        name: string;
        result: 'pass' | 'fail' | 'unknown';
        detail: string;
    }[];
    counterDelta: ObsCounters | null;
    markers: DiagnosticMarker[];
}
export interface ObsAdapter {
    readVersions(): Promise<{
        obs: string;
        websocket: string;
        availableRequests: string[];
    }>;
    readVideo(): Promise<{
        width: number;
        height: number;
        fps: number;
    }>;
    readStats(): Promise<ObsCounters>;
    screenshot(sourceName: string): Promise<Uint8Array>;
    withOwnedScene<T>(options: SmokeOptions, action: (owned: OwnedObsScene) => Promise<T>): Promise<T>;
    disconnect(): Promise<void>;
}
export type SmokeCheck = SmokeReport['checks'][number];
