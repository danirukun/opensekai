import {chromium} from 'playwright';
import {existsSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
// Software Vulkan (Mesa lavapipe) gives WebGPU to a container without a GPU.
export const chromiumGpuArgs=['--enable-unsafe-webgpu','--ignore-gpu-blocklist',...(process.platform==='linux'?['--enable-features=Vulkan','--use-angle=vulkan']:[])];
const headlessBinaries=['chrome-headless-shell-linux64/chrome-headless-shell','chrome-linux/headless_shell','chrome-linux64/chrome','chrome-linux/chrome'];
// The pinned Playwright build, or else the newest Chromium in PLAYWRIGHT_BROWSERS_PATH: the cloud network can block the Playwright download.
export async function chromiumExecutable(env=process.env,pinned=()=>existsSync(chromium.executablePath())):Promise<string|undefined>{
 if(env.OPENSEKAI_CHROMIUM)return env.OPENSEKAI_CHROMIUM;
 if(pinned())return undefined;
 const root=env.PLAYWRIGHT_BROWSERS_PATH;if(!root)return undefined;
 const builds=(await readdir(root).catch(()=>[])).filter(d=>/^chromium(_headless_shell)?-\d+$/.test(d)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1])||Number(b.includes('headless'))-Number(a.includes('headless')));
 return builds.flatMap(build=>headlessBinaries.map(binary=>join(root,build,binary))).find(path=>existsSync(path));
}
export async function launchChromium(){return chromium.launch({headless:true,args:chromiumGpuArgs,executablePath:await chromiumExecutable()});}
export async function probeGpu(){
 const browser=await launchChromium();
 try{
  const page=await browser.newPage();
  // WebGPU exists only in a secure context.
  await page.route('https://probe.opensekai.invalid/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
  await page.goto('https://probe.opensekai.invalid/');
  const result=await page.evaluate(async()=>{
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
  return {chromium:browser.version(),...result};
 }finally{await browser.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await probeGpu()));
