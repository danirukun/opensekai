import { describe, expect, it } from 'vitest';
import { afterRebuild, blameFrame, forgetLabels, initialBlame, pipelineMaterialId, type BlameState, type Pass } from '../src/pipeline-blame';

type Step = { haze?: boolean; beams?: boolean; reports?: (string | null)[] };
// Runs the frames in order and returns the passes stopped in each one.
const run = (steps: Step[], start: BlameState = initialBlame()) => {
    let state = start;
    const stops: Pass[][] = [];
    for (const { haze = false, beams = false, reports = [] } of steps) {
        const next = blameFrame(state, { haze, beams }, reports);
        state = next.state;
        stops.push(next.stop);
    }
    return { stops, state };
};
const composite = 'renderPipeline_NodeMaterial_12';

describe('pipeline failure blame (stage beams R15a)', () => {
    it('does not stop a beam for a failure that arrived before the beam drew', () => {
        const { stops } = run([{ reports: ['renderPipeline_MToonNodeMaterial_4'] }, {}, { beams: true }, { beams: true }]);
        expect(stops).toEqual([[], [], [], []]);
    });
    it('stops only the beams when a beam starts while a haze draws without failure', () => {
        const { stops } = run([{ haze: true }, { haze: true }, { haze: true, beams: true }, { haze: true, beams: true, reports: [composite] }]);
        expect(stops.at(-1)).toEqual(['beams']);
    });
    it('stops only the beams for a beam material label, also when the haze started later', () => {
        const { stops } = run([{ beams: true }, { haze: true, beams: true, reports: ['renderPipeline_beam_31'] }]);
        expect(stops.at(-1)).toEqual(['beams']);
    });
    it('stops the haze when only the haze draws (B13 R9)', () => {
        const { stops } = run([{ haze: true }, { haze: true, reports: [null] }]);
        expect(stops.at(-1)).toEqual(['haze']);
    });
    it('stops the haze when the haze starts while beams draw', () => {
        const { stops } = run([{ beams: true }, { haze: true, beams: true }, { haze: true, beams: true, reports: [composite] }]);
        expect(stops.at(-1)).toEqual(['haze']);
    });
    it('stops both when both started in the same frame', () => {
        const { stops } = run([{ haze: true, beams: true }, { haze: true, beams: true, reports: [composite] }]);
        expect(stops.at(-1)).toEqual(['haze', 'beams']);
    });
    it('gives a late report to a pass that drew in the frame before', () => {
        const { stops } = run([{ beams: true }, { reports: [composite] }]);
        expect(stops.at(-1)).toEqual(['beams']);
        expect(run([{ beams: true }, {}, { reports: [composite] }]).stops.at(-1)).toEqual([]);
    });
    it('ignores a repeat report of a failed label until a rebuild', () => {
        const first = run([{ beams: true, reports: [composite] }]);
        expect(first.stops).toEqual([['beams']]);
        expect(run([{ beams: true, reports: [composite] }], first.state).stops).toEqual([[]]);
        expect(run([{ beams: true, reports: [composite] }], afterRebuild(first.state)).stops).toEqual([['beams']]);
    });
});
describe('snow pipeline blame', () => {
    const isSnow = (label: string) => pipelineMaterialId(label) === 7;
    it('reads the material id at the end of a pipeline label', () => {
        expect(pipelineMaterialId('renderPipeline_snow-flakes_7')).toBe(7);
        expect(pipelineMaterialId('renderPipeline_Body_Mat_123')).toBe(123);
        expect(pipelineMaterialId('renderPipeline_beam')).toBeNull();
    });
    it('gives a snow material label to the snow and not to the haze or the beams', () => {
        const state = blameFrame(initialBlame(), { haze: true, beams: true }, []).state;
        const next = blameFrame(state, { haze: true, beams: true }, ['renderPipeline_snow-flakes_7', 'renderPipeline_Body_7'], isSnow);
        expect(next.stop).toEqual([]);
        expect(next.snow).toBe(true);
    });
    it('keeps the haze rule for a label that is not a snow label, and reports no snow without the test', () => {
        const state = blameFrame(initialBlame(), { haze: true, beams: false }, []).state;
        const next = blameFrame(state, { haze: true, beams: false }, ['renderPipeline_Body_8'], isSnow);
        expect(next.stop).toEqual(['haze']); expect(next.snow).toBe(false);
        expect(blameFrame(state, { haze: true, beams: false }, ['renderPipeline_Body_7']).snow).toBe(false);
    });
    it('takes a snow label as new again after the snow materials changed', () => {
        const first = blameFrame(initialBlame(), { haze: false, beams: false }, ['renderPipeline_Body_7'], isSnow);
        expect(first.snow).toBe(true);
        expect(blameFrame(first.state, { haze: false, beams: false }, ['renderPipeline_Body_7'], isSnow).snow).toBe(false);
        expect(blameFrame(forgetLabels(first.state, isSnow), { haze: false, beams: false }, ['renderPipeline_Body_7'], isSnow).snow).toBe(true);
    });
});

