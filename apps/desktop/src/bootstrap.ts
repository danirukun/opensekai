import { invoke } from '@tauri-apps/api/core';
import SessionWorker from '@opensekai/session/worker?worker';
import { connectClient } from '@opensekai/browser-client';
import type { EditorOptions, EditorHandle } from '@opensekai/renderer';
import { createRenderer } from '@opensekai/renderer';
import { makeSmokeScene, ConnectionDescriptorSchema, TrackingUpdateSchema } from '@opensekai/contracts';
import type { AssetRecord, BrowserClient, ConnectionDescriptor, RuntimeFrame,TrackingUpdate } from '@opensekai/contracts';
import { makeOutputUrl } from './editor/output-url';
import {makeEmptyScene} from './editor/authoring';
import { createPreviewPump } from './preview-pump';

export interface NativeBootstrap {
 publisher: ConnectionDescriptor;
 operator: ConnectionDescriptor;
 preview: ConnectionDescriptor;
 output: ConnectionDescriptor;
 operatorDescriptorFile: string;
 rendererDescriptorFile: string;
 assets: AssetRecord[];
 fixtureMode:boolean;
 rendererMode: 'auto' | 'force-webgl2';
}
export async function bootstrapDesktop(canvas: HTMLCanvasElement, editorOptions?: EditorOptions): Promise<{
 client: BrowserClient; outputUrl: string; assets: AssetRecord[]; canEdit:boolean; editor?:EditorHandle; tracking:{submit(update:TrackingUpdate):void;now():number|null;onClock(listener:()=>void):()=>void}; stop(): Promise<void>;
}> {
 const info = await invoke<NativeBootstrap>('bootstrap_session');
 let worker: Worker | undefined;
 const clients: BrowserClient[] = [];
 let closePreview = () => {};
 let stopped = false;
 let clockAnchor:{native:number;local:number}|undefined;
 const clockListeners=new Set<()=>void>();
 const tracking={
  submit(update:TrackingUpdate){if(!stopped)worker?.postMessage({kind:'tracking',update:TrackingUpdateSchema.parse(update)});},
  now(){return clockAnchor?clockAnchor.native+Math.max(0,performance.now()-clockAnchor.local):null;},
  onClock(listener:()=>void){clockListeners.add(listener);if(clockAnchor)listener();return()=>{clockListeners.delete(listener);};},
 };
 const stop = async () => {
  if (stopped) return;
  stopped = true;
  closePreview();
  clockListeners.clear();
  clockAnchor=undefined;
  for (const client of clients) client.close();
  worker?.postMessage({ kind: 'stop' });
  worker?.terminate();
  await invoke('shutdown_session');
 };
 try {
  worker = new SessionWorker();
  worker.addEventListener('message',event=>{
   const value=event.data;if(stopped||!value||value.kind!=='clockSync'||!Number.isSafeInteger(value.elapsedMs)||value.elapsedMs<0)return;
   if(clockAnchor&&value.elapsedMs<clockAnchor.native)return;
   clockAnchor={native:value.elapsedMs,local:performance.now()};for(const listener of clockListeners)listener();
  });
  for (const descriptor of [info.publisher, info.operator, info.preview, info.output]) {
   ConnectionDescriptorSchema.parse(descriptor);
   if (descriptor.sessionId !== info.publisher.sessionId) throw new Error('Bootstrap session mismatch');
  }
  if (info.publisher.role !== 'publisher' || info.operator.role !== 'operator' ||
      info.preview.role !== 'renderer' || info.preview.outputId !== 'preview_main' ||
      info.output.role !== 'renderer' || info.output.outputId !== 'output_main') {
   throw new Error('Bootstrap connection scope mismatch');
  }
  worker.postMessage({ descriptor: info.publisher, scene: info.fixtureMode ? makeSmokeScene() : makeEmptyScene() });
  const connected = await Promise.allSettled([connectClient(info.operator), connectClient(info.preview)]);
  for (const result of connected) if (result.status === 'fulfilled') clients.push(result.value);
  for (const result of connected) if (result.status === 'rejected') throw result.reason;
  const [client, preview] = clients;
  const renderer = await createRenderer({ canvas, outputId: 'preview_main', mode: info.rendererMode,
   resources: preview, diagnostics: false, resolutionScale: 0.5,
   editor: info.operator.capabilities.includes('edit') ? editorOptions : undefined });
  const pump = createPreviewPump<RuntimeFrame>(async frame => {
   const applied = await renderer.applyFrame(frame);
   if (!stopped) preview.sendApplied(applied);
  }, error => {
   const code = (error as { code?: string })?.code;
   if (code !== 'CANCELLED') console.error('Preview submission failed', code ?? 'UNAVAILABLE');
  });
  const off = preview.onFrame(frame => pump.offer(frame));
  closePreview = () => { off(); pump.stop(); renderer.dispose(); };
  const outputUrl = makeOutputUrl(info.output,info.rendererMode);
  return { client, outputUrl, assets: info.assets, canEdit:info.operator.capabilities.includes('edit'), editor:renderer.editor, tracking, stop };
 } catch (error) {
  await stop().catch(() => {});
  throw error;
 }
}

export interface NativeEditorConnection { operator:ConnectionDescriptor;output:ConnectionDescriptor;assets:AssetRecord[];rendererMode:'auto'|'force-webgl2' }
export async function bootstrapEditor(){
 const info=await invoke<NativeEditorConnection>('editor_connection');
 for(const descriptor of [info.operator,info.output])ConnectionDescriptorSchema.parse(descriptor);
 if(info.operator.role!=='operator'||info.output.role!=='renderer'||info.output.outputId!=='output_main'||info.operator.sessionId!==info.output.sessionId)throw new Error('Editor connection scope mismatch');
 const client=await connectClient(info.operator);
 const outputUrl=makeOutputUrl(info.output,info.rendererMode);
 return {client,assets:info.assets,outputUrl,canEdit:info.operator.capabilities.includes('edit'),stop(){client.close();}};
}
