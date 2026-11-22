import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three/webgpu';

vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal<typeof import('three/webgpu')>();
    class FakePMREM {
        fromEquirectangular(_source: Texture) {
            const texture = new actual.Texture();
            return { texture, dispose: vi.fn(() => texture.dispose()) };
        }
        fromScene() {
            const texture = new actual.Texture();
            return { texture, dispose: vi.fn(() => texture.dispose()) };
        }
        dispose() {}
    }
    return { ...actual, PMREMGenerator: FakePMREM };
});

vi.mock('three/addons/environments/ColorEnvironment.js', () => ({
    ColorEnvironment: class { dispose() {} }
}));

describe('IBL PMREM cache (ENV-02)', () => {
    it(`keeps at most ${4} maps and does not dispose the active one`, async () => {
        const { createEnvironmentLight, PMREM_IBL_CACHE_LIMIT } = await import('../src/environment-light');
        expect(PMREM_IBL_CACHE_LIMIT).toBe(4);
        const room = new Texture();
        const light = createEnvironmentLight({} as never, () => ({ texture: room, dispose() {} }));
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
        light.apply(root);
        const source = new Texture();
        const disposed: Texture[] = [];
        const originals = Texture.prototype.dispose;
        Texture.prototype.dispose = function (this: Texture) {
            disposed.push(this);
            return originals.call(this);
        };
        try {
            for (let i = 0; i < PMREM_IBL_CACHE_LIMIT + 2; i++)
                light.iblFromEquirect(source, `sky_${i}`);
            // Active key sky_5 stays; the two oldest unused equirect entries are gone.
            expect(disposed.length).toBe(2);
            const copy = (root.children[0] as Mesh).material as MeshStandardMaterial;
            expect(copy.envMap).not.toBe(room);
            expect(disposed.includes(copy.envMap as Texture)).toBe(false);
            light.clearIbl();
            expect(copy.envMap).toBe(room);
        } finally {
            Texture.prototype.dispose = originals;
            light.dispose();
        }
    });
});
