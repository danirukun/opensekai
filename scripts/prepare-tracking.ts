import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import manifest from '../apps/desktop/src/tracking/models.json';
const root=fileURLToPath(new URL('../',import.meta.url));
function verify(data:Uint8Array,asset:{file:string;bytes:number;sha256:string}){if(data.byteLength!==asset.bytes||createHash('sha256').update(data).digest('hex')!==asset.sha256)throw new Error(`Tracking asset failed integrity check: ${asset.file}`);}
export async function prepareTracking(options:{root?:string;download?:boolean}={}){
 const project=options.root??root,cache=resolve(project,'artifacts/models'),target=resolve(project,'apps/desktop/public/tracking'),pkg=resolve(project,'apps/desktop/node_modules/@mediapipe/tasks-vision');
 const metadata=JSON.parse(await readFile(resolve(pkg,'package.json'),'utf8')) as {name:string;version:string};
 if(metadata.name!==manifest.package||metadata.version!==manifest.version)throw new Error('MediaPipe package version differs from pinned asset manifest');
 await mkdir(cache,{recursive:true});await mkdir(resolve(target,'wasm'),{recursive:true});
 for(const model of manifest.models){let bytes:Uint8Array;
  try{bytes=await readFile(resolve(cache,model.file));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'||!options.download)throw new Error(`Missing cached tracking model ${model.file}; run pnpm exec tsx scripts/prepare-tracking.ts --download once`,{cause:error});
   const response=await fetch(model.url,{redirect:'error',signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`Model download failed: ${response.status}`);bytes=new Uint8Array(await response.arrayBuffer());verify(bytes,model);await writeFile(resolve(cache,model.file),bytes);
  }verify(bytes,model);await writeFile(resolve(target,model.file),bytes);
 }
 for(const wasm of manifest.wasm){const bytes=await readFile(resolve(pkg,'wasm',wasm.file));verify(bytes,wasm);await writeFile(resolve(target,'wasm',wasm.file),bytes);}
 await copyFile(resolve(project,'apps/desktop/src/tracking/NOTICES.md'),resolve(target,'NOTICES.md'));
 await copyFile(resolve(project,'apps/desktop/src/tracking/LICENSE.Apache-2.0.txt'),resolve(target,'LICENSE.Apache-2.0.txt'));
 await writeFile(resolve(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return {models:manifest.models.length,wasmFiles:manifest.wasm.length,version:manifest.version};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await prepareTracking({download:process.argv.includes('--download')}));
