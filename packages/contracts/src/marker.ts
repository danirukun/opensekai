import type { DiagnosticMarker, Id } from "./types";
export function tagId(id: Id): number { let hash = 2166136261; for (const byte of new TextEncoder().encode(id))
    hash = Math.imul(hash ^ byte, 16777619) >>> 0; return hash; }
export function encodeMarker(marker: DiagnosticMarker): Uint8Array { const cells = new Uint8Array(168); for (let i = 0; i < 8; i++)
    cells[i] = i % 2 === 0 ? 1 : 0; const words = [
    marker.sessionTag,
    marker.sequence,
    marker.tick,
    marker.revision,
    marker.cameraTag
]; words.forEach((word, w) => { for (let bit = 0; bit < 32; bit++)
    cells[8 + w * 32 + bit] = (word >>> (31 - bit)) & 1; }); return cells; }
