import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
// Builds fixture_test_stage with Blender. Usage: pnpm build:test-stage [--out <file.glb>]
// BLENDER sets the Blender binary. The contract is spdd/prompt/2026-10-18-test-stage.md.
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=resolve(root,'fixtures/local/cache/test-stage');
const polyhaven='https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_02';
// PolyHaven "Concrete Floor 02" by Rob Tuytel, CC0. Pinned by SHA-256.
const maps=[
 {file:'concrete_floor_02_diff_1k.jpg',sha256:'6db84a6d87dc50508b9d134d6fbd2b7e876b8081a5f43a118a249ca18de73af5'},
 {file:'concrete_floor_02_nor_gl_1k.jpg',sha256:'fcda391b57a816d646ae15544688be53790478da5cd48dbe514b3c6901415e61'},
 {file:'concrete_floor_02_rough_1k.jpg',sha256:'c7f026a611b7859903c61ec7fd4574944157223e9e7796413dd6e2a66eaeac7a'},
];
const sha256=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const argument=(name:string)=>{const i=process.argv.indexOf(`--${name}`);return i<0?undefined:process.argv[i+1];};
async function fetchMap(map:{file:string;sha256:string}){
 const path=resolve(cache,map.file);
 try{if(sha256(await readFile(path))===map.sha256)return;}catch{}
 const response=await fetch(`${polyhaven}/${map.file}`,{headers:{'user-agent':'opensekai-test-stage'}});
 if(!response.ok)throw new Error(`PolyHaven download failed: ${map.file} ${response.status}`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(sha256(bytes)!==map.sha256)throw new Error(`PolyHaven map failed integrity check: ${map.file}`);
 await writeFile(`${path}.part`,bytes);await rename(`${path}.part`,path);
}
const run=(command:string,args:string[])=>{
 const result=spawnSync(command,args,{stdio:'inherit'});
 if(result.status!==0)throw new Error(`${command} failed with status ${result.status ?? result.signal}`);
};
await mkdir(cache,{recursive:true});
await Promise.all(maps.map(fetchMap));
// Not fixtures/local/test-stage.glb: that path holds the pinned fixture revision, and a rebuild is not byte-identical.
const out=resolve(argument('out')??resolve(cache,'test-stage.glb'));
run(process.env.BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',
 ['--background','--factory-startup','--python-exit-code','1','--python',resolve(root,'scripts/test-stage/build_test_stage.py'),'--','--out',out,'--maps',cache]);
run(process.execPath,['--import','tsx',resolve(root,'scripts/gltf-validate.ts'),out]);
const bytes=await readFile(out);
console.log(JSON.stringify({file:out,bytes:bytes.byteLength,sha256:sha256(bytes)}));
