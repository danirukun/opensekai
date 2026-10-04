import { it, expect } from "vitest";
import { createCapturePolicy } from "../src/capture";
it("bounds PNG", () => { const p = createCapturePolicy(); expect(() => p.checkBytes(2 * 1024 * 1024 + 1)).toThrow(); });
it("limits capture rate", () => { const p = createCapturePolicy(); p.reserve(0); expect(() => p.reserve(999)).toThrow(); expect(() => p.reserve(1000)).not.toThrow(); });
