import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
// Software Vulkan (Mesa lavapipe) gives WebGPU to a container without a GPU.
export const chromiumGpuArgs=['--enable-unsafe-webgpu','--ignore-gpu-blocklist',...(process.platform==='linux'?['--enable-features=Vulkan','--use-angle=vulkan']:[])];
export async function probeGpu(){
 const browser=await chromium.launch({headless:true,args:chromiumGpuArgs});
 try{
  const page=await browser.newPage();
  // WebGPU exists only in a secure context.
  await page.route('https://probe.opensekai.invalid/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
  await page.goto('https://probe.opensekai.invalid/');
  return await page.evaluate(async()=>{
   const gpu=(navigator as Navigator&{gpu?:{requestAdapter():Promise<{info?:Record<string,string>;requestDevice():Promise<{destroy():void}>}|null>}}).gpu;
   const adapter=await gpu?.requestAdapter().catch(()=>null)??null;
   const device=adapter?await adapter.requestDevice().then(d=>{d.destroy();return true;},()=>false):false;
   const gl=document.createElement('canvas').getContext('webgl2');
   const debug=gl?.getExtension('WEBGL_debug_renderer_info');
   return {
    webgpu:adapter?{vendor:adapter.info?.vendor??null,architecture:adapter.info?.architecture??null,description:adapter.info?.description??null,device}:null,
    webgl2:gl?{renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}:null,
   };
  });
 }finally{await browser.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify({browser:chromium.name(),...await probeGpu()}));
