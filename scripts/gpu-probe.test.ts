import {afterEach,beforeEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {chromiumExecutable} from './gpu-probe';
let root:string;
const binary=async(path:string)=>{await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),'');};
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'opensekai-browsers-'));});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
it('uses the pinned Playwright build when it is installed',async()=>{
 await binary('chromium_headless_shell-1194/chrome-linux/headless_shell');
 expect(await chromiumExecutable({PLAYWRIGHT_BROWSERS_PATH:root},()=>true)).toBeUndefined();
});
it('falls back to the newest preinstalled headless Chromium',async()=>{
 await binary('chromium_headless_shell-1194/chrome-linux/headless_shell');
 await binary('chromium-1194/chrome-linux/chrome');
 await binary('chromium_headless_shell-987/chrome-linux/headless_shell');
 expect(await chromiumExecutable({PLAYWRIGHT_BROWSERS_PATH:root},()=>false)).toBe(join(root,'chromium_headless_shell-1194/chrome-linux/headless_shell'));
});
it('prefers an explicit OPENSEKAI_CHROMIUM',async()=>{
 expect(await chromiumExecutable({OPENSEKAI_CHROMIUM:'/bin/chrome',PLAYWRIGHT_BROWSERS_PATH:root},()=>true)).toBe('/bin/chrome');
});
it('finds nothing without a browser directory',async()=>{
 expect(await chromiumExecutable({},()=>false)).toBeUndefined();
});
