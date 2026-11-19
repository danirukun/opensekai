import {faceOnlyBodyMotionTemplate,importBlueprint,type Id,type Reply,type SceneView} from '@opensekai/contracts';
import type {BlueprintSync} from '../blueprints/blueprint-sync';
import type {EditorModel} from './model';
import {faceOnlyMotionNeeded,type SetupPlan} from './tracking-guide-plan';

type Plan=Extract<SetupPlan,{ops:unknown[]}>;
export interface AppliedSetup {reply:Awaited<ReturnType<EditorModel['applyOperations']>>;graphId?:Id;graphError?:string}

// The scene patch and the graph edit are two writes on two channels. The graph follows only a patch that succeeded, and a graph failure never fails the setup.
export async function applySetup(model:EditorModel,sync:BlueprintSync|null,scene:SceneView,avatarId:Id,plan:Plan,newId:()=>Id):Promise<AppliedSetup> {
 const reply=await model.applyOperations(plan.ops,scene.revision);
 if(!reply.ok||!sync||!faceOnlyMotionNeeded(scene,avatarId,plan,sync.view()))return {reply};
 const current=model.read().scene??scene;
 // The graph targets the character that the guide checked, never another one.
 const avatar=current.entities.find(entity=>entity.kind==='avatar'&&entity.id===avatarId);
 if(!avatar)return {reply,graphError:'No character'};
 const made=importBlueprint(faceOnlyBodyMotionTemplate({id:avatar.id,name:avatar.name}),current,newId);
 if(!made.ok)return {reply,graphError:made.error.message};
 const edited=sync.edit([{kind:'createGraph',graph:made.data.graph}]);
 return edited.ok?{reply,graphId:made.data.graph.id}:{reply,graphError:edited.error.message};
}

// A graph that is already gone needs no removal.
export function removeGuideGraph(sync:BlueprintSync,graphId:Id):Reply<unknown> {
 return sync.view().some(g=>g.id===graphId)?sync.edit([{kind:'removeGraph',graphId}]):{ok:true,data:null};
}
