import {expect,it} from "vitest";
import {parseWire} from "../src/schema";
it("accepts strict clock vectors including zero and safe maximum", () => {
 for (const elapsedMs of [0,1,Number.MAX_SAFE_INTEGER]) expect(parseWire(JSON.stringify({kind:"clock",sessionId:"test",elapsedMs}))).toEqual({kind:"clock",sessionId:"test",elapsedMs});
});
it("rejects invalid or extended clocks", () => {
 for (const elapsedMs of [-1,0.5,Number.MAX_SAFE_INTEGER+1,null,"1"]) expect(() => parseWire(JSON.stringify({kind:"clock",sessionId:"test",elapsedMs}))).toThrow();
 expect(() => parseWire(JSON.stringify({kind:"clock",sessionId:"test",elapsedMs:0,extra:true}))).toThrow();
});
