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
import { inspectPng } from '../src/marker';
function crc(bytes: Uint8Array): number {
    let value = 0xffffffff;
    for (const byte of bytes) {
        value ^= byte;
        for (let bit = 0; bit < 8; bit++)
            value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
}
function headerChunk(width: number, height: number, interlace: number): Buffer {
    const chunk = Buffer.alloc(25);
    chunk.writeUInt32BE(13);
    chunk.write('IHDR', 4);
    chunk.writeUInt32BE(width, 8);
    chunk.writeUInt32BE(height, 12);
    chunk[16] = 8;
    chunk[17] = 6;
    chunk[20] = interlace;
    chunk.writeUInt32BE(crc(chunk.subarray(4, 21)), 21);
    return chunk;
}
it('rejects interlace before the PNG codec can inflate', () => {
    const { bytes } = markerPng();
    const interlaced = Buffer.concat([bytes.subarray(0, 8), headerChunk(336, 8, 1), bytes.subarray(33)]);
    expect(() => inspectPng(interlaced)).toThrow();
});
it('rejects valid-CRC duplicate IHDR dimension and interlace overrides', () => {
    const { bytes } = markerPng();
    for (const override of [headerChunk(100000, 8, 0), headerChunk(336, 8, 1)]) {
        const duplicate = Buffer.concat([bytes.subarray(0, 33), override, bytes.subarray(33)]);
        expect(() => inspectPng(duplicate)).toThrow();
    }
});
it('requires bounded chunks and terminal IEND at exact end', () => {
    const { bytes } = markerPng();
    expect(() => inspectPng(bytes.subarray(0, bytes.length - 12))).toThrow();
    expect(() => inspectPng(Buffer.concat([bytes, Buffer.from([0])]))).toThrow();
    const invalid = Buffer.from(bytes);
    invalid.writeUInt32BE(0xffffffff, 33);
    expect(() => inspectPng(invalid)).toThrow();
});
