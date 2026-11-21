<script lang="ts">
 import type {AssetDebug,AssetRecord} from '@opensekai/contracts';
 import {Button,Select} from '@oshi-connect/ui';
 import SearchInput from './SearchInput.svelte';
 import {COUNT_LABELS,debugCopy,formatBytes,textureRows} from '../editor/avatar-debug';
 // Character Debug section (R3–R12): read-only data of the loaded file.
 let {debug,record}:{debug:AssetDebug|null;record:AssetRecord|null}=$props();
 let picked=$state('0'),search=$state(''),copyError=$state(false);
 const info=$derived(debug?.info??null);
 const material=$derived(info?.materials.find(entry=>String(entry.index)===picked)??info?.materials[0]??null);
 const query=$derived(search.trim().toLowerCase());
 const properties=$derived(material?.properties.filter(row=>row.name.toLowerCase().includes(query))??[]);
 const textures=$derived(material&&debug?textureRows(material,debug):[]);
 const fileRows=$derived(info?[
  ['VRM',info.format.vrm],['Generator',info.format.generator],['glTF',info.format.gltf],
  ['Size',record?formatBytes(record.bytes):null],['SHA-256',record?.sha256??null],
 ].filter((row):row is [string,string]=>row[1]!==null):[]);
 const materialRows=$derived(material?[
  ['Profile',material.profile],
  ...(material.unsupported.length>0?[['Unsupported',material.unsupported.join(', ')]]:[]),
  ...(material.extensions.length>0?[['Extensions',material.extensions.join(', ')]]:[]),
  ['Alpha mode',material.alphaMode],['Cull',material.cull],
  ...(material.lilToon?[['lilToon spec',material.lilToon.specVersion],['lilToon version',material.lilToon.lilToonVersion],['Shader variant',material.lilToon.shaderVariant],['Queue',material.lilToon.renderQueue===null?null:String(material.lilToon.renderQueue)]]:[]),
 ].filter((row):row is [string,string]=>row[1]!==null):[]);
 const copy=async()=>{
  if(!debug)return;
  try{await navigator.clipboard.writeText(JSON.stringify(debugCopy(debug,record),null,2));copyError=false;}catch{copyError=true;}
 };
</script>
<div class="debug">
 {#if info&&debug}
  <dl>{#each fileRows as [term,value]}<dt>{term}</dt><dd>{value}</dd>{/each}</dl>
  {#if info.extensions.length>0}<h4>Extensions</h4><ul>{#each info.extensions as extension}<li>{extension.name}{#if extension.required}<span class="muted"> required</span>{/if}</li>{/each}</ul>{/if}
  {#if info.meta.length>0}<h4>Meta</h4><dl>{#each info.meta as row}<dt>{row.name}</dt><dd>{row.value}</dd>{/each}</dl>{/if}
  <h4>Counts</h4><dl>{#each info.counts as count}<dt>{COUNT_LABELS[count.key]??count.key}</dt><dd>{count.value}</dd>{/each}</dl>
  {#if material}
   <Select label="Material" value={String(material.index)} options={info.materials.map(entry=>({value:String(entry.index),label:entry.name}))} onchange={event=>{picked=event.currentTarget.value;}}/>
   <dl>{#each materialRows as [term,value]}<dt>{term}</dt><dd>{value}</dd>{/each}</dl>
   {#if textures.length>0}<h4>Textures</h4><dl>{#each textures as texture}<dt>{texture.slot}</dt><dd>{[texture.name,texture.width!==null?`${texture.width} × ${texture.height}`:null,texture.colorSpace,texture.mimeType,texture.bytes!==null?formatBytes(texture.bytes):null].filter(Boolean).join(' · ')}</dd>{/each}</dl>{/if}
   <h4>Properties</h4>
   <SearchInput label="Search properties" placeholder="Search" bind:value={search}/>
   <dl class="properties">{#each properties as row}<dt>{row.name}</dt><dd>{row.value}</dd>{/each}</dl>
  {/if}
  {#if debug.warnings.length>0}<h4>Warnings</h4><ul>{#each debug.warnings as warning}<li>{warning.message}</li>{/each}</ul>{/if}
 {/if}
 <div><Button variant="secondary" disabled={!debug} onclick={copy}>Copy JSON</Button></div>
 {#if copyError}<p role="alert">Copy failed</p>{/if}
</div>
<style>
 .debug{display:grid;gap:10px;min-width:0}
 h4{margin:4px 0 0;font-size:12px;font-weight:600;color:var(--ds-color-text)}
 dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 16px;margin:0;font-size:12px}
 dt{color:var(--ds-color-text-muted)}
 dd{margin:0;font-variant-numeric:tabular-nums;color:var(--ds-color-text);overflow-wrap:anywhere}
 ul{margin:0;padding:0;list-style:none;display:grid;gap:4px;font-size:12px;overflow-wrap:anywhere}
 .muted{color:var(--ds-color-text-muted)}
 dt{overflow-wrap:anywhere}
 .properties{grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:4px 12px;max-height:320px;overflow:auto;font-family:var(--ds-font-mono,ui-monospace,monospace);font-size:11px}
 p{margin:0;font-size:12px}
</style>
