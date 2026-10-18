<script lang="ts">
 import {Button} from '@oshi-connect/ui';
 import {DEFAULT_TRACKING_SMOOTHING,TrackingSmoothingSchema,type TrackingSmoothing} from '@opensekai/contracts';
 import type {Commit} from '../editor/live-fields';
 import {SLIDERS} from '../editor/slider';
 import SliderField from './SliderField.svelte';
 let {entityId,smoothing,revision,disabled=false,oncommit,onlive,onliveend}:{entityId:string;smoothing?:TrackingSmoothing;revision:number;disabled?:boolean;oncommit?:Commit<TrackingSmoothing>;onlive?:(id:string,smoothing:TrackingSmoothing)=>void;onliveend?:()=>void}=$props();
 const effective=$derived(smoothing??DEFAULT_TRACKING_SMOOTHING);
 type Key='minCutoff'|'beta'|'derivativeCutoff';
 // Each slider commits live (B12 R15), so the group has no Apply.
 const withValue=(key:Key,value:number):TrackingSmoothing|null=>{const parsed=TrackingSmoothingSchema.safeParse({...effective,[key]:value});return parsed.success?parsed.data:null;};
 const slider=(key:Key)=>({disabled:disabled||!effective.enabled,onlive:(value:number)=>{const next=withValue(key,value);if(next)onlive?.(entityId,next);},onend:onliveend,oncommit:(value:number)=>{const next=withValue(key,value);if(next)void oncommit?.(entityId,next,revision);}});
</script>
<fieldset class="smoothing" disabled={disabled||!oncommit}>
 <legend>Smoothing</legend>
 <label class="option"><input type="checkbox" checked={effective.enabled} onchange={event=>{void oncommit?.(entityId,{...effective,enabled:event.currentTarget.checked},revision);}}/>Enabled</label>
 <div title="Higher cutoff allows more motion with less smoothing."><SliderField label="Min cutoff (Hz)" value={effective.minCutoff} range={SLIDERS.cutoff} {...slider('minCutoff')}/></div>
 <div title="Higher beta responds faster to rapid motion."><SliderField label="Beta" value={effective.beta} range={SLIDERS.beta} {...slider('beta')}/></div>
 <div title="Derivative cutoff controls velocity smoothing."><SliderField label="Derivative cutoff (Hz)" value={effective.derivativeCutoff} range={SLIDERS.cutoff} {...slider('derivativeCutoff')}/></div>
 <Button type="button" variant="ghost" onclick={()=>{void oncommit?.(entityId,{...DEFAULT_TRACKING_SMOOTHING},revision);}}>Reset</Button>
</fieldset>
<style>fieldset{display:grid;gap:10px;border:0;padding:0;margin:0;min-width:0}legend{font-size:12px;margin-bottom:8px}.option{display:flex;gap:8px;align-items:center;font-size:12px}</style>
