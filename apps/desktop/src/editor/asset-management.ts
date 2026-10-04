import type {SceneEntity} from '@opensekai/contracts';
export function makeEntityCopy(entity:SceneEntity,id:string,entities:readonly SceneEntity[]):SceneEntity {
 const copy=structuredClone(entity),names=new Set(entities.map(item=>item.name));
 const base=entity.name.slice(0,116).trim()||'Asset';
 let name=`${base} Copy`,index=2;
 while(names.has(name))name=`${base} Copy ${index++}`;
 copy.id=id;copy.name=name;
 if(copy.kind==='tracking'){copy.config.enabled=false;copy.generation=0;}
 if(copy.kind==='avatar')copy.tracking={bodySourceId:null,faceSourceId:null};
 return copy;
}
