import { expect, it } from 'vitest';
import { invokeTool } from '../src/tools';
import { validEvidenceUri } from '../src/resources';
import { fixtureApi } from './stdio-fixture';
it('rejects unknown fields before forwarding', async () => expect(await invokeTool(fixtureApi(),'appStatus',{extra:true})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}}));
it('preserves stale revision and capture rate errors', async () => {
 expect(await invokeTool(fixtureApi(),'scenePatch',{sceneId:'scene_smoke',expectedRevision:9,operations:[{kind:'setVisibility',entityId:'marker',visible:false}]})).toMatchObject({ok:false,error:{code:'CONFLICT'}});
 expect(await invokeTool(fixtureApi(),'captureFrame',{outputId:'output_main',expectedRevision:0,preset:'diagnostic_v1',maxAgeMs:500})).toMatchObject({ok:false,error:{code:'RATE_LIMITED'}});
});
it('preserves read-only and disconnected failures',async () => {
 const api=fixtureApi();
 expect(await invokeTool(api,'benchmarkStart',{requestId:'r',fixtureId:'smoke_v1',profileId:'webgpu_smoke_v1'})).toMatchObject({ok:false,error:{code:'FORBIDDEN'}});
 api.appStatus=async()=>{throw new Error('secret');};
 expect(await invokeTool(api,'appStatus',{})).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});
});
it('rejects arbitrary evidence locations',()=>{
 for(const uri of ['file:///tmp/a','http://127.0.0.1/a','opensekai://evidence/../x','opensekai://evidence/opaque/..','opensekai://evidence/x/capture.png?token=x']) expect(validEvidenceUri(uri)).toBe(false);
 expect(validEvidenceUri('opensekai://evidence/opaque/capture.png')).toBe(true);
});
it('maps Blueprint tools and validates their input',async () => {
 const { toolMethods } = await import('../src/tools');
 expect(toolMethods).toMatchObject({blueprint_edit:'blueprintEdit',blueprint_inspect:'blueprintInspect'});
 const api=fixtureApi();
 expect(await invokeTool(api,'blueprintEdit',{clientId:'agent',batchId:'b1',ops:[{kind:'replaceAll',graphs:[]}]})).toMatchObject({ok:true,data:{revision:1}});
 expect(await invokeTool(api,'blueprintInspect',{})).toMatchObject({ok:true});
 expect(await invokeTool(api,'blueprintInspect',{sinceRevision:0})).toMatchObject({ok:true});
 expect(await invokeTool(api,'blueprintRun',{graph:{},triggerNodeId:'start'})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
});
