import { createHash } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { makeSmokeScene, type AppApi, type Reply } from '@opensekai/contracts';
import { createMcpServer } from '../src/server';
export function fixtureApi(): AppApi {
 const scene = makeSmokeScene();
 const ok = <T>(data:T):Reply<T> => ({ok:true,data});
 const denied = async ():Promise<Reply<never>> => ({ok:false,error:{code:'FORBIDDEN',message:'Capability denied',ids:[]}});
 return {
  appStatus:async () => ok({schemaVersion:1,sessionId:'fixture',ready:true,revision:scene.revision,capabilities:['read','edit'],warnings:[],outputs:[]}),
  sceneInspect:async () => ok(structuredClone(scene)),
  scenePatch:async p => p.expectedRevision !== scene.revision ? {ok:false,error:{code:'CONFLICT',message:'Stale revision',ids:[]}} : ok({revision:++scene.revision}),
  sceneReplace:denied,
  blueprintEdit:async () => ok({revision:1,keystrokes:[]}),
  blueprintInspect:async () => ok({kind:'snapshot' as const,revision:0,blueprints:[],errors:[]}),
  cameraScreenshot:async p => p.cameraId !== 'camera_main' ? {ok:false,error:{code:'NOT_FOUND',message:'Camera not found',ids:[p.cameraId]}} : ok({fileName:'20261017-090507-042-camera_main.png',width:1920 as const,height:1080 as const,bytes:1024,sha256:'0'.repeat(64),cameraId:p.cameraId,revision:p.expectedRevision}),
  cameraSelect:denied,blueprintRun:denied,captureFrame:async () => ({ok:false,error:{code:'RATE_LIMITED',message:'Capture limit',ids:[]}}),benchmarkStart:denied,benchmarkStatus:denied,benchmarkCancel:denied,
  assetList:async () => ok({assets:[{id:'avatar_one',kind:'avatar' as const,name:'One'},{id:'scene_room',kind:'scene' as const,name:'Room',credits:{title:'Room',author:'Ada',license:'CC-BY-4.0',sourceUrl:'https://example.com/room'}}],next:null}),
  expressionGet:denied,expressionSet:denied,
  evidenceRead:async () => ok({id:'opaque',kind:'capture',sessionId:'fixture',fixtureId:'smoke_v1',appCommit:'fixture',resources:[{uri:'opensekai://evidence/opaque/capture.png',mimeType:'image/png',bytes:3,sha256:createHash('sha256').update(new Uint8Array([1,2,3])).digest('hex')}]})
 };
}
if (process.argv[1]?.endsWith('stdio-fixture.ts')) {
 let reads = 0;
 const server = createMcpServer(fixtureApi(),async uri => {if(uri !== 'opensekai://evidence/opaque/capture.png' || reads++ > 0) throw new Error('NOT_FOUND');return new Uint8Array([1,2,3]);});
 process.stderr.write('fixture ready\n');
 await server.connect(new StdioServerTransport());
}
