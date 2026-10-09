import {it,expect,vi,type Mock} from 'vitest';
import {createLoadJobs,type LoadRequest,type LoadReport} from '../src/load-jobs';
type Value={id:string;dispose:Mock<() => void>};
function harness(){
 const pending=new Map<string,{resolve:(v:Value)=>void;reject:(e:unknown)=>void;report:(r:LoadReport)=>void}>();
 const values:Value[]=[];
 const start=vi.fn((request:LoadRequest,report:(r:LoadReport)=>void)=>new Promise<Value>((resolve,reject)=>{pending.set(request.assetId,{resolve,reject,report});}));
 const onStatus=vi.fn();
 const jobs=createLoadJobs<Value>(start,onStatus);
 const finish=async(assetId:string)=>{const v={id:assetId,dispose:vi.fn()};values.push(v);pending.get(assetId)!.resolve(v);await new Promise(r=>setTimeout(r,0));return v;};
 const fail=async(assetId:string,message:string)=>{pending.get(assetId)!.reject(new Error(message));await new Promise(r=>setTimeout(r,0));};
 return {jobs,start,onStatus,pending,finish,fail};
}
const need=(entries:[string,string][])=>new Map(entries.map(([entity,asset])=>[entity,{kind:'avatar' as const,assetId:asset}]));
it('starts one job per request and reports stages until it is complete',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['char','a']]));h.jobs.reconcile(need([['char','a']]));
 expect(h.start).toHaveBeenCalledTimes(1);
 expect(h.jobs.status()).toEqual([{entityId:'char',assetId:'a',stage:'download',progress:null}]);
 h.pending.get('a')!.report({stage:'textures',progress:.5,count:{done:12,total:24}});
 expect(h.onStatus).toHaveBeenLastCalledWith([{entityId:'char',assetId:'a',stage:'textures',progress:.5,count:{done:12,total:24}}]);
 const v=await h.finish('a');
 expect(h.jobs.status()).toEqual([]);expect(h.onStatus).toHaveBeenLastCalledWith([]);
 expect(h.jobs.take('char')).toBe(v);expect(h.jobs.take('char')).toBeUndefined();
});
it('replaces a pending job and disposes its late result',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['char','a']]));h.jobs.reconcile(need([['char','b']]));h.jobs.reconcile(need([['char','c']]));
 expect(h.start).toHaveBeenCalledTimes(3);
 const a=await h.finish('a'),b=await h.finish('b'),c=await h.finish('c');
 expect(a.dispose).toHaveBeenCalledOnce();expect(b.dispose).toHaveBeenCalledOnce();expect(c.dispose).not.toHaveBeenCalled();
 expect(h.jobs.take('char')).toBe(c);
});
it('cancels a job whose entity is gone and disposes a complete untaken result',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['one','a'],['two','b']]));
 const b=await h.finish('b');
 h.jobs.reconcile(need([]));
 expect(b.dispose).toHaveBeenCalledOnce();
 const a=await h.finish('a');
 expect(a.dispose).toHaveBeenCalledOnce();expect(h.jobs.take('one')).toBeUndefined();expect(h.jobs.status()).toEqual([]);
});
it('keeps separate jobs for two entities with one asset',async()=>{
 const resolvers:((v:Value)=>void)[]=[];
 const start=vi.fn(()=>new Promise<Value>(r=>{resolvers.push(r);}));
 const jobs=createLoadJobs<Value>(start,vi.fn());
 jobs.reconcile(need([['one','a'],['two','a']]));
 expect(start).toHaveBeenCalledTimes(2);expect(jobs.status().map(s=>s.entityId)).toEqual(['one','two']);
 const one={id:'a',dispose:vi.fn()};resolvers[0]!(one);await new Promise(r=>setTimeout(r,0));
 expect(jobs.status().map(s=>s.entityId)).toEqual(['two']);expect(jobs.take('one')).toBe(one);expect(jobs.take('two')).toBeUndefined();
});
it('does not restart a failed job and hides it after dismiss',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['char','a']]));await h.fail('a','Asset unavailable');
 h.jobs.reconcile(need([['char','a']]));
 expect(h.start).toHaveBeenCalledTimes(1);
 expect(h.jobs.status()).toEqual([{entityId:'char',assetId:'a',stage:'failed',progress:null,message:'Asset unavailable'}]);
 expect(h.jobs.failure('char')).toBe('Asset unavailable');
 h.jobs.dismiss('char');
 expect(h.jobs.status()).toEqual([]);expect(h.jobs.failure('char')).toBe('Asset unavailable');
 h.jobs.reconcile(need([['char','b']]));
 expect(h.start).toHaveBeenCalledTimes(2);expect(h.jobs.failure('char')).toBeUndefined();
});
it('lists asset IDs of live jobs and disposes everything on dispose',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['one','a'],['two','b']]));
 expect(h.jobs.assetIds()).toEqual(new Set(['a','b']));
 const b=await h.finish('b');
 h.jobs.dispose();
 expect(b.dispose).toHaveBeenCalledOnce();
 const a=await h.finish('a');expect(a.dispose).toHaveBeenCalledOnce();
 h.jobs.reconcile(need([['one','c']]));expect(h.start).toHaveBeenCalledTimes(2);
});
it('does not call onStatus after dispose',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['one','a'],['two','b'],['three','c']]));
 h.jobs.dispose();
 h.onStatus.mockClear();
 h.pending.get('a')!.report({stage:'prepare',progress:.1});
 await h.finish('b');await h.fail('c','late');
 expect(h.onStatus).not.toHaveBeenCalled();
});
it('does not call onStatus when reconcile changes nothing',()=>{
 const h=harness();
 h.jobs.reconcile(need([['char','a']]));
 h.onStatus.mockClear();
 h.jobs.reconcile(need([['char','a']]));
 expect(h.onStatus).not.toHaveBeenCalled();
});
it('turns a synchronous start throw into a failed job',()=>{
 const onStatus=vi.fn();
 const jobs=createLoadJobs<Value>(()=>{throw new Error('boom');},onStatus);
 expect(()=>jobs.reconcile(need([['char','a']]))).not.toThrow();
 return Promise.resolve().then(()=>{
  expect(jobs.status()).toEqual([{entityId:'char',assetId:'a',stage:'failed',progress:null,message:'boom'}]);
  expect(jobs.failure('char')).toBe('boom');
 });
});
it('does not dispose a taken value when its entity is later removed',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['char','a']]));
 const v=await h.finish('a');
 expect(h.jobs.take('char')).toBe(v);
 h.jobs.reconcile(need([]));
 expect(v.dispose).not.toHaveBeenCalled();
});
it('ignores a report after cancellation',()=>{
 const h=harness();
 h.jobs.reconcile(need([['char','a']]));
 h.jobs.reconcile(need([]));
 h.onStatus.mockClear();
 h.pending.get('a')!.report({stage:'textures',progress:.5});
 expect(h.onStatus).not.toHaveBeenCalled();expect(h.jobs.status()).toEqual([]);
});
