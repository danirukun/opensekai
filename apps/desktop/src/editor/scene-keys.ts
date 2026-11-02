import type {Tool} from './ui-message';
const TOOLS:Record<string,Tool>={w:'translate',e:'rotate',r:'scale'};
export function toolForKey(key:{key:string;modifier:boolean;editableTarget:boolean},state:{assetsShown:boolean;editable:boolean}):Tool|null{
 if(key.modifier||key.editableTarget||!state.assetsShown||!state.editable)return null;
 return TOOLS[key.key.toLowerCase()]??null;
}
