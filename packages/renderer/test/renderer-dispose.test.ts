import { expect, it, vi } from 'vitest';
import { Object3D } from 'three/webgpu';
import { QUALITY_PROFILES, makeSmokeFrame } from '@opensekai/contracts';
import { createRenderer } from '../src/renderer';
const ports=vi.hoisted(()=>({controls:null as any,render:vi.fn(),dispose:vi.fn()}));
vi.mock('../src/backend',()=>({initializeBackend:async()=>({backend:'webgl2',renderer:{shadowMap:{enabled:false},setSize:vi.fn(),renderAsync:ports.render,compileAsync:vi.fn(async()=>{}),dispose:ports.dispose}})}));
vi.mock('three/addons/controls/TransformControls.js',()=>({TransformControls:class {
 listeners=new Map<string,()=>void>();dragging=false;enabled=false;axis=null;helper=new Object3D();
 constructor(){ports.controls=this;}getHelper(){return this.helper;}attach=vi.fn();detach=vi.fn();dispose=vi.fn();setMode=vi.fn();
 addEventListener(name:string,fn:()=>void){this.listeners.set(name,fn);}removeEventListener(name:string){this.listeners.delete(name);}emit(name:string){this.listeners.get(name)?.();}
}}));
it('stops editor interaction immediately while pending GPU work retains resources',async()=>{
 ports.render.mockReset().mockResolvedValue(undefined);ports.dispose.mockClear();
 const canvas=new EventTarget() as HTMLCanvasElement;Object.assign(canvas,{width:1920,height:1080,focus:vi.fn(),ownerDocument:{defaultView:new EventTarget()}});
 const onCommit=vi.fn(async()=>({ok:true as const,data:{revision:1}}));const onDraft=vi.fn();
 const renderer=await createRenderer({canvas,outputId:'preview_main',mode:'force-webgl2',resources:{readAsset:vi.fn()},diagnostics:false,quality: QUALITY_PROFILES.production_v1,editor:{onSelect:vi.fn(),onCommit,onDraft}});
 const frame=makeSmokeFrame({sequence:1,tick:1});frame.scene.entities=frame.scene.entities.filter(x=>x.kind==='camera' || (x.kind==='mesh' && x.source.kind==='box'));
 await renderer.applyFrame(frame);const id=frame.scene.entities.find(x=>x.kind==='mesh')!.id;
 renderer.editor!.sync({scene:frame.scene,selectedId:id,tool:'translate',enabled:true});ports.controls.emit('mouseDown');
 let settle!:()=>void;ports.render.mockImplementationOnce(()=>new Promise<void>(resolve=>{settle=resolve;}));
 const pending=renderer.applyFrame({...frame,sequence:2,tick:2});const result=pending.then(()=>null,error=>error as {code:string});
 renderer.dispose();renderer.dispose();
 try {
 expect(ports.controls.dispose).toHaveBeenCalledOnce();expect(ports.controls.helper.parent).toBe(null);expect(ports.controls.listeners.size).toBe(0);expect(onDraft).toHaveBeenLastCalledWith(null);
 ports.controls.emit('mouseUp');expect(onCommit).not.toHaveBeenCalled();expect(ports.dispose).not.toHaveBeenCalled();
 } finally {settle();await result;}
 expect(await result).toMatchObject({code:'CANCELLED'});expect(ports.dispose).toHaveBeenCalledOnce();expect(ports.controls.dispose).toHaveBeenCalledOnce();
});
