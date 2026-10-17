import { ShowDocumentSchema, type Reply, type SceneView, type ShowDocument } from '@opensekai/contracts';

export async function openShowDocument(
 raw: unknown,
 replace: (scene: SceneView) => Promise<Reply<SceneView>>,
 adopt: (document: ShowDocument) => Promise<void> | void,
): Promise<Reply<SceneView>> {
 const document = ShowDocumentSchema.parse(raw);
 const reply = await replace(document.scene);
 if (reply.ok) await adopt(document);
 return reply;
}

/** The show state at the last Open, Save, or editor start. */
export interface ShowMark { name: string; revision: number | null; blueprintRevision: number | undefined }

export function showDirty(saved: ShowMark | null, current: ShowMark): boolean {
 if (!saved || current.revision === null) return false;
 return saved.name !== current.name || saved.revision !== current.revision || saved.blueprintRevision !== current.blueprintRevision;
}
