import {it,expect} from 'vitest';
import {join} from 'node:path';
import {inventory,readEntries,safeJoin,type Read} from './warudo-sceneshare';
const text=(s:string)=>{const b=new TextEncoder().encode(s),h=new Uint8Array(4);new DataView(h.buffer).setInt32(0,b.length,true);return [h,b];};
const entry=(tag:string,path:string,data:Uint8Array)=>{const n=new Uint8Array(8);new DataView(n.buffer).setBigInt64(0,BigInt(data.length),true);return [...text(tag),...text(path),n,data];};
const join8=(parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
const reader=(b:Uint8Array):Read=>async(o,l)=>b.slice(o,o+l);
const port=(value:unknown,defaultValue:unknown=value)=>({type:'x',value:JSON.stringify(value),defaultValue:JSON.stringify(defaultValue)});
it('lists the entries of a sceneshare file and the byte range of each payload',async()=>{
 const file=join8([...entry('LOCAL_ASSET','Props/Box.warudo',new Uint8Array([85,77,79,68])),...entry('SCENE_JSON','Scenes/S.scene',new TextEncoder().encode('{}'))]);
 const entries=await readEntries(reader(file),file.length);
 expect(entries.map(e=>[e.tag,e.path,e.length])).toEqual([['LOCAL_ASSET','Props/Box.warudo',4],['SCENE_JSON','Scenes/S.scene',2]]);
 expect(file.slice(entries[0]!.offset,entries[0]!.offset+4)).toEqual(new Uint8Array([85,77,79,68]));
});
it('rejects an entry that is longer than the file',async()=>{
 const file=join8(entry('LOCAL_ASSET','a.warudo',new Uint8Array(4))).slice(0,-1);
 await expect(readEntries(reader(file),file.length)).rejects.toThrow('runs past the end');
});
it('keeps unpacked paths inside the target folder',()=>{
 expect(safeJoin('/out','Props/Box.warudo')).toBe(join('/out','Props/Box.warudo'));
 expect(()=>safeJoin('/out','../escape')).toThrow('Unsafe');
 expect(()=>safeJoin('/out','/etc/passwd')).toThrow('Unsafe');
});
it('reports asset types, changed ports with decoded values, transforms, and blueprint node counts',()=>{
 const transform={dataInputs:{Position:port({x:1,y:2,z:3}),Rotation:port({x:0,y:90,z:0}),Scale:port({x:1,y:1,z:1})}};
 const scene={name:'S',appVersion:'0.14.3',requiredPlugins:[{name:'Mirror',steamID:'1',pluginID:null}],requiredLocalAssets:[{localPath:'Props/Box.warudo'}],plugins:{'Warudo.Core':{}},
  assets:[{typeId:'6a05ecf3-1501-4cab-b9d7-84131b881a29',name:'CU',active:true,dataInputs:{
   ControlMode:port({label:'Orbit Character',value:2,icon:'<svg/>'},{label:'Free Look',value:1}),FieldOfView:port(35),
   FocusCharacter:port({id:'c1',name:'Bonnie'},null),Transform:{type:'t',value:JSON.stringify(transform),defaultValue:null}}}],
  graphs:[{name:'G',enabled:true,nodes:{a:{typeId:'1',name:'ON_UPDATE'},b:{typeId:'2',name:'ON_UPDATE'}}}]};
 const inv=inventory(scene);
 expect(inv.assetTypes).toEqual({Camera:1});
 expect(inv.assets[0]).toMatchObject({type:'Camera',transform:{position:{x:1,y:2,z:3},rotation:{x:0,y:90,z:0}},changed:{ControlMode:'Orbit Character',FocusCharacter:{asset:'Bonnie'}}});
 expect(inv.assets[0]!.changed).not.toHaveProperty('FieldOfView');
 expect(inv.graphs).toEqual([{name:'G',enabled:true,nodeCount:2,nodes:{ON_UPDATE:2}}]);
 expect(inv.requiredPlugins).toEqual([{name:'Mirror',id:null,steamID:'1'}]);
});
