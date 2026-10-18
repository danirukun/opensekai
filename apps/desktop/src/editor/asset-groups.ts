import type {SceneEntity} from '@opensekai/contracts';
export interface AssetGroup {key:string;label:string;entities:SceneEntity[]}
const categories=[['environment','Environment'],['light','Lights'],['camera','Cameras'],['avatar','Characters'],['mesh','Props'],['vmc','VMC Receivers'],['ifacialmocap','iFacialMocap Receivers'],['mediapipe','MediaPipe Trackers']] as const;
export function groupEntities(entities:readonly SceneEntity[],search=''):AssetGroup[]{
 const query=search.trim().toLowerCase();
 return categories.map(([key,label])=>({key,label,entities:entities.filter(entity=>(entity.kind==='tracking'?entity.config.kind:entity.kind)===key&&entity.name.toLowerCase().includes(query))})).filter(group=>group.entities.length>0);
}
