import { connectClient } from "@opensekai/browser-client";
import { createRenderer, createDiagnosticsSampler } from "@opensekai/renderer";
import type { ConnectionDescriptor, AppError } from "@opensekai/contracts";
async function start() {
    const fragment = location.hash.slice(1);
    history.replaceState(null, "", location.pathname + location.search);
    if (!fragment)
        throw new Error("Renderer descriptor missing");
    const descriptor = JSON.parse(decodeURIComponent(fragment)) as ConnectionDescriptor;
    if (descriptor.role !== "renderer" || !descriptor.outputId)
        throw new Error("Renderer descriptor required");
    const client = await connectClient(descriptor);
    let renderer;
    try {
        renderer = await createRenderer({ canvas: document.querySelector<HTMLCanvasElement>("#output")!, outputId: descriptor.outputId, mode: new URLSearchParams(location.search).get("backend") === "webgl2" ? "force-webgl2" : "auto", resources: client, diagnostics: new URLSearchParams(location.search).get("diagnostics") === "1", resolutionScale: new URLSearchParams(location.search).get("scale") === "0.5" ? 0.5 : 1 });
    }
    catch (error) {
        client.close();
        throw error;
    }
    const handle = renderer;
    const sample = createDiagnosticsSampler();
    const epoch = crypto.randomUUID();
    const diagnostics = new URLSearchParams(location.search).get("diagnostics") === "1";
    const offFrame = client.onFrame(frame => { void handle.applyFrame(frame).then(applied => {
        client.sendApplied(applied);
        if (diagnostics && sample(performance.now())) {
            const snapshot = handle.diagnostics?.(epoch);
            if (snapshot) client.sendDiagnostics?.(snapshot);
        }
    }).catch(error => { if (error?.code !== "CANCELLED")
        console.error("Frame application failed", error?.code ?? "UNAVAILABLE"); }); });
    const offCapture = client.onCapture(async (params) => { try {
        const capture = await handle.capture();
        if (capture.frame.revision !== params.expectedRevision)
            return { ok: false, error: { code: "CONFLICT", message: "Displayed revision changed", ids: [] } };
        return { ok: true, data: capture };
    }
    catch (error) {
        const e = error as Partial<AppError>;
        return { ok: false, error: { code: e.code ?? "UNAVAILABLE", message: e.message ?? "Capture failed", ids: e.ids ?? [] } };
    } });
    addEventListener("pagehide", () => { offFrame(); offCapture(); handle.dispose(); client.close(); }, { once: true });
}
void start().catch(error => console.error("Output initialization failed", error instanceof Error ? error.message : "Unknown failure"));
