import type {TrackingStatus} from '@opensekai/contracts';

export interface PacketReading {sourceId:string;generation:number;packets:number;atMs:number}
export interface PacketRate {reading:PacketReading;perSecond:number|null}

/** Packets per second between two status readings. A restart or a new generation makes the rate unknown. */
export function nextPacketRate(previous:PacketRate|null,status:Pick<TrackingStatus,'sourceId'|'generation'|'packets'>,atMs:number,minIntervalMs=250):PacketRate {
 const reading={sourceId:status.sourceId,generation:status.generation,packets:status.packets,atMs};
 const last=previous?.reading;
 if(!last||last.sourceId!==reading.sourceId||last.generation!==reading.generation||reading.packets<last.packets||atMs<last.atMs)return {reading,perSecond:null};
 const elapsed=atMs-last.atMs;
 if(elapsed<minIntervalMs)return previous!;
 return {reading,perSecond:(reading.packets-last.packets)*1000/elapsed};
}
