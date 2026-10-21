import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import SessionWorker from '@opensekai/session/worker?worker';
import { connectClient } from '@opensekai/browser-client';
import type { EditorOptions, EditorHandle, AssetLoadStatus } from '@opensekai/renderer';
import { createFpsCounterOverlay, createRenderer } from '@opensekai/renderer';
import { makeSmokeScene, AssetRecordSchema, ConnectionDescriptorSchema, TrackingUpdateSchema, QUALITY_PROFILES } from '@opensekai/contracts';
import type { AppError, AssetRecord, BrowserClient, ConnectionDescriptor, RuntimeFrame,TrackingUpdate } from '@opensekai/contracts';
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
export interface PreviewFrameProbe { begin(): boolean; end(): void }
export async function bootstrapDesktop(canvas: HTMLCanvasElement, editorOptions?: EditorOptions, previewProbe?: PreviewFrameProbe, counterHost?: HTMLElement): Promise<{
 client: BrowserClient; outputUrl: string; assets: AssetRecord[]; canEdit:boolean; editor?:EditorHandle; tracking:{submit(update:TrackingUpdate):void;now():number|null;onClock(listener:()=>void):()=>void}; onLoadStatus(listener:(entries:AssetLoadStatus[])=>void):()=>void;dismissLoad(entityId:string):void; stop(): Promise<void>;
}> {
 const info = await invoke<NativeBootstrap>('bootstrap_session');
 let worker: Worker | undefined;
 const clients: BrowserClient[] = [];
 let closePreview = () => {};
 let stopRecords = () => {};
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
  stopRecords();
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
  let records = info.assets;
  worker.postMessage({ descriptor: info.publisher, scene: info.fixtureMode ? makeSmokeScene() : makeEmptyScene(), assets: records });
  // The Editor imports models; the host announces each new record so the session knows its expressions.
  const unlisten = listen<unknown>('asset-record', event => {
   const parsed = AssetRecordSchema.safeParse(event.payload);
   if (stopped || !parsed.success) return;
   records = [...records.filter(record => record.id !== parsed.data.id), parsed.data];
   worker?.postMessage({ kind: 'assets', records });
  });
  stopRecords = () => { void unlisten.then(off => off()).catch(() => {}); };
  const connected = await Promise.allSettled([connectClient(info.operator), connectClient(info.preview)]);
  for (const result of connected) if (result.status === 'fulfilled') clients.push(result.value);
  for (const result of connected) if (result.status === 'rejected') throw result.reason;
  const [client, preview] = clients;
  const renderer = await createRenderer({ canvas, outputId: 'preview_main', mode: info.rendererMode,
   resources: preview, diagnostics: false, quality: QUALITY_PROFILES.preview_v1,
   editor: info.operator.capabilities.includes('edit') ? editorOptions : undefined });
  const fpsCounter = counterHost ? createFpsCounterOverlay({ host: counterHost, canvas }) : null;
  const pump = createPreviewPump<RuntimeFrame>(async frame => {
   const measuring = previewProbe?.begin() ?? false;
   try {
    const applied = await renderer.applyFrame(frame);
    if (!stopped) { fpsCounter?.frameApplied(frame.scene); preview.sendApplied(applied); }
   } finally {
    if (measuring) previewProbe?.end();
   }
  }, error => {
   const code = (error as { code?: string })?.code;
   if (code !== 'CANCELLED') console.error('Preview submission failed', code ?? 'UNAVAILABLE');
  });
  const off = preview.onFrame(frame => pump.offer(frame));
  // The host relays cameraScreenshot to this preview_main renderer; the PNG goes back over the WebSocket, not Tauri IPC.
  const offScreenshot = preview.onScreenshot(async params => {
   try { return { ok: true, data: await renderer.screenshot(params.cameraId, params.expectedRevision) }; }
   catch (error) {
    const e = error as Partial<AppError>;
    return { ok: false, error: { code: e.code ?? 'UNAVAILABLE', message: e.code ? e.message ?? 'Screenshot failed' : 'Screenshot failed', ids: e.ids ?? [] } };
   }
  });
  closePreview = () => { off(); offScreenshot(); pump.stop(); fpsCounter?.dispose(); renderer.dispose(); };
  const outputUrl = makeOutputUrl(info.output,info.rendererMode);
  return { client, outputUrl, assets: info.assets, canEdit:info.operator.capabilities.includes('edit'), editor:renderer.editor, tracking, onLoadStatus:renderer.onLoadStatus, dismissLoad:renderer.dismissLoad, stop };
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
