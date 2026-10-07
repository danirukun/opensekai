import { expect, it } from 'vitest';
import { makeSmokeScene } from '../src/fixtures';
import { ShowDocumentSchema } from '../src/show';
import { requiredCapability, validateCall } from '../src/schema';

const graph = () => ({ schemaVersion: 1, id: 'graph', name: 'Cue', nodes: [
 { id: 'start', version: 1, type: 'event.manual', settings: {}, position: { x: 0, y: 0 } },
], connections: [] });
const show = () => ({ schemaVersion: 1, name: 'Concert', scene: makeSmokeScene(), blueprints: [graph()] });

it('accepts a show with one graph and missing asset references', () => {
 const input = show();
 const performer = input.scene.entities.find(entity => entity.id === 'performer');
 if (performer?.kind !== 'avatar') throw new Error('Fixture changed');
 performer.assetId = 'missing_library_asset';
 expect(ShowDocumentSchema.safeParse(input).success).toBe(true);
});

it('rejects extra graphs, unsupported versions and invalid output cameras', () => {
 expect(ShowDocumentSchema.safeParse({ ...show(), blueprints: [graph(), { ...graph(), id: 'two' }] }).success).toBe(false);
 expect(ShowDocumentSchema.safeParse({ ...show(), schemaVersion: 2 }).success).toBe(false);
 const invalid = show();
 invalid.scene.outputs[0]!.cameraId = 'missing_camera';
 expect(ShowDocumentSchema.safeParse(invalid).success).toBe(false);
});

it('requires edit permission and a valid scene for replacement', () => {
 expect(requiredCapability('sceneReplace')).toBe('edit');
 expect(validateCall('sceneReplace', { scene: show().scene, expectedRevision: 0 }).ok).toBe(true);
 expect(validateCall('sceneReplace', { scene: show().scene, expectedRevision: -1 }).ok).toBe(false);
});
