import type { Texture } from 'three/webgpu';
import { failure } from './apply-frame';

type Resize = (image: ImageBitmapSource, options: ImageBitmapOptions) => Promise<ImageBitmap>;
export function createImageResizePolicy(maxTextureSize: 1024 | 2048 = 2048, resize: Resize = (image, options) => createImageBitmap(image, options)) {
    let active = 0;
    const waiting: Array<() => void> = [];
    return {
        async decode(load: () => Promise<Texture>): Promise<Texture> {
            if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve));
            else active++;
            try {
                const texture = await load();
                const image = texture.image as ImageBitmap;
                const longest = Math.max(image.width, image.height);
                if (longest <= maxTextureSize) return texture;
                try {
                    const resized = await resize(image, {
                        resizeWidth: Math.max(1, Math.round(image.width * maxTextureSize / longest)),
                        resizeHeight: Math.max(1, Math.round(image.height * maxTextureSize / longest)),
                        resizeQuality: 'high',
                    });
                    texture.image = resized;
                    texture.needsUpdate = true;
                    image.close?.();
                    return texture;
                } catch {
                    texture.dispose();
                    image.close?.();
                    throw failure('UNSUPPORTED', 'Decoded asset image could not be resized');
                }
            } finally {
                const next = waiting.shift();
                if (next) next();
                else active--;
            }
        },
    };
}
