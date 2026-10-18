import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scene, PerspectiveCamera, Object3D } from 'three/webgpu';
import { makeSmokeScene } from '@opensekai/contracts';
import { assertEditorScope, createEditorViewport, createLightHelper, GIZMO_COMMIT_MS, pickRoots, updateLightHelper } from '../src/editor-viewport';
import type { LightSettings } from '@opensekai/contracts';
const mock=vi.hoisted(()=>({controls:null as any}));
vi.mock('three/addons/controls/TransformControls.js',()=>({TransformControls:class {
 listeners=new Map<string,()=>void>(); dragging=false;enabled=false;axis=null;helper=new Object3D();
 constructor(){mock.controls=this;} getHelper(){return this.helper;} attach=vi.fn();detach=vi.fn();dispose=vi.fn();setMode=vi.fn();
 addEventListener(name:string,fn:()=>void){this.listeners.set(name,fn);} removeEventListener(name:string){this.listeners.delete(name);} emit(name:string){this.listeners.get(name)?.();}
}}));
beforeEach(()=>{mock.controls=null;});
function setup(){const canvas=new EventTarget() as HTMLCanvasElement;Object.assign(canvas,{focus:vi.fn(),ownerDocument:{defaultView:new EventTarget()}});const scene=new Scene();const root=new Object3D();root.position.x=20;scene.add(root);const view=makeSmokeScene();const entity=view.entities.find(x=>x.kind!=='camera')!;entity.transform.position=[2,0,0];entity.transform.scale=[1,1,1];const onCommit=vi.fn(async (_edit: unknown)=>({ok:true as const,data:{revision:view.revision+1}}));const onDraft=vi.fn(),onGestureEnd=vi.fn();const editor=createEditorViewport(canvas,new PerspectiveCamera(),scene,new Map([[entity.id,{root}]]),{onSelect:vi.fn(),onCommit,onDraft,onGestureEnd});const state={scene:view,selectedId:entity.id,tool:'translate' as const,enabled:true};editor.sync(state);return {editor,canvas,scene,root,state,onCommit,onDraft,onGestureEnd,id:entity.id};}
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
// Commits that answer only when the test says so, each with the next revision.
function held(x:ReturnType<typeof setup>){const replies:(()=>void)[]=[];let revision=x.state.scene.revision;x.onCommit.mockImplementation(()=>new Promise(resolve=>{replies.push(()=>resolve({ok:true,data:{revision:++revision}}));}));return replies;}
const move=(x:ReturnType<typeof setup>,position:number)=>{x.root.position.x=position;mock.controls.emit('objectChange');};
const escape=(x:ReturnType<typeof setup>)=>{const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:'Escape'});x.canvas.dispatchEvent(event);};
it('rejects production output and diagnostic editor helpers',()=>{expect(()=>assertEditorScope('output_main',false)).toThrow();expect(()=>assertEditorScope('preview_main',true)).toThrow();expect(()=>assertEditorScope('preview_main',false)).not.toThrow();});
it('freezes active roots and commits one persistent delta at captured revision for a drag with one move',async()=>{const x=setup();mock.controls.emit('mouseDown');expect(x.editor.frozen(x.id)).toBe(true);x.root.position.x=23;mock.controls.emit('objectChange');expect(x.onDraft).toHaveBeenLastCalledWith({entityId:x.id,transform:{position:[5,0,0],rotation:[0,0,0,1],scale:[1,1,1]}});mock.controls.emit('mouseUp');mock.controls.emit('mouseUp');await flush();expect(x.onCommit).toHaveBeenCalledTimes(1);expect(x.onCommit.mock.calls[0]![0]).toMatchObject({expectedRevision:x.state.scene.revision,transform:{position:[5,0,0]}});
 // The root keeps the committed pose until a frame with the committed revision arrives (B12 R5).
 expect(x.editor.frozen(x.id)).toBe(true);expect(x.editor.draftTransform(x.id)?.position).toEqual([5,0,0]);x.editor.frame({...x.state.scene,revision:x.state.scene.revision+1});expect(x.editor.frozen(x.id)).toBe(false);expect(x.editor.draftTransform(x.id)).toBeNull();expect(x.onGestureEnd).toHaveBeenCalledOnce();x.editor.dispose();});
