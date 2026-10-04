import { expect, it, vi } from 'vitest';
import { Texture } from 'three/webgpu';
import { createImageResizePolicy } from '../src/image-resize';
function image(width: number, height: number) { return {width,height,close:vi.fn()} as unknown as ImageBitmap & {close:ReturnType<typeof vi.fn>}; }
it('caps decoded images before upload with aspect ratio preserved and original released', async () => {
 const original=image(8192,4096), resized=image(2048,1024), texture=new Texture(original);
 const resize=vi.fn(async()=>resized), policy=createImageResizePolicy(2048,resize);
 const result=await policy.decode(async()=>texture);
 expect(resize).toHaveBeenCalledWith(original,{resizeWidth:2048,resizeHeight:1024,resizeQuality:'high'});
 expect(result.image).toBe(resized);expect(original.close).toHaveBeenCalledTimes(1);expect(resized.close).not.toHaveBeenCalled();
});
it('caps portrait preview images and retains already bounded images',async()=>{
 const resize=vi.fn(async()=>image(256,1024)),policy=createImageResizePolicy(1024,resize);
 const portrait=image(2048,8192);await policy.decode(async()=>new Texture(portrait));
 expect(resize).toHaveBeenCalledWith(portrait,{resizeWidth:256,resizeHeight:1024,resizeQuality:'high'});
 const small=image(512,256),texture=new Texture(small);expect(await policy.decode(async()=>texture)).toBe(texture);
 expect(resize).toHaveBeenCalledTimes(1);expect(small.close).not.toHaveBeenCalled();
});
it('reports resize failure and releases decoded resources instead of accepting a missing image',async()=>{
 const original=image(4096,4096),texture=new Texture(original),dispose=vi.spyOn(texture,'dispose');
 const policy=createImageResizePolicy(2048,async()=>{throw new Error('resize failed');});
 await expect(policy.decode(async()=>texture)).rejects.toMatchObject({code:'UNSUPPORTED'});
 expect(dispose).toHaveBeenCalledTimes(1);expect(original.close).toHaveBeenCalledTimes(1);
});
it('bounds simultaneous decode work to two and releases the queue after errors',async()=>{
 const policy=createImageResizePolicy(2048), resolvers:Array<(texture:Texture)=>void>=[];
 let active=0,peak=0;
 const decode=vi.fn(()=>{active++;peak=Math.max(peak,active);return new Promise<Texture>(resolve=>resolvers.push(texture=>{active--;resolve(texture);}));});
 const pending=[policy.decode(decode),policy.decode(decode),policy.decode(decode)];
 await Promise.resolve();await Promise.resolve();expect(decode).toHaveBeenCalledTimes(2);
 resolvers[0]!(new Texture(image(1,1)));await pending[0];await Promise.resolve();
 expect(decode).toHaveBeenCalledTimes(3);resolvers[1]!(new Texture(image(1,1)));resolvers[2]!(new Texture(image(1,1)));
 await Promise.all(pending);expect(peak).toBe(2);
 await expect(policy.decode(async()=>{throw new Error('decode failed');})).rejects.toThrow('decode failed');
 await policy.decode(async()=>new Texture(image(1,1)));
});
