import { expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture } from 'three/webgpu';
import { applyMissingShadeMultiply } from '../src/mtoon-shade';

const geom = () => new BoxGeometry(1, 1, 1);
const mtoon = (fields: { map?: Texture | null; shadeMultiplyTexture?: Texture | null }) =>
    Object.assign(new MeshBasicMaterial(), { isMToonNodeMaterial: true, ...fields });

it('sets shade multiply to the lit map when shade has no map', () => {
    const map = new Texture();
    const material = mtoon({ map, shadeMultiplyTexture: null });
    const root = new Group();
    root.add(new Mesh(geom(), material as never));
    expect(applyMissingShadeMultiply(root)).toBe(1);
    expect(material.shadeMultiplyTexture).toBe(map);
});

it('leaves a material that already has a shade map', () => {
    const map = new Texture(), shade = new Texture();
    const material = mtoon({ map, shadeMultiplyTexture: shade });
    const root = new Group();
    root.add(new Mesh(geom(), material as never));
    expect(applyMissingShadeMultiply(root)).toBe(0);
    expect(material.shadeMultiplyTexture).toBe(shade);
});

it('skips non-MToon materials and MToon without a lit map', () => {
    const plain = new MeshBasicMaterial();
    const bare = mtoon({ map: null, shadeMultiplyTexture: null });
    const root = new Group();
    root.add(new Mesh(geom(), plain));
    root.add(new Mesh(geom(), bare as never));
    expect(applyMissingShadeMultiply(root)).toBe(0);
});
