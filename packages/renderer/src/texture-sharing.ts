import type { Texture } from 'three/webgpu';
import { failure } from './apply-frame';

type Entry = { promise: Promise<Texture>; value?: Texture };
type Asset = { references: number; images: Map<number, Entry> };

export function createTexturePool() {
    const assets = new Map<string, Asset>();
    const dispose = (texture: Texture) => {
        texture.dispose();
        const image = texture.image as { close?: () => void } | undefined;
        image?.close?.();
    };
    return {
        size: () => assets.size,
        acquire(id: string) {
            let asset = assets.get(id);
            if (!asset) { asset = { references: 0, images: new Map() }; assets.set(id, asset); }
            const current = asset;
            current.references++;
            const textures = new Set<Texture>();
            let released = false;
            return {
                textures,
                ownsImage: (image: unknown) => [...current.images.values()].some(entry => entry.value?.image === image),
                async load(index: number, decode: () => Promise<Texture>): Promise<Texture> {
                    if (released) throw failure('CANCELLED', 'Asset load cancelled', [id]);
                    let entry = current.images.get(index);
                    if (!entry) {
                        const created: Entry = { promise: undefined! };
                        created.promise = Promise.resolve().then(decode).then(texture => {
                            if (current.references === 0) dispose(texture);
                            else created.value = texture;
                            return texture;
                        }, error => {
                            if (current.images.get(index) === created) current.images.delete(index);
                            throw error;
                        });
                        current.images.set(index, created);
                        entry = created;
                    }
                    const canonical = await entry.promise;
                    if (released) throw failure('CANCELLED', 'Asset load cancelled', [id]);
                    const texture = canonical.clone();
                    textures.add(texture);
                    return texture;
                },
                release() {
                    if (released) return;
                    released = true;
                    for (const texture of textures) texture.dispose();
                    textures.clear();
                    if (--current.references > 0) return;
                    if (assets.get(id) === current) assets.delete(id);
                    for (const entry of current.images.values()) if (entry.value) dispose(entry.value);
                    current.images.clear();
                },
            };
        },
    };
}
