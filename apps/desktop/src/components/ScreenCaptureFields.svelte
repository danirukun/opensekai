<script lang="ts">
 import {Button,Select} from '@oshi-connect/ui';
 import type {CaptureState,Reply,ScreenCapture} from '@opensekai/contracts';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 import {PERMISSION_NEEDED,chooseSource,type CaptureCommands,parseSourceList,sourceDescription,sourceForValue,sourceOptions,type CaptureSourceList} from '../editor/capture';
 // The Display and Window fields of a screen (B31 R17). The list comes from the host each time the select opens.
 let {marks=NO_MARKS,capture,hostState=null,message=null,commands,disabled=false,oncommit}:{marks?:ResetMarks;capture:ScreenCapture;hostState?:CaptureState|null;message?:string|null;commands:CaptureCommands;disabled?:boolean;oncommit:(next:ScreenCapture)=>Promise<Reply<unknown>|undefined>}=$props();
 let list=$state<CaptureSourceList>({sources:[],error:null}),loaded=$state(false),loading=false,failed=$state<string|null>(null),reset=$state(0);
 async function load(){if(loading)return;loading=true;try{list=parseSourceList(await commands.list());}catch{list={sources:[],error:null};}finally{loading=false;loaded=true;}}
 $effect(()=>{void capture.target;void load();});
 const select=$derived(sourceOptions(capture.target,capture.source,list.sources));
 const opens=(node:HTMLElement)=>{const open=()=>{void load();};node.addEventListener('pointerdown',open);node.addEventListener('focusin',open);return()=>{node.removeEventListener('pointerdown',open);node.removeEventListener('focusin',open);};};
 async function run(action:()=>Promise<unknown>){failed=null;try{await action();}catch{failed='Capture failed';}}
 function change(value:string){reset++;const source=value===''?null:sourceForValue(value,list.sources);if(value!==''&&source===null)return;void run(()=>chooseSource({allow:commands.allow,commit:oncommit},capture,source));}
 const status=$derived(failed??(hostState==='notAllowed'?null:loaded&&select.missing&&list.error===null?'Source not found':message));
</script>
<fieldset class="screen-capture" {disabled}>
 {#key `${capture.target}:${select.value}:${reset}`}<div {@attach opens}><Select label="Source" value={select.value} options={select.options} {disabled} state={list.error||status?'error':'default'} helperText={list.error??status??undefined} onchange={event=>change(event.currentTarget.value)}/></div>{/key}
 {#if list.error===PERMISSION_NEEDED}<Button type="button" variant="secondary" {disabled} onclick={()=>void run(commands.openSettings)}>Open Settings</Button>{/if}
 {#if hostState==='notAllowed'&&capture.source}<div class="allow"><span>{sourceDescription(capture.source)}</span><Button type="button" variant="primary" {disabled} onclick={()=>void run(()=>commands.allow(capture.source!))}>Allow</Button></div>{/if}
 <div class="resettable"><label class="visibility-control"><input type="checkbox" checked={capture.cursor} onchange={async event=>{const box=event.currentTarget;const reply=await oncommit({...capture,cursor:box.checked});if(!reply?.ok)box.checked=capture.cursor;}}/>Show Cursor</label>{#if marks.changed.has('cursor')}<ResetMark label="Show Cursor" disabled={marks.disabled||disabled} onreset={()=>void oncommit({...capture,cursor:true})}/>{/if}</div>
</fieldset>
<style>
 .screen-capture{display:grid;gap:10px;border:0;padding:0;margin:0;min-width:0}
 .allow{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
 .allow span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
