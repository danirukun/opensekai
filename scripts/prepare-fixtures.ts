import {createHash,createHmac} from 'node:crypto';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
type Asset={file:string;url?:string;key?:string;record:{id:string;sha256:string;bytes:number}&Record<string,unknown>};
type CloudManifest={schemaVersion:1;bucket:string;assets:Asset[]};
type Env=Record<string,string|undefined>;
const root=fileURLToPath(new URL('../',import.meta.url));
const emptySha256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const sha256=(data:string|Uint8Array)=>createHash('sha256').update(data).digest('hex');
const hmac=(key:string|Buffer,data:string)=>createHmac('sha256',key).update(data).digest();
const intact=(data:Uint8Array,asset:Asset)=>data.byteLength===asset.record.bytes&&sha256(data)===asset.record.sha256;
// AWS Signature Version 4 for an unsigned-body GET. R2 and other S3 API providers accept it.
export function signS3Get(request:{url:string;region:string;accessKeyId:string;secretAccessKey:string;now:Date;headers?:Record<string,string>}):Record<string,string>{
 const url=new URL(request.url),amzDate=request.now.toISOString().replace(/[-:]|\.\d{3}/g,''),day=amzDate.slice(0,8);
 const headers:Record<string,string>={...Object.fromEntries(Object.entries(request.headers??{}).map(([k,v])=>[k.toLowerCase(),v.trim()])),host:url.host,'x-amz-content-sha256':emptySha256,'x-amz-date':amzDate};
 const names=Object.keys(headers).sort(),signed=names.join(';'),scope=`${day}/${request.region}/s3/aws4_request`;
 const canonical=['GET',url.pathname,url.search.slice(1),names.map(n=>`${n}:${headers[n]}\n`).join(''),signed,emptySha256].join('\n');
 const key=[day,request.region,'s3','aws4_request'].reduce<string|Buffer>((k,part)=>hmac(k,part),`AWS4${request.secretAccessKey}`);
 const signature=hmac(key,['AWS4-HMAC-SHA256',amzDate,scope,sha256(canonical)].join('\n')).toString('hex');
 const {host:_,...sent}=headers;
 return {...sent,authorization:`AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`};
}
function privateSource(env:Env,bucket:string){
 const endpoint=env.OPENSEKAI_FIXTURES_S3_ENDPOINT,accessKeyId=env.OPENSEKAI_FIXTURES_ACCESS_KEY_ID,secretAccessKey=env.OPENSEKAI_FIXTURES_SECRET_ACCESS_KEY;
 if(!endpoint||!accessKeyId||!secretAccessKey)return null;
 return (key:string,now:Date)=>{const url=`${endpoint.replace(/\/+$/,'')}/${env.OPENSEKAI_FIXTURES_BUCKET??bucket}/${key}`;return {url,headers:signS3Get({url,region:env.OPENSEKAI_FIXTURES_REGION??'auto',accessKeyId,secretAccessKey,now})};};
}
async function cached(path:string,asset:Asset){try{return intact(await readFile(path),asset);}catch{return false;}}
export async function prepareFixtures(options:{root?:string;env?:Env;manifest?:CloudManifest;now?:()=>Date}={}){
 const project=options.root??root,local=resolve(project,'fixtures/local'),env=options.env??process.env,now=options.now??(()=>new Date());
 const manifest=options.manifest??JSON.parse(await readFile(resolve(project,'fixtures/cloud/manifest.json'),'utf8')) as CloudManifest;
 const source=privateSource(env,manifest.bucket),ready:Asset[]=[],skipped:string[]=[];
 await mkdir(local,{recursive:true});
 for(const asset of manifest.assets){const path=resolve(local,asset.file);
  if(await cached(path,asset)){ready.push(asset);continue;}
  const request=asset.key?source?.(asset.key,now()):asset.url?{url:asset.url,headers:{}}:undefined;
  if(!request){skipped.push(asset.record.id);continue;}
  const response=await fetch(request.url,{headers:request.headers,redirect:'error',signal:AbortSignal.timeout(300000)});
  if(!response.ok)throw new Error(`Fixture download failed: ${asset.record.id} ${response.status}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(!intact(bytes,asset))throw new Error(`Fixture failed integrity check: ${asset.record.id}`);
  await writeFile(`${path}.part`,bytes);await rename(`${path}.part`,path);ready.push(asset);
 }
 const localManifest={schemaVersion:1,fixtureId:'smoke_v1',assets:ready.map(asset=>({path:resolve(local,asset.file),record:asset.record}))};
 await writeFile(resolve(local,'manifest.json'),JSON.stringify(localManifest,null,2)+'\n');
 return {manifest:resolve(local,'manifest.json'),ready:ready.map(a=>a.record.id),skipped};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await prepareFixtures()));
