import { connectClient } from "@opensekai/browser-client";
import { createRenderer, createDiagnosticsSampler, createFpsCounterOverlay } from "@opensekai/renderer";
import type { AppError } from "@opensekai/contracts";
import { qualityProfileFromQuery } from "@opensekai/contracts";
import { loadRendererDescriptor } from "./descriptor";
async function start() {
    const descriptor = loadRendererDescriptor({
        hash: location.hash,
        origin: location.origin,
        redact: () => history.replaceState(null, "", location.pathname + location.search),
        storage: () => sessionStorage
    });
    const client = await connectClient(descriptor);
    let renderer;
    try {
        renderer = await createRenderer({ canvas: document.querySelector<HTMLCanvasElement>("#output")!, outputId: descriptor.outputId, mode: new URLSearchParams(location.search).get("backend") === "webgl2" ? "force-webgl2" : "auto", resources: client, diagnostics: new URLSearchParams(location.search).get("diagnostics") === "1", quality: qualityProfileFromQuery(new URLSearchParams(location.search).get("quality")) });
    }
    catch (error) {
        client.close();
        throw error;
    }
    const handle = renderer;
    const fpsCounter = createFpsCounterOverlay({ host: document.querySelector<HTMLDivElement>("#overlay")!, canvas: document.querySelector<HTMLCanvasElement>("#output")! });
    const sample = createDiagnosticsSampler();
    const epoch = crypto.randomUUID();
    const diagnostics = new URLSearchParams(location.search).get("diagnostics") === "1";
    const offFrame = client.onFrame(frame => { void handle.applyFrame(frame).then(applied => {
        fpsCounter.frameApplied(frame.scene);
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
    addEventListener("pagehide", () => { offFrame(); offCapture(); fpsCounter.dispose(); handle.dispose(); client.close(); }, { once: true });
}
void start().catch(() => console.error("Output initialization failed"));
