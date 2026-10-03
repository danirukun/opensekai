import { it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { encodeMarker } from '@opensekai/contracts';
import { decodeMarker } from '../src/marker';
function markerPng() {
    const marker = {
        sessionTag: 0xffffffff, sequence: 2147483648, tick: 123456, revision: 42, cameraTag: 0x87654321
    };
    const png = new PNG({
        width: 336, height: 8
    });
    encodeMarker(marker).forEach((bit, i) => {
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 2; x++) {
                const offset = (y * 336 + i * 2 + x) * 4;
                png.data.fill(bit * 255, offset, offset + 3);
                png.data[offset + 3] = 255;
            }
    });
    return {
        marker, bytes: PNG.sync.write(png), png
    };
}
it('decodes unsigned words and exact cell layout', () => {
    const { marker, bytes } = markerPng();
    expect(decodeMarker(bytes)).toEqual({
        ok: true, data: marker
    });
});
it('rejects malformed PNG and absent marker', () => {
    expect(decodeMarker(new Uint8Array([1, 2]))).toMatchObject({
        ok: false
    });
    const { png } = markerPng();
    png.data[3] = 0;
    expect(decodeMarker(PNG.sync.write(png))).toMatchObject({
        ok: false
    });
});
it('rejects oversize dimensions before inflate', () => {
    const { bytes } = markerPng();
    bytes.writeUInt32BE(100000, 16);
    expect(decodeMarker(bytes)).toMatchObject({
        ok: false
    });
});
it('rejects PNG above 2MiB', () => expect(decodeMarker(new Uint8Array(2 * 1024 * 1024 + 1))).toMatchObject({
    ok: false
}));
