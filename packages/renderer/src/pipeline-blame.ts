// Gives each new pipeline failure report to the pass that most likely caused it (stage beams R15a).
export type Pass = "haze" | "beams";
const PASSES: readonly Pass[] = ["haze", "beams"];
/** three.js r187 labels a render pipeline `renderPipeline_${material.name || material.type}_${material.id}`; the beam material is named "beam". */
export const BEAM_PIPELINE_PREFIX = "renderPipeline_beam_";
/** The material id at the end of a pipeline label, or null. */
export const pipelineMaterialId = (label: string): number | null => {
    const id = /_(\d+)$/.exec(label)?.[1];
    return id === undefined ? null : Number(id);
};

interface Run { readonly last: number; readonly since: number }
export interface BlameState {
    readonly frame: number;
    readonly runs: Readonly<Record<Pass, Run>>;
    /** Pipeline labels that failed before. A repeat report of one of them is not new. */
    readonly failed: ReadonlySet<string>;
}

const never: Run = { last: -Infinity, since: -Infinity };
export const initialBlame = (): BlameState => ({ frame: 0, runs: { haze: never, beams: never }, failed: new Set() });
/** A light node-set rebuild tries each pass again, so a pipeline that fails again is new. */
export const afterRebuild = (state: BlameState): BlameState => ({ ...state, failed: new Set() });
/** New snow materials build their pipelines again, so a snow label that fails again is new. */
export const forgetLabels = (state: BlameState, matches: (label: string) => boolean): BlameState => ({ ...state, failed: new Set([...state.failed].filter(label => !matches(label))) });

/**
 * One drawn frame. `drew` is the passes that this frame drew; `reports` is the labels of the failure reports that
 * arrived since the previous frame. Returns the next state and the passes to stop. `isSnow` tells a label of a snow
 * material (the flakes, the sky pass, or a character material with a snow share): `snow` is true for a new one, and
 * no pass stops for it.
 */
export function blameFrame(state: BlameState, drew: Readonly<Record<Pass, boolean>>, reports: readonly (string | null)[], isSnow?: (label: string) => boolean): { state: BlameState; stop: Pass[]; snow: boolean } {
    const frame = state.frame + 1;
    const runs = Object.fromEntries(PASSES.map(pass => {
        const run = state.runs[pass];
        return [pass, drew[pass] ? { last: frame, since: run.last === frame - 1 ? run.since : frame } : run];
    })) as Record<Pass, Run>;
    // The watcher reports a frame or more after the failing frame, so the frame before also counts.
    const recent = PASSES.filter(pass => runs[pass].last >= frame - 1);
    const newest = Math.max(...recent.map(pass => runs[pass].since));
    const failed = new Set(state.failed);
    const stop = new Set<Pass>();
    let snow = false;
    for (const label of reports) {
        if (label !== null && failed.has(label)) continue;
        if (label !== null) failed.add(label);
        if (label?.startsWith(BEAM_PIPELINE_PREFIX)) stop.add("beams");
        else if (label !== null && isSnow?.(label)) snow = true;
        else for (const pass of recent) if (runs[pass].since === newest) stop.add(pass);
    }
    return { state: { frame, runs, failed }, stop: PASSES.filter(pass => stop.has(pass)), snow };
}
