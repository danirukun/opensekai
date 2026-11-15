import {isMac} from '../blueprints/keystroke-format';
import type {AddKind} from './live-fields';
export interface AddMenuEntry {kind:AddKind;label:string;group:string}
const ITEMS:AddMenuEntry[]=[
 {kind:'camera',label:'Camera',group:'scene'},
 {kind:'character',label:'Character',group:'scene'},
 {kind:'environment',label:'Environment',group:'scene'},
 {kind:'prop',label:'Prop',group:'scene'},
 {kind:'screen',label:'Screen',group:'scene'},
 {kind:'directionalLight',label:'Directional Light',group:'light'},
 {kind:'pointLight',label:'Point Light',group:'light'},
 {kind:'spotLight',label:'Spot Light',group:'light'},
 {kind:'ambientLight',label:'Ambient Light',group:'light'},
 {kind:'haze',label:'Haze',group:'light'},
 {kind:'fpsCounter',label:'FPS Counter',group:'overlay'},
 {kind:'vmc',label:'VMC Receiver',group:'tracking'},
 {kind:'vmcSender',label:'VMC Sender',group:'tracking'},
 {kind:'ifacialmocap',label:'iFacialMocap Receiver',group:'tracking'},
 {kind:'openseeface',label:'OpenSeeFace Receiver',group:'tracking'},
 {kind:'mediapipe',label:'MediaPipe Tracker',group:'tracking'}
];
const FACEKIT:AddMenuEntry={kind:'facekit',label:'FaceKit Tracker',group:'tracking'};
// FaceKit runs only in the macOS host (TRK-24 B33 R18).
export const addMenuEntries=(platform:string):AddMenuEntry[]=>isMac(platform)?[...ITEMS,FACEKIT]:[...ITEMS];
export const addMenuItems=(platform:string):[AddKind,string][]=>addMenuEntries(platform).map(entry=>[entry.kind,entry.label]);
