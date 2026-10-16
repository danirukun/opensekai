import {DEFAULT_QUALITY_PROFILE,type ConnectionDescriptor,type QualityProfileId} from '@opensekai/contracts';
export function makeOutputUrl(output:ConnectionDescriptor,mode:'auto'|'force-webgl2'){
 return `${new URL(output.httpOrigin).origin}/renderer/${mode==='force-webgl2'?'?backend=webgl2':''}#${encodeURIComponent(JSON.stringify(output))}`;
}
// The default profile adds no parameter, so the URL of an existing OBS source stays valid.
export function withQualityProfile(url:string,quality:QualityProfileId){
 if(!url)return url;
 const parsed=new URL(url);
 if(quality===DEFAULT_QUALITY_PROFILE)parsed.searchParams.delete('quality');else parsed.searchParams.set('quality',quality);
 return parsed.toString();
}
