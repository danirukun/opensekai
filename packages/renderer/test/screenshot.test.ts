import { expect, it } from 'vitest';
import { crc32, inflateSync } from 'node:zlib';
import { encodePng, filterRows, toStraightRows } from '../src/screenshot';

// An independent PNG reader for the test: chunk CRCs, IHDR, zlib, and the five scanline filters.
function decode(png: Uint8Array) {
 expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
 const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
 const chunks: { type: string; data: Uint8Array }[] = [];
 for (let offset = 8; offset < png.byteLength;) {
  const length = view.getUint32(offset), type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
  const data = png.subarray(offset + 8, offset + 8 + length);
  expect(view.getUint32(offset + 8 + length)).toBe(crc32(png.subarray(offset + 4, offset + 8 + length)));
  chunks.push({ type, data }); offset += 12 + length;
 }
 expect(chunks.map(c => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
 const header = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset, 13);
 const width = header.getUint32(0), height = header.getUint32(4);
 expect([...chunks[0]!.data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
 const raw = inflateSync(chunks[1]!.data), stride = width * 4, out = new Uint8Array(stride * height), filters: number[] = [];
 for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)]!; filters.push(filter);
  for (let i = 0; i < stride; i++) {
   const x = raw[y * (stride + 1) + 1 + i]!, a = i >= 4 ? out[y * stride + i - 4]! : 0, b = y ? out[(y - 1) * stride + i]! : 0, c = y && i >= 4 ? out[(y - 1) * stride + i - 4]! : 0;
   const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
   const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]!;
   out[y * stride + i] = (x + predictor) & 0xff;
  }
 }
 return { width, height, pixels: out, filters };
}

it('encodes RGBA with alpha losslessly as an 8-bit RGBA PNG', async () => {
 const width = 9, height = 6, rgba = new Uint8Array(width * height * 4);
 for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37 + (i >> 5) * 11) & 0xff;
 rgba.fill(0, 0, width * 4); // A transparent first row.
 const decoded = decode(await encodePng(rgba, width, height));
 expect({ width: decoded.width, height: decoded.height }).toEqual({ width, height });
 expect([...decoded.pixels]).toEqual([...rgba]);
 expect(decoded.filters.every(f => [1, 2, 4].includes(f))).toBe(true);
});

it('picks the filter with the smallest residual for each row', () => {
 const width = 4, row = (f: (x: number) => number[]) => Array.from({ length: width }, (_, x) => f(x)).flat();
 const rgba = new Uint8Array([...row(x => [x * 40, x * 40, x * 40, 255]), ...row(x => [x * 40 + 1, x * 40 + 1, x * 40 + 1, 255])]);
 const filtered = filterRows(rgba, width, 2);
 expect(filtered[0]).toBe(1); // A horizontal ramp: Sub.
 expect(filtered[1 + width * 4]).toBe(2); // The same ramp plus one: Up.
});

it('rejects a pixel buffer of the wrong size', async () => {
 await expect(encodePng(new Uint8Array(15), 2, 2)).rejects.toThrow();
});

it('flips WebGL rows and converts premultiplied color to straight alpha', () => {
 const top = [128, 64, 0, 128], bottom = [10, 20, 30, 255];
 const readBack = new Uint8Array([...bottom, 0, 0, 0, 0, ...top, 9, 9, 9, 0]);
 expect([...toStraightRows(readBack, 2, 2, true)]).toEqual([255, 128, 0, 128, 0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 0]);
 expect([...toStraightRows(readBack, 2, 2, false)]).toEqual([10, 20, 30, 255, 0, 0, 0, 0, 255, 128, 0, 128, 0, 0, 0, 0]);
 expect([...toStraightRows(new Uint8Array([200, 0, 0, 100]), 1, 1, false)]).toEqual([255, 0, 0, 100]);
});
