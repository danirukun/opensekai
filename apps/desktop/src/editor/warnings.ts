import type {AppStatus,AppError} from '@opensekai/contracts';
export function collectWarnings(status:Pick<AppStatus,'warnings'|'outputs'>|null):AppError[]{
 const seen=new Set<string>();
 return [...(status?.warnings??[]),...(status?.outputs.flatMap(output=>output.lastFrame?.warnings??[])??[])].filter(warning=>{const key=JSON.stringify([warning.code,warning.message,warning.ids]);if(seen.has(key))return false;seen.add(key);return true;});
}