it.each(['revision','selection','disabled','escape','blur','pointercancel','lostpointercapture'])('cancels %s without commit',async(reason)=>{const x=setup();mock.controls.emit('mouseDown');x.root.position.x=24;if(reason==='revision')x.editor.sync({...x.state,scene:{...x.state.scene,revision:x.state.scene.revision+1}});else if(reason==='selection')x.editor.sync({...x.state,selectedId:null});else if(reason==='disabled')x.editor.sync({...x.state,enabled:false});else {const event=new Event(reason==='escape'?'keydown':reason);if(reason==='escape')Object.defineProperty(event,'key',{value:'Escape'});x.canvas.dispatchEvent(event);}mock.controls.emit('mouseUp');await Promise.resolve();expect(x.onCommit).not.toHaveBeenCalled();expect(x.root.position.x).toBe(20);expect(x.onDraft).toHaveBeenLastCalledWith(null);x.editor.dispose();});
it('removes owned helper and listeners before release',()=>{const x=setup();const helper=mock.controls.helper;expect(helper.parent).toBe(x.scene);x.editor.dispose();expect(helper.parent).toBe(null);expect(mock.controls.dispose).toHaveBeenCalledOnce();expect(mock.controls.listeners.size).toBe(0);});

it('cancels render-frame revision drift without model sync',()=>{const x=setup();mock.controls.emit('mouseDown');x.editor.frameRevision(x.state.scene.revision+1);mock.controls.emit('mouseUp');expect(x.onCommit).not.toHaveBeenCalled();expect(x.editor.frozen(x.id)).toBe(false);x.editor.dispose();});

it('consumes gesture cancellation Escape while idle Escape can reopen the editor',()=>{
 const x=setup();const idle=new Event('keydown',{cancelable:true});Object.defineProperty(idle,'key',{value:'Escape'});x.canvas.dispatchEvent(idle);expect(idle.defaultPrevented).toBe(false);
 mock.controls.emit('mouseDown');const active=new Event('keydown',{cancelable:true});Object.defineProperty(active,'key',{value:'Escape'});x.canvas.dispatchEvent(active);expect(active.defaultPrevented).toBe(true);expect(x.editor.frozen(x.id)).toBe(false);mock.controls.emit('mouseUp');expect(x.onCommit).not.toHaveBeenCalled();x.editor.dispose();
});
it('does not pick environment roots',()=>{const avatar=new Object3D(),stage=new Object3D(),hidden=new Object3D();hidden.visible=false;expect(pickRoots(new Map([['avatar',{root:avatar}],['stage',{root:stage,pickable:false}],['hidden',{root:hidden}]])).map(([id])=>id)).toEqual(['avatar']);});

