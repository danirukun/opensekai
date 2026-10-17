import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {createRequire} from 'node:module';
// The Khronos glTF validator. Usage: pnpm exec tsx scripts/gltf-validate.ts <file.glb|file.vrm>...
// Exit code 1: a file has validation errors. Warnings do not fail.
type Report={issues:{numErrors:number;numWarnings:number;messages:{code:string;message:string;severity:number;pointer?:string}[]}};
const validator=createRequire(import.meta.url)('gltf-validator') as {validateBytes(data:Uint8Array,options:{maxIssues:number}):Promise<Report>};
let failed=false;
for(const file of process.argv.slice(2)){
 const {issues}=await validator.validateBytes(new Uint8Array(await readFile(file)),{maxIssues:200});
 failed||=issues.numErrors>0;
 console.log(JSON.stringify({file:basename(file),errors:issues.numErrors,warnings:issues.numWarnings,codes:issues.messages.filter(m=>m.severity<=1).reduce<Record<string,number>>((codes,m)=>({...codes,[m.code]:(codes[m.code]??0)+1}),{})}));
}
process.exitCode=failed?1:0;
