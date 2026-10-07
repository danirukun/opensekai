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
