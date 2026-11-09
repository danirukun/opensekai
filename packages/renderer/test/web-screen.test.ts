import { expect, it } from 'vitest';
import { Matrix4, NoBlending, PerspectiveCamera, Quaternion, Vector3 } from 'three/webgpu';
import { LIMITS, makeSmokeScene, type SceneEntity, type WebScreen } from '@opensekai/contracts';
import { createHoleMaterial, createPickMaterial, createWebQuad, frameAttributes, quadInFront, webQuadWidth, webScreenPlan } from '../src/web-screen';
const web = (id: string, content: Partial<WebScreen> = {}, visible = true): SceneEntity => ({ id, name: 'Screen', visible, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content: { kind: 'web', url: 'https://example.com/a b'.replace(' ', '%20'), width: 1280, height: 720, onTop: false, ...content } });
const sceneWith = (...entities: SceneEntity[]) => { const scene = makeSmokeScene(); scene.entities.push(...entities); return scene; };
// B30 R6, R12: the plan is a pure function of the scene.
it('plans each web screen with a valid URL and skips a null or failing URL and image screens', () => {
    const image = { ...web('logo'), content: { kind: 'image', assetId: null } } as SceneEntity;
    const plan = webScreenPlan(sceneWith(web('chat', { url: 'https://Example.com/chat?x=1#y', onTop: true }), web('empty', { url: null }), web('lan', { url: 'https://192.168.0.10/' }), web('hidden', {}, false), image));
    expect(plan).toEqual([
        { entityId: 'chat', href: 'https://example.com/chat?x=1#y', width: 1280, height: 720, onTop: true, visible: true },
        { entityId: 'hidden', href: 'https://example.com/a%20b', width: 1280, height: 720, onTop: false, visible: false }
    ]);
});
it('plans at most the web screen limit', () => {
    expect(webScreenPlan({ entities: Array.from({ length: LIMITS.webScreens + 2 }, (_, i) => web(`w${i}`)) })).toHaveLength(LIMITS.webScreens);
});
// R7: the iframe hides when a corner is not in front of the near plane.
it('finds whether each quad corner is in front of the near plane', () => {
    const camera = new PerspectiveCamera(40, 16 / 9, 0.1, 100);
    camera.position.set(0, 0, 3); camera.updateMatrixWorld(true);
    const at = (z: number, yaw = 0) => new Matrix4().compose(new Vector3(0, 0, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(1, 1, 1));
    expect(quadInFront(at(0), camera.matrixWorldInverse, 16 / 9, camera.near)).toBe(true);
    expect(quadInFront(at(2.95), camera.matrixWorldInverse, 16 / 9, camera.near)).toBe(false);
    expect(quadInFront(at(4), camera.matrixWorldInverse, 16 / 9, camera.near)).toBe(false);
    // A screen at the camera, turned 90 degrees: one edge goes behind the camera.
    expect(quadInFront(at(2.5, Math.PI / 2), camera.matrixWorldInverse, 16 / 9, camera.near)).toBe(false);
    expect(quadInFront(at(0, Math.PI / 3), camera.matrixWorldInverse, 16 / 9, camera.near)).toBe(true);
});
it('gives the iframe the sandbox, referrer policy, allow, and pointer rule for each mode', () => {
    const plan = { href: 'https://example.com/', width: 400, height: 900 };
    expect(frameAttributes(plan, true)).toEqual({
        attributes: { src: 'https://example.com/', sandbox: 'allow-scripts allow-same-origin allow-forms', referrerpolicy: 'no-referrer', allow: 'autoplay' },
        style: { width: '400px', height: '900px', border: '0', background: 'transparent', 'color-scheme': 'normal', 'pointer-events': 'auto', 'backface-visibility': 'visible' }
    });
    const editor = frameAttributes(plan, false);
    expect(editor.attributes).toEqual({ src: 'https://example.com/', sandbox: 'allow-scripts allow-same-origin allow-forms', referrerpolicy: 'no-referrer', tabindex: '-1' });
    expect(editor.style['pointer-events']).toBe('none');
});
// R8: the hole writes depth and no colour blend; the pick quad draws nothing.
it('makes the hole and pick materials and a 1 m high quad', () => {
    const hole = createHoleMaterial();
    expect([hole.blending, hole.transparent, hole.depthWrite, hole.depthTest, hole.fog, hole.toneMapped, hole.colorWrite, hole.outputNode !== null]).toEqual([NoBlending, false, true, true, false, false, true, true]);
    const pick = createPickMaterial();
    expect([pick.colorWrite, pick.depthWrite]).toEqual([false, false]);
    expect(webQuadWidth({ width: 1280, height: 720 })).toBeCloseTo(16 / 9);
    const quad = createWebQuad(2, true);
    quad.root.geometry.computeBoundingBox();
    expect(quad.root.geometry.boundingBox!.getSize(new Vector3()).toArray()).toEqual([2, 1, 0]);
    expect([quad.root.castShadow, quad.root.receiveShadow]).toEqual([false, false]);
    quad.dispose();
});
// R7: the scaled CSS world projects each point to the same place as the canvas camera.
it('keeps the projection in the scaled CSS world', async () => {
    const { CSS_WORLD_SCALE, cssViewMatrix } = await import('../src/web-screen');
    const camera = new PerspectiveCamera(45, 16 / 9, 0.01, 100);
    camera.position.set(0.4, 1.2, 3); camera.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.3); camera.updateMatrixWorld(true);
    const view = cssViewMatrix(camera.matrixWorldInverse);
    for (const point of [new Vector3(0, 1.2, 0), new Vector3(-0.8, 0.7, -0.5), new Vector3(1, 2, 0.4)]) {
        const a = point.clone().applyMatrix4(camera.matrixWorldInverse), b = point.clone().multiplyScalar(CSS_WORLD_SCALE).applyMatrix4(view);
        expect([b.x / b.z, b.y / b.z]).toEqual([expect.closeTo(a.x / a.z, 9), expect.closeTo(a.y / a.z, 9)]);
    }
});
