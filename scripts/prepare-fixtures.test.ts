import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareFixtures,signS3Get} from './prepare-fixtures';
const bytes=(text:string)=>new TextEncoder().encode(text);
const record=(id:string,data:Uint8Array)=>({id,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.byteLength,format:'glb',name:id});
const publicBytes=bytes('public fixture'),privateBytes=bytes('private fixture');
const manifest={schemaVersion:1 as const,bucket:'fixtures',assets:[{file:'public.glb',url:'https://example.test/public.glb',record:record('fixture_public',publicBytes)},{file:'private.glb',key:'sha256/private.glb',record:record('fixture_private',privateBytes)}]};
const credentials={OPENSEKAI_FIXTURES_S3_ENDPOINT:'https://account.r2.example.test/',OPENSEKAI_FIXTURES_ACCESS_KEY_ID:'id',OPENSEKAI_FIXTURES_SECRET_ACCESS_KEY:'secret'};
const serve=(routes:Record<string,Uint8Array<ArrayBuffer>>)=>vi.fn(async(url:string,_init?:RequestInit)=>routes[url]?new Response(routes[url]):new Response(null,{status:404}));
let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'opensekai-fixtures-'));});
afterEach(async()=>{vi.unstubAllGlobals();await rm(root,{recursive:true,force:true});});
it('signs a GET request like the AWS Signature Version 4 example',()=>{
 // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html, "Example: GET Object".
 const headers=signS3Get({url:'https://examplebucket.s3.amazonaws.com/test.txt',region:'us-east-1',accessKeyId:'AKIAIOSFODNN7EXAMPLE',secretAccessKey:'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',now:new Date('2013-05-24T00:00:00Z'),headers:{Range:'bytes=0-9'}});
 expect(headers.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
 expect(headers['x-amz-date']).toBe('20130524T000000Z');
});
it('downloads public and private fixtures and writes a registry manifest',async()=>{
 const fetch=serve({'https://example.test/public.glb':publicBytes,'https://account.r2.example.test/fixtures/sha256/private.glb':privateBytes});vi.stubGlobal('fetch',fetch);
 const result=await prepareFixtures({root,manifest,env:credentials});
 expect(result).toEqual({manifest:join(root,'fixtures/local/manifest.json'),ready:['fixture_public','fixture_private'],skipped:[]});
 expect((fetch.mock.calls[1]?.[1]?.headers as Record<string,string>).authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/auto\/s3\/aws4_request/);
 const written=JSON.parse(await readFile(result.manifest,'utf8'));
 expect(written).toEqual({schemaVersion:1,fixtureId:'smoke_v1',assets:[{path:join(root,'fixtures/local/public.glb'),record:manifest.assets[0].record},{path:join(root,'fixtures/local/private.glb'),record:manifest.assets[1].record}]});
 expect(await readFile(join(root,'fixtures/local/private.glb'))).toEqual(Buffer.from(privateBytes));
});
it('skips private fixtures without credentials',async()=>{
 vi.stubGlobal('fetch',serve({'https://example.test/public.glb':publicBytes}));
 expect(await prepareFixtures({root,manifest,env:{}})).toMatchObject({ready:['fixture_public'],skipped:['fixture_private']});
});
it('uses verified cached files without network access',async()=>{
 await mkdir(join(root,'fixtures/local'),{recursive:true});await writeFile(join(root,'fixtures/local/public.glb'),publicBytes);await writeFile(join(root,'fixtures/local/private.glb'),privateBytes);
 const fetch=vi.fn().mockRejectedValue(new Error('network forbidden'));vi.stubGlobal('fetch',fetch);
 expect(await prepareFixtures({root,manifest,env:{}})).toMatchObject({ready:['fixture_public','fixture_private'],skipped:[]});
 expect(fetch).not.toHaveBeenCalled();
});
it('rejects a download that fails the integrity check',async()=>{
 vi.stubGlobal('fetch',serve({'https://example.test/public.glb':bytes('tampered fixture')}));
 await expect(prepareFixtures({root,manifest,env:{}})).rejects.toThrow('integrity check: fixture_public');
 await expect(readFile(join(root,'fixtures/local/public.glb'))).rejects.toThrow();
});
