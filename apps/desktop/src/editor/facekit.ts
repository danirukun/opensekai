import type {TrackingStatus} from '@opensekai/contracts';
import type {CameraDevice} from '../tracking/mediapipe';
import {fitDevices} from '../tracking/hidden-cameras';
// The editor-only FaceKit commands (TRK-24 B33): the host camera list and the Camera pane of System Settings.
export interface FaceKitCommands {list:()=>Promise<unknown>;openSettings:()=>Promise<void>}
const isCamera=(value:unknown):value is CameraDevice=>{
 const item=value as Partial<CameraDevice>|null;
 return typeof item==='object'&&item!==null&&typeof item.deviceId==='string'&&item.deviceId.length>=1&&item.deviceId.length<=512&&typeof item.label==='string';
};
// The limits of the browser camera list: 16 devices, 4096 bytes, labels of 128 characters.
export const parseCameraList=(value:unknown):CameraDevice[]=>Array.isArray(value)?fitDevices(value.filter(isCamera).map(({deviceId,label})=>({deviceId,label:label.slice(0,128)}))):[];
export const trackingStateLabel=(state:TrackingStatus['state']):string=>state==='permissionNeeded'?'permission needed':state;
