import { expect, it } from "vitest";
import { makeSmokeScene } from "@opensekai/contracts";
import { createSession } from "../src/session";
import { markerRotation } from "../src/smoke-motion";
it("evaluates deterministic roots without persistent edits", () => {
    const a = createSession(makeSmokeScene(), "test"), b = createSession(makeSmokeScene(), "test");
    const before = a.inspect();
    for (const time of [0, 500, 1000]) {
        const frame = a.advance(time);
        expect(frame).toEqual(b.advance(time));
        expect(frame.tick).toBe(Math.floor(time * 60 / 1000));
    }
    const frame = a.advance(1000);
    expect(frame.sequence).toBe(4);
    expect(frame.scene.revision).toBe(0);
    expect(frame.scene.entities[0]!.transform.rotation).toEqual(markerRotation(1000));
    expect(frame.scene.entities[1]!.transform.position).not.toEqual(before.entities[1]!.transform.position);
    expect(a.inspect()).toEqual(before);
});
it("rejects backward and nonfinite elapsed time without consuming sequence", () => {
    const s = createSession(makeSmokeScene(), "test");
    s.advance(1000);
    for (const time of [999, -1, NaN, Infinity])
        expect(() => s.advance(time)).toThrow();
    expect(s.advance(1000).sequence).toBe(2);
});
