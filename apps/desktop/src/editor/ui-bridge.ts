import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { parseUIMessage, type UIMessage } from './ui-message';
const EVENT='opensekai-editor-ui';
export async function listenUI(receive:(message:UIMessage)=>void){return getCurrentWindow().listen<unknown>(EVENT,event=>{const message=parseUIMessage(event.payload);if(message)receive(message);});}
export function sendUI(target:'main'|'editor',message:UIMessage){return emitTo(target,EVENT,message);}
