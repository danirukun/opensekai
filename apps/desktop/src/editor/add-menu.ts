import {isMac} from '../blueprints/keystroke-format';
import type {AddKind} from './live-fields';
const ITEMS:[AddKind,string][]=[['camera','Camera'],['character','Character'],['environment','Environment'],['prop','Prop'],['screen','Screen'],['directionalLight','Directional Light'],['pointLight','Point Light'],['spotLight','Spot Light'],['ambientLight','Ambient Light'],['haze','Haze'],['fpsCounter','FPS Counter'],['vmc','VMC Receiver'],['vmcSender','VMC Sender'],['ifacialmocap','iFacialMocap Receiver'],['openseeface','OpenSeeFace Receiver'],['mediapipe','MediaPipe Tracker']];
// FaceKit runs only in the macOS host (TRK-24 B33 R18).
export const addMenuItems=(platform:string):[AddKind,string][]=>isMac(platform)?[...ITEMS,['facekit','FaceKit Tracker']]:[...ITEMS];
