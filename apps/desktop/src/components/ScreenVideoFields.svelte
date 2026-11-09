<script lang="ts">
 import {Button,Select} from '@oshi-connect/ui';
 import type {AssetRecord,ScreenVideo,ScreenVideoAction} from '@opensekai/contracts';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import ResetMark from './ResetMark.svelte';
 import SliderField from './SliderField.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 import {stageLabel} from '../editor/load-status';
 import {sourceAction} from '../editor/environment';
 import {VOLUME_RANGE,videoSourceOptions} from '../editor/screen';
 let {marks=NO_MARKS,video,assets,status=null,importing=false,error=null,disabled=false,sourceDisabled=false,playLabel='Play',onchange,onlive,onliveend,oncontrol,onimport}:{marks?:ResetMarks;video:ScreenVideo;assets:readonly AssetRecord[];status?:AssetLoadStatus|null;importing?:boolean;error?:string|null;disabled?:boolean;sourceDisabled?:boolean;playLabel?:'Play'|'Pause';onchange:(video:ScreenVideo)=>Promise<{ok:boolean}|undefined>|void;onlive?:(video:ScreenVideo)=>void;onliveend?:()=>void;oncontrol:(action:ScreenVideoAction)=>void;onimport:()=>void}=$props();
 let reset=$state(0);
 function change(value:string){const action=sourceAction(value);reset++;if(action.kind==='import')onimport();else void onchange({...video,assetId:action.assetId});}
 // A failed change puts the box back to the scene value.
 async function toggle(box:HTMLInputElement,key:'autoPlay'|'loop'){const reply=await onchange({...video,[key]:box.checked});if(reply&&!reply.ok)box.checked=video[key];}
 const defaults=$derived(marks.defaults);
</script>
<div class="screen-video">
 <div class="resettable">{#key `${video.assetId}:${reset}`}<Select label="Video" value={video.assetId??''} options={videoSourceOptions(video.assetId,assets)} disabled={disabled||sourceDisabled||importing} onchange={event=>change(event.currentTarget.value)}/>{/key}{#if marks.changed.has('video')}<ResetMark label="Video" disabled={marks.disabled||disabled||sourceDisabled||importing} onreset={()=>{void onchange({...video,assetId:null});}}/>{/if}</div>
 {#if importing}<div class="source-status"><span>Importing…</span><progress max="1" aria-label="Importing…"></progress></div>
 {:else if status}<div class="source-status" class:failed={status.stage==='failed'}><span>{stageLabel(status)}</span>{#if status.stage!=='failed'}{#if status.progress===null}<progress max="1" aria-label={stageLabel(status)}></progress>{:else}<progress max="1" value={status.progress} aria-label={stageLabel(status)}></progress>{/if}{/if}</div>{/if}
 {#if error}<p class="source-status failed" role="alert">{error}</p>{/if}
 <div class="resettable"><label class="visibility-control"><input type="checkbox" checked={video.autoPlay} {disabled} onchange={event=>{void toggle(event.currentTarget,'autoPlay');}}/>Auto Play</label>{#if marks.changed.has('autoPlay')}<ResetMark label="Auto Play" disabled={marks.disabled||disabled} onreset={()=>{void onchange({...video,autoPlay:defaults.autoPlay===true});}}/>{/if}</div>
 <div class="resettable"><label class="visibility-control"><input type="checkbox" checked={video.loop} {disabled} onchange={event=>{void toggle(event.currentTarget,'loop');}}/>Loop</label>{#if marks.changed.has('loop')}<ResetMark label="Loop" disabled={marks.disabled||disabled} onreset={()=>{void onchange({...video,loop:defaults.loop!==false});}}/>{/if}</div>
 <div class="resettable"><SliderField label="Volume" value={video.volume} range={VOLUME_RANGE} {disabled} onlive={volume=>onlive?.({...video,volume})} onend={onliveend} oncommit={volume=>{void onchange({...video,volume});}}/>{#if marks.changed.has('volume')}<ResetMark label="Volume" disabled={marks.disabled||disabled} onreset={()=>{void onchange({...video,volume:Number(defaults.volume??1)});}}/>{/if}</div>
 <div class="playback"><Button variant="secondary" disabled={disabled||video.assetId===null} onclick={()=>oncontrol(playLabel==='Pause'?'pause':'play')}>{playLabel}</Button><Button variant="ghost" disabled={disabled||video.assetId===null} onclick={()=>oncontrol('restart')}>Restart</Button></div>
</div>
<style>
 .screen-video{display:grid;gap:8px}
 .playback{display:flex;flex-wrap:wrap;gap:8px}
 .source-status{display:grid;gap:4px;font-size:11px;color:#85818f;margin:0}.source-status.failed{color:#b14050}progress{width:100%;height:5px;accent-color:#8571ac}
</style>
