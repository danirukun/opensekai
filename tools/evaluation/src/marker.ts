import { PNG } from 'pngjs';
import type { DiagnosticMarker, Reply } from '@opensekai/contracts';
export function inspectPng(bytes: Uint8Array): {
    width: number;
    height: number;
} {
    if (bytes.length < 33 || bytes.length > 2 * 1024 * 1024)
        throw new Error('PNG size invalid');
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || buffer.toString('ascii', 12, 16) !== 'IHDR' || buffer.readUInt32BE(8) !== 13)
        throw new Error('PNG header invalid');
    const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
    if (width < 1 || height < 1 || width > 1920 || height > 1080)
        throw new Error('PNG dimensions invalid');
    return {
        width, height
    };
}
export function decodeMarker(bytes: Uint8Array): Reply<DiagnosticMarker> {
    try {
        const dimensions = inspectPng(bytes);
        if (dimensions.width < 336 || dimensions.height < 8)
            throw new Error('Marker region absent');
        const png = PNG.sync.read(Buffer.from(bytes), {
            checkCRC: true
        });
        const bits: number[] = [];
        for (let i = 0; i < 168; i++) {
            const offset = i * 2 * 4, first = png.data[offset];
            if (first !== 0 && first !== 255)
                throw new Error('Marker value invalid');
            for (let y = 0; y < 8; y++)
                for (let x = 0; x < 2; x++) {
                    const p = (y * png.width + i * 2 + x) * 4;
                    if (png.data[p] !== first || png.data[p + 1] !== first || png.data[p + 2] !== first || png.data[p + 3] !== 255)
                        throw new Error('Marker cell invalid');
                }
            bits.push(first === 255 ? 1 : 0);
        }
        if (bits.slice(0, 8).some((bit, i) => bit !== (i % 2 === 0 ? 1 : 0)))
            throw new Error('Marker header invalid');
        const words = Array.from({
            length: 5
        }, (_, word) => {
            let value = 0;
            for (let bit = 0; bit < 32; bit++)
                value = (value * 2 + bits[8 + word * 32 + bit]) >>> 0;
            return value;
        });
        return {
            ok: true, data: {
                sessionTag: words[0], sequence: words[1], tick: words[2], revision: words[3], cameraTag: words[4]
            }
        };
    }
    catch {
        return {
            ok: false, error: {
                code: 'INVALID_INPUT', message: 'PNG or diagnostic marker invalid', ids: []
            }
        };
    }
}
