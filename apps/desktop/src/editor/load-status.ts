import type {AssetLoadStatus} from '@opensekai/renderer';
export function stageLabel(entry:AssetLoadStatus):string{
 if(entry.stage==='download')return 'Downloading';
 if(entry.stage==='textures')return entry.count?`Textures ${entry.count.done} of ${entry.count.total}`:'Textures';
 if(entry.stage==='prepare')return 'Preparing';
 return entry.message??'Load failed';
}
