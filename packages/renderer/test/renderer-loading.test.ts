import {it,expect,vi,beforeEach} from 'vitest';
import {Group,Object3D} from 'three/webgpu';
import {makeSmokeFrame,type RuntimeFrame} from '@opensekai/contracts';
const ports=vi.hoisted(()=>({load:vi.fn(),render:vi.fn(),compile:vi.fn()}));
vi.mock('../src/backend',()=>({initializeBackend:async()=>({backend:'webgl2',renderer:{info:{memory:{geometries:0,textures:0}},setSize:vi.fn(),renderAsync:ports.render,compileAsync:ports.compile,dispose:vi.fn()}})}));
vi.mock('../src/assets',async original=>({...await original<typeof import('../src/assets')>(),createAssetLoader:()=>ports.load}));
vi.mock('../src/avatar-pose',()=>({createAvatarBinding:(vrm:{root:Group})=>({root:vrm.root,apply:vi.fn()})}));
import {createRenderer} from '../src/renderer';
const settle=()=>new Promise(r=>setTimeout(r,0));
let sequence=0;
function frame(assetId:string|null,withAvatar=true):RuntimeFrame{
 const f=makeSmokeFrame({sequence:++sequence,tick:sequence});
 f.scene.entities=f.scene.entities.filter(e=>e.kind==='camera'||(withAvatar&&e.kind==='avatar'));
 for(const e of f.scene.entities)if(e.kind==='avatar')e.assetId=assetId;
 return f;
}
function deferred(){let resolve!:(v:unknown)=>void,reject!:(e:unknown)=>void;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const asset=(root=new Group())=>({root,value:{scene:root,vrm:{root},warnings:[],dispose:vi.fn()}});
const rendered=()=>ports.render.mock.lastCall![0] as Group;
beforeEach(()=>{ports.load.mockReset();ports.render.mockReset().mockResolvedValue(undefined);ports.compile.mockReset().mockResolvedValue(undefined);});
async function make(){return createRenderer({canvas:{width:1920,height:1080} as HTMLCanvasElement,outputId:'output_main',mode:'force-webgl2',resources:{readAsset:vi.fn()},diagnostics:false,resolutionScale:1});}

it('renders frames while a model loads and installs it after GPU preparation',async()=>{
 const pending=deferred();ports.load.mockReturnValue(pending.promise);
 const a=asset();
 const r=await make();const statuses:unknown[]=[];r.onLoadStatus(s=>statuses.push(s));
 await r.applyFrame(frame('avatar_a'));
 expect(rendered().getObjectById(a.root.id)).toBeUndefined();
 expect(statuses.at(-1)).toEqual([expect.objectContaining({entityId:'performer',assetId:'avatar_a',stage:'download'})]);
 pending.resolve(a.value);await settle();
 expect(ports.compile).toHaveBeenCalledWith(a.root,expect.anything(),expect.anything());
 await r.applyFrame(frame('avatar_a'));
 expect(rendered().getObjectById(a.root.id)).toBe(a.root);
 expect(statuses.at(-1)).toEqual([]);
 expect(ports.load).toHaveBeenCalledTimes(1);
 r.dispose();
});
it('keeps the old model until the new model is ready',async()=>{
 const first=asset(),second=asset(),pending=deferred();
 ports.load.mockResolvedValueOnce(first.value).mockReturnValueOnce(pending.promise);
 const r=await make();
 await r.applyFrame(frame('avatar_a'));await settle();await r.applyFrame(frame('avatar_a'));
 await r.applyFrame(frame('avatar_b'));
 expect(rendered().getObjectById(first.root.id)).toBe(first.root);
 pending.resolve(second.value);await settle();
 await r.applyFrame(frame('avatar_b'));
 expect(rendered().getObjectById(first.root.id)).toBeUndefined();
 expect(rendered().getObjectById(second.root.id)).toBe(second.root);
 expect(first.value.dispose).toHaveBeenCalledOnce();
 r.dispose();
});
it('disposes a model whose character was removed during load',async()=>{
 const a=asset(),pending=deferred();ports.load.mockReturnValue(pending.promise);
 const r=await make();
 await r.applyFrame(frame('avatar_a'));
 await r.applyFrame(frame('avatar_a',false));
 pending.resolve(a.value);await settle();
 await r.applyFrame(frame('avatar_a',false));
 expect(a.value.dispose).toHaveBeenCalledOnce();
 expect(rendered().getObjectById(a.root.id)).toBeUndefined();
 r.dispose();
});
it('reports a failed load once, warns each frame, and does not retry',async()=>{
 ports.load.mockRejectedValue(new Error('Asset unavailable'));
 const r=await make();let last:unknown;r.onLoadStatus(s=>{last=s;});
 await r.applyFrame(frame('avatar_x'));await settle();
 const applied=await r.applyFrame(frame('avatar_x'));
 expect(last).toEqual([expect.objectContaining({stage:'failed',message:'Asset unavailable'})]);
 expect(applied.warnings).toEqual(expect.arrayContaining([expect.objectContaining({code:'UNAVAILABLE',ids:['avatar_x']})]));
 await r.applyFrame(frame('avatar_x'));
 expect(ports.load).toHaveBeenCalledTimes(1);
 r.dismissLoad('performer');expect(last).toEqual([]);
 r.dispose();
});
it('loads nothing for a character with no model',async()=>{
 const r=await make();
 await r.applyFrame(frame(null));
 expect(ports.load).not.toHaveBeenCalled();
 expect(rendered().children.some(child=>child.type==='Group')).toBe(false);
 r.dispose();
});
it('does not install a model until GPU preparation resolves',async()=>{
 const a=asset(),compiling=deferred();
 ports.load.mockResolvedValue(a.value);ports.compile.mockReturnValue(compiling.promise);
 const r=await make();
 await r.applyFrame(frame('avatar_a'));await settle();
 await r.applyFrame(frame('avatar_a'));
 expect(rendered().getObjectById(a.root.id)).toBeUndefined();
 compiling.resolve(undefined);await settle();
 await r.applyFrame(frame('avatar_a'));
 expect(rendered().getObjectById(a.root.id)).toBe(a.root);
 r.dispose();
});
it('compiles without frustum culling and restores it',async()=>{
 const a=asset(),child=new Object3D();child.frustumCulled=true;a.root.add(child);
 const during:boolean[]=[];
 ports.compile.mockImplementation(async()=>{during.push(child.frustumCulled);});
 ports.load.mockResolvedValue(a.value);
 const r=await make();
 await r.applyFrame(frame('avatar_a'));await settle();
 expect(during).toEqual([false]);
 expect(child.frustumCulled).toBe(true);
 r.dispose();
});
it('skips GPU preparation for a load that finishes after dispose',async()=>{
 const a=asset(),pending=deferred();ports.load.mockReturnValue(pending.promise);
 const r=await make();
 await r.applyFrame(frame('avatar_a'));
 r.dispose();
 pending.resolve(a.value);await settle();
 expect(ports.compile).not.toHaveBeenCalled();
 expect(a.value.dispose).toHaveBeenCalledOnce();
});
it('skips GPU preparation for a load whose character was removed',async()=>{
 const a=asset(),pending=deferred();ports.load.mockReturnValue(pending.promise);
 const r=await make();
 await r.applyFrame(frame('avatar_a'));await r.applyFrame(frame('avatar_a',false));
 pending.resolve(a.value);await settle();
 expect(ports.compile).not.toHaveBeenCalled();
 expect(a.value.dispose).toHaveBeenCalledOnce();
 r.dispose();
});
