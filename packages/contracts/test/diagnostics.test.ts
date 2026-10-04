import { expect,it } from 'vitest';
import { parseWire } from '../src/index';
const diagnostics={sessionId:'session_smoke',outputId:'output_main',rendererEpoch:'epoch_1',sequence:1,revision:0,backend:'webgl2',geometries:3,textures:4,liveMaterials:2,assetCacheEntries:2,activeRenderJob:false,queuedFrames:0,queuedCaptures:0};
it('parses strict bounded diagnostics independently of ACK contracts',()=>{expect(parseWire(JSON.stringify({kind:'diagnostics',diagnostics}))).toEqual({kind:'diagnostics',diagnostics});});
it.each([{geometries:-1},{textures:1.5},{liveMaterials:1000001},{activeRenderJob:1},{rendererEpoch:''},{extra:1}])('rejects invalid diagnostics %j',change=>{expect(()=>parseWire(JSON.stringify({kind:'diagnostics',diagnostics:{...diagnostics,...change}}))).toThrow();});
it('limits diagnostics encoded bytes to 2 KiB including whitespace',()=>{expect(()=>parseWire(JSON.stringify({kind:'diagnostics',diagnostics})+' '.repeat(2048))).toThrow();});
