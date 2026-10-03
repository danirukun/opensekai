import { invoke } from '@tauri-apps/api/core';
import SessionWorker from '@opensekai/session/worker?worker';
import { connectClient } from '@opensekai/browser-client';
import { createRenderer } from '@opensekai/renderer';
import { makeSmokeScene, ConnectionDescriptorSchema } from '@opensekai/contracts';
import type { AssetRecord, BrowserClient, ConnectionDescriptor, RuntimeFrame } from '@opensekai/contracts';
import { createPreviewPump } from './preview-pump';

export interface NativeBootstrap {
 publisher: ConnectionDescriptor;
 operator: ConnectionDescriptor;
 preview: ConnectionDescriptor;
 output: ConnectionDescriptor;
 operatorDescriptorFile: string;
 rendererDescriptorFile: string;
 assets: AssetRecord[];
 rendererMode: 'auto' | 'force-webgl2';
}
export async function bootstrapDesktop(canvas: HTMLCanvasElement): Promise<{
 client: BrowserClient; outputUrl: string; assets: AssetRecord[]; stop(): Promise<void>;
}> {
 const info = await invoke<NativeBootstrap>('bootstrap_session');
 let worker: Worker | undefined;
 const clients: BrowserClient[] = [];
 let closePreview = () => {};
 let stopped = false;
 const stop = async () => {
  if (stopped) return;
  stopped = true;
  closePreview();
  for (const client of clients) client.close();
  worker?.postMessage({ kind: 'stop' });
  worker?.terminate();
  await invoke('shutdown_session');
 };
 try {
  worker = new SessionWorker();
  for (const descriptor of [info.publisher, info.operator, info.preview, info.output]) {
   ConnectionDescriptorSchema.parse(descriptor);
   if (descriptor.sessionId !== info.publisher.sessionId) throw new Error('Bootstrap session mismatch');
  }
  if (info.publisher.role !== 'publisher' || info.operator.role !== 'operator' ||
      info.preview.role !== 'renderer' || info.preview.outputId !== 'preview_main' ||
      info.output.role !== 'renderer' || info.output.outputId !== 'output_main') {
   throw new Error('Bootstrap connection scope mismatch');
  }
  worker.postMessage({ descriptor: info.publisher, scene: makeSmokeScene() });
  const connected = await Promise.allSettled([connectClient(info.operator), connectClient(info.preview)]);
  for (const result of connected) if (result.status === 'fulfilled') clients.push(result.value);
  for (const result of connected) if (result.status === 'rejected') throw result.reason;
  const [client, preview] = clients;
  const renderer = await createRenderer({ canvas, outputId: 'preview_main', mode: info.rendererMode,
   resources: preview, diagnostics: false, resolutionScale: 0.5 });
  const pump = createPreviewPump<RuntimeFrame>(async frame => {
   const applied = await renderer.applyFrame(frame);
   if (!stopped) preview.sendApplied(applied);
  }, error => {
   const code = (error as { code?: string })?.code;
   if (code !== 'CANCELLED') console.error('Preview submission failed', code ?? 'UNAVAILABLE');
  });
  const off = preview.onFrame(frame => pump.offer(frame));
  closePreview = () => { off(); pump.stop(); renderer.dispose(); };
  const outputUrl = `${new URL(info.output.httpOrigin).origin}/renderer/?diagnostics=1${info.rendererMode === 'force-webgl2' ? '&backend=webgl2' : ''}#${encodeURIComponent(JSON.stringify(info.output))}`;
  return { client, outputUrl, assets: info.assets, stop };
 } catch (error) {
  await stop().catch(() => {});
  throw error;
 }
}
