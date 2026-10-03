import type {ConnectionDescriptor} from '@opensekai/contracts';
export function makeOutputUrl(output:ConnectionDescriptor,mode:'auto'|'force-webgl2'){
 return `${new URL(output.httpOrigin).origin}/renderer/?diagnostics=1${mode==='force-webgl2'?'&backend=webgl2':''}#${encodeURIComponent(JSON.stringify(output))}`;
}
