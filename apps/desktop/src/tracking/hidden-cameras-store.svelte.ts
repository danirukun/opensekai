import {createHiddenCameras,type WorkerPort} from './hidden-cameras';

const storage=(()=>{try{return globalThis.localStorage??null;}catch{return null;}})();
const controller=createHiddenCameras({spawn:()=>new Worker(new URL('./hidden-cameras-worker.ts',import.meta.url),{type:'module'}) as unknown as WorkerPort,storage});
let current=$state(controller.state());
controller.subscribe(next=>{current=next;});
// One module store, so each inspector instance shows the same list.
export const hiddenCameras={get state(){return current;},setText:controller.setText,restoreDefaults:controller.restoreDefaults,setDevices:controller.setDevices};
