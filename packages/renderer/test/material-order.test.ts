// B38 R28 on the renderer frame path: the avatar update (an expression color bind) runs first, then the saved material values.
import { expect, it, vi } from 'vitest';
import { Group, Mesh, MeshBasicMaterial } from 'three/webgpu';
import { QUALITY_PROFILES, makeSmokeFrame, type AssetMaterial, type RuntimeFrame } from '@opensekai/contracts';
const ports = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn(async () => {}), compile: vi.fn(async () => {}) }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgl2', renderer: { shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: ports.render, compileAsync: ports.compile, dispose: vi.fn() } }) }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: () => ports.load }));
// The stand-in avatar binding writes red on each update, as an expression color bind does.
vi.mock('../src/avatar-pose', () => ({
 createAvatarBinding: (vrm: { root: Group }) => ({
  root: vrm.root,
  apply: () => vrm.root.traverse(object => { const material = (object as Mesh).material as MeshBasicMaterial | undefined; material?.color.set('#ff0000'); }),
  uv: vi.fn(), lighting: vi.fn(), characters: [], advanceSprings: vi.fn(),
 }),
}));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({ texture: null, dispose() {} }), roomIrradiance: async () => [[1, 1, 1], ...Array.from({ length: 8 }, () => [0, 0, 0])] }));
import { createRenderer } from '../src/renderer';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const record: AssetMaterial = { index: 0, name: 'Body', profile: 'mtoon', blend: false, outline: false, model: { baseColor: '#ffffff' } };
let sequence = 0;
const frame = (materials?: Record<string, { baseColor: string }>): RuntimeFrame => {
 const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
 f.scene.entities = f.scene.entities.filter(e => e.kind === 'camera' || e.kind === 'avatar');
 for (const e of f.scene.entities) if (e.kind === 'avatar') { e.assetId = 'avatar_a'; if (materials) e.materials = materials; else delete e.materials; }
 return f;
};

it('writes the saved value after the avatar update of the same frame, and leaves the bind without a saved value', async () => {
 const material = new MeshBasicMaterial({ color: '#ffffff' });
 const root = new Group().add(new Mesh(undefined, material));
 ports.load.mockResolvedValue({ scene: root, vrm: { root }, materials: [record], materialIndex: () => 0, warnings: [], dispose: vi.fn() });
 const renderer = await createRenderer({ canvas: { width: 1920, height: 1080 } as HTMLCanvasElement, outputId: 'output_main', mode: 'force-webgl2', resources: { readAsset: vi.fn() }, diagnostics: false, quality: QUALITY_PROFILES.production_v1 });
 await renderer.applyFrame(frame({ Body: { baseColor: '#00ff00' } }));
 await settle();
 await renderer.applyFrame(frame({ Body: { baseColor: '#00ff00' } }));
 expect(ports.render).toHaveBeenCalled();
 expect(`#${material.color.getHexString()}`).toBe('#00ff00');
 // The frame that removes the value restores the model value once; from the next frame the bind writes alone.
 await renderer.applyFrame(frame());
 await renderer.applyFrame(frame());
 expect(`#${material.color.getHexString()}`).toBe('#ff0000');
 renderer.dispose();
});
