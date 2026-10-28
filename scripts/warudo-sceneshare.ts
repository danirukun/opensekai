import {open,mkdir,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,normalize,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
// A Warudo sceneshare file is a run of entries: i32 tag length, tag, i32 path length, path, i64 data length, data.
// LOCAL_ASSET entries hold .warudo (uMod) archives. The SCENE_JSON entry holds the Warudo scene.
export type Entry={tag:string;path:string;offset:number;length:number};
export type Read=(offset:number,length:number)=>Promise<Uint8Array>;
type Port={type?:string;value?:unknown;defaultValue?:unknown;dataInputs?:Record<string,Port>};
type SceneAsset={typeId:string;name:string;active:boolean;dataInputs:Record<string,Port>};
type SceneNode={typeId:string;name?:string};
type Scene={name:string;appVersion:string;requiredPlugins:{name:string;steamID?:string|null;pluginID?:string|null}[];requiredLocalAssets:{localPath:string}[];assets:SceneAsset[];graphs:{name:string;enabled:boolean;nodes:Record<string,SceneNode>|SceneNode[]}[];plugins:Record<string,unknown>};
// Asset type IDs from the Warudo 0.15.1 type list, plus the plugin types that the sample scene uses.
export const assetTypes:Record<string,string>={
 '726ab674-a550-474e-8b92-66526a5ad55e':'Character','945f0112-8ebe-4c5e-bda2-700925489a57':'Prop','941fc894-cab8-4495-9d7a-e0826e832b96':'Screen',
 '3b082c9c-fd34-41cb-82b6-2045a371dc83':'Environment','8aa033fb-9386-4d04-bec1-2ec67028f326':'Directional Light','cff62bbe-6e37-468b-a518-e1f11115f82e':'Point Light',
 'ab31f6f8-8140-4612-8986-0ada4499eee2':'Volumetric Light','6a05ecf3-1501-4cab-b9d7-84131b881a29':'Camera','78fac3fd-88f9-492d-96de-4bd6605cdf43':'VMC Receiver',
 '33b8de82-4189-4d08-9416-048750437e6a':'FPS Counter','778ab65f-8e11-44f1-ad85-28b7a12429f1':'Onboarding Assistant','8a3b862c-371f-4377-93bd-671c9a75baea':'Post Processing Volume (not in the free 0.15.1 type list)',
 'a1b2c3d4-e5f6-7890-aaaa-000000000001':'Art-Net DMX Receiver (plugin com.vtoku.artnetdmx)','a1b2c3d4-e5f6-7890-aaaa-000000000003':'DMX Fixture Group (plugin com.vtoku.artnetdmx)',
 'Feline.ParticleProp':'Particle Prop (plugin Feline.ParticlePropPlugin)',
};
const decoder=new TextDecoder();
export async function readEntries(read:Read,size:number):Promise<Entry[]>{
 const entries:Entry[]=[];
 for(let at=0;at<size;){
  const int=async(width:4|8)=>{const v=new DataView((await read(at,width)).buffer);at+=width;return width===4?v.getInt32(0,true):Number(v.getBigInt64(0,true));};
  const text=async()=>{const n=await int(4);const s=decoder.decode(await read(at,n));at+=n;return s;};
  const tag=await text(),path=await text(),length=await int(8);
  if(length<0||at+length>size)throw new Error(`Entry ${path} runs past the end of the file`);
  entries.push({tag,path,offset:at,length});at+=length;
 }
 return entries;
}
const parse=(v:unknown)=>{if(typeof v!=='string')return v;try{return JSON.parse(v);}catch{return v;}};
function decode(v:unknown):unknown{
 const p=parse(v);
 if(Array.isArray(p))return p.map(decode);
 if(!p||typeof p!=='object')return p;
 const o=p as Record<string,unknown>;
 if('label' in o&&'value' in o)return o.label;
 if('id' in o&&'name' in o&&Object.keys(o).length===2)return {asset:o.name};
 if('dataInputs' in o)return changedPorts(o.dataInputs as Record<string,Port>);
 return o;
}
export const changedPorts=(ports:Record<string,Port>)=>Object.fromEntries(Object.entries(ports).filter(([,p])=>p.value!==p.defaultValue).map(([k,p])=>[k,decode(p.value)]));
const transformOf=(a:SceneAsset)=>{const t=parse(a.dataInputs.Transform?.value) as {dataInputs?:Record<string,Port>}|undefined;
 return t?.dataInputs&&Object.fromEntries(['Position','Rotation','Scale'].map(k=>[k.toLowerCase(),parse(t.dataInputs![k]?.value)]));};
const count=(keys:string[])=>keys.reduce<Record<string,number>>((m,k)=>({...m,[k]:(m[k]??0)+1}),{});
export function inventory(scene:Scene){
 return {name:scene.name,appVersion:scene.appVersion,
  requiredPlugins:scene.requiredPlugins.map(p=>({name:p.name,id:p.pluginID??null,steamID:p.steamID??null})),
  loadedPlugins:Object.keys(scene.plugins),
  localAssets:scene.requiredLocalAssets.map(a=>a.localPath),
  assetTypes:count(scene.assets.map(a=>assetTypes[a.typeId]??a.typeId)),
  assets:scene.assets.map(a=>({name:a.name,type:assetTypes[a.typeId]??a.typeId,active:a.active,transform:transformOf(a),changed:changedPorts(a.dataInputs)})),
  graphs:scene.graphs.map(g=>{const nodes=Object.values(g.nodes);return {name:g.name,enabled:g.enabled,nodeCount:nodes.length,nodes:count(nodes.map(n=>n.name??n.typeId))};}),
 };
}
// Entry paths come from the file, so an unpack keeps them inside the target folder.
export function safeJoin(root:string,path:string){
 const rel=normalize(path);
 if(isAbsolute(rel)||rel.split(sep).includes('..')||rel.split('/').includes('..'))throw new Error(`Unsafe entry path: ${path}`);
 return join(root,rel);
}
async function withFile<T>(file:string,run:(read:Read,size:number)=>Promise<T>){
 const handle=await open(file,'r');
 try{const size=(await handle.stat()).size;
  return await run(async(offset,length)=>{const b=new Uint8Array(length);const {bytesRead}=await handle.read(b,0,length,offset);if(bytesRead!==length)throw new Error('Unexpected end of file');return b;},size);
 }finally{await handle.close();}
}
async function main([command,file,out]:string[]){
 if(!file||!['list','inventory','unpack'].includes(command??'')||(command==='unpack'&&!out))throw new Error('Usage: warudo-sceneshare list|inventory <file.sceneshare> | unpack <file.sceneshare> <folder>');
 await withFile(file,async(read,size)=>{
  const entries=await readEntries(read,size);
  if(command==='list'){for(const e of entries)console.log(`${e.tag}\t${e.length}\t${e.path}`);return;}
  if(command==='inventory'){const scene=entries.find(e=>e.tag==='SCENE_JSON');if(!scene)throw new Error('No SCENE_JSON entry');
   console.log(JSON.stringify(inventory(JSON.parse(decoder.decode(await read(scene.offset,scene.length)))),null,1));return;}
  for(const e of entries){const dest=safeJoin(out!,e.path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,await read(e.offset,e.length));console.log(dest);}
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1);});