describe('live gizmo commits (B12)',()=>{
 afterEach(()=>{vi.useRealTimers();});
 it('sends the latest draft at most every interval and only after the previous reply, then a last commit on release (R1)',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
  const x=setup(),replies=held(x),start=x.state.scene.revision;mock.controls.emit('mouseDown');
  move(x,21);expect(x.onCommit).toHaveBeenCalledTimes(1);
  move(x,22);move(x,23);expect(x.onCommit).toHaveBeenCalledTimes(1);
  replies.shift()!();await flush();expect(x.onCommit).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(GIZMO_COMMIT_MS+2);expect(x.onCommit).toHaveBeenCalledTimes(2);
  expect(x.onCommit.mock.calls[1]![0]).toMatchObject({expectedRevision:start+1,transform:{position:[5,0,0]}});
  move(x,24);mock.controls.emit('mouseUp');replies.shift()!();await flush();
  expect(x.onCommit).toHaveBeenCalledTimes(3);expect(x.onCommit.mock.calls[2]![0]).toMatchObject({expectedRevision:start+2,transform:{position:[6,0,0]}});
  replies.shift()!();await flush();expect(x.onGestureEnd).toHaveBeenCalledOnce();x.editor.dispose();
 });
 it('keeps the gesture through its own revisions and stops on a foreign one without a revert (R2)',async()=>{
  const x=setup(),replies=held(x),start=x.state.scene.revision;mock.controls.emit('mouseDown');move(x,23);
  x.editor.frame({...x.state.scene,revision:start+1});expect(x.editor.frozen(x.id)).toBe(true);
  replies.shift()!();await flush();x.editor.sync({...x.state,scene:{...x.state.scene,revision:start+1}});expect(x.editor.frozen(x.id)).toBe(true);
  x.editor.frame({...x.state.scene,revision:start+5});expect(x.editor.frozen(x.id)).toBe(false);expect(x.root.position.x).toBe(20);
  mock.controls.emit('mouseUp');await flush();expect(x.onCommit).toHaveBeenCalledTimes(1);expect(x.onDraft).toHaveBeenLastCalledWith(null);x.editor.dispose();
 });
 it('puts back the start transform when the user cancels after a sent commit (R3)',async()=>{
  const x=setup(),replies=held(x),start=x.state.scene.revision;mock.controls.emit('mouseDown');move(x,23);
  escape(x);expect(x.root.position.x).toBe(20);expect(x.onDraft).toHaveBeenLastCalledWith(null);expect(x.editor.draftTransform(x.id)?.position).toEqual([2,0,0]);
  replies.shift()!();await flush();expect(x.onCommit).toHaveBeenCalledTimes(2);
  expect(x.onCommit.mock.calls[1]![0]).toMatchObject({expectedRevision:start+1,transform:{position:[2,0,0]}});
  replies.shift()!();await flush();expect(x.onGestureEnd).toHaveBeenCalledOnce();x.editor.dispose();
 });
 it('ends without a retry when a send fails (R4)',async()=>{
  const x=setup();x.onCommit.mockResolvedValueOnce({ok:false,error:{code:'CONFLICT',message:'Scene changed',ids:[]}} as never);
  mock.controls.emit('mouseDown');move(x,23);await flush();expect(x.editor.frozen(x.id)).toBe(false);expect(x.root.position.x).toBe(20);expect(x.onDraft).toHaveBeenLastCalledWith(null);
  move(x,24);mock.controls.emit('mouseUp');await flush();expect(x.onCommit).toHaveBeenCalledTimes(1);x.editor.dispose();
 });
 it('returns the draft during a gesture and nothing for a press without a move (R6)',async()=>{
  const x=setup();expect(x.editor.draftTransform(x.id)).toBeNull();mock.controls.emit('mouseDown');x.root.position.x=26;
  expect(x.editor.draftTransform(x.id)?.position).toEqual([8,0,0]);x.root.position.x=20;
  mock.controls.emit('mouseUp');await flush();expect(x.onCommit).not.toHaveBeenCalled();expect(x.editor.draftTransform(x.id)).toBeNull();expect(x.editor.frozen(x.id)).toBe(false);x.editor.dispose();
 });
});

it('outlines the shadow box of a directional light with a shadow as four line segments (B12 R10)',()=>{
 const light:LightSettings={type:'directional',color:'#ff0000',intensity:3,range:0,affectCharacters:true,affectProps:true,affectEnvironment:true,shadow:{enabled:false,intensity:1,soft:true,bias:-0.0005,normalBias:0.02}};
 const root=createLightHelper(light),box=root.getObjectByName('shadow-box') as Object3D & {isLineSegments?:boolean;geometry:{getAttribute(name:string):{count:number;getX(i:number):number;getY(i:number):number}}};
 expect(box.isLineSegments).toBe(true);expect(box.visible).toBe(false);
 const position=box.geometry.getAttribute('position');expect(position.count).toBe(8);
 expect(Math.max(...Array.from({length:8},(_,i)=>Math.abs(position.getX(i))))).toBe(10);
 updateLightHelper(root,{...light,shadow:{...light.shadow,enabled:true}});expect(box.visible).toBe(true);
 expect(createLightHelper({...light,type:'point'}).getObjectByName('shadow-box')).toBeUndefined();
});
