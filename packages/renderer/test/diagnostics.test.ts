import { expect,it } from 'vitest';
import { Group,Mesh,BoxGeometry,MeshBasicMaterial } from 'three/webgpu';
import { countLiveMaterials,createDiagnosticsSampler } from '../src/diagnostics';
import { createAssetCache } from '../src/assets';
import { createRenderQueue } from '../src/apply-frame';
it('counts unique reachable materials across shared instances',()=>{const material=new MeshBasicMaterial();const other=new MeshBasicMaterial();const root=new Group();root.add(new Mesh(new BoxGeometry(),material),new Mesh(new BoxGeometry(),[material,other]));expect(countLiveMaterials([root,root])).toBe(2);root.clear();expect(countLiveMaterials([root])).toBe(0);});
it('samples the first render immediately then at most once per second',()=>{const sample=createDiagnosticsSampler();expect(sample(0)).toBe(true);expect(sample(999)).toBe(false);expect(sample(1000)).toBe(true);expect(sample(1000)).toBe(false);});
it('reports asset cache release and live queue work',async()=>{const cache=createAssetCache(async()=>({dispose(){}}));await cache.get('asset');expect(cache.size()).toBe(1);cache.dispose();expect(cache.size()).toBe(0);let release!:()=>void;const queue=createRenderQueue();const job=queue.enqueue('frame',()=>new Promise<void>(resolve=>{release=resolve;}));expect(queue.snapshot()).toEqual({activeRenderJob:true,queuedFrames:0,queuedCaptures:0});release();await job;await Promise.resolve();expect(queue.snapshot().activeRenderJob).toBe(false);queue.dispose();});
