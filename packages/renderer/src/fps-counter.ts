import type { FpsCounterCorner, FpsCounterSettings, SceneView } from "@opensekai/contracts";

// The FPS Counter asset (B19). Each renderer client counts its own completed frames and shows the
// value in one DOM element over its canvas, so the value never reaches the canvas, a capture, or the session.
export const FPS_WINDOW_MS = 1000;
export const FPS_UPDATE_MS = 500;
const OUTPUT_HEIGHT = 1080;

export interface FpsMeter { start: number | null; times: readonly number[] }
export const EMPTY_METER: FpsMeter = { start: null, times: [] };

const inWindow = (times: readonly number[], now: number) => times.filter(time => time > now - FPS_WINDOW_MS);
export const recordFrame = (meter: FpsMeter, now: number): FpsMeter => ({ start: meter.start ?? now, times: [...inWindow(meter.times, now), now] });
// null is unknown: no full window has passed since the first frame.
export const readFps = (meter: FpsMeter, now: number): number | null =>
    meter.start === null || now - meter.start < FPS_WINDOW_MS ? null : inWindow(meter.times, now).length;

export interface FpsCounterView { text: string; corner: FpsCounterCorner; fontPx: number; marginPx: number; color: string }
export function counterView(settings: FpsCounterSettings, fps: number | null, canvasHeight: number): FpsCounterView {
    const k = canvasHeight / OUTPUT_HEIGHT;
    return { text: `${fps === null ? "--" : fps} FPS`, corner: settings.corner, fontPx: Math.round(settings.size * k), marginPx: Math.round(settings.size * k / 2), color: settings.color };
}
export const visibleCounter = (scene: SceneView): FpsCounterSettings | null => {
    const entity = scene.entities.find(entity => entity.kind === "fpsCounter" && entity.visible);
    return entity?.kind === "fpsCounter" ? entity.fpsCounter : null;
};

export interface FpsCounterOverlayOptions {
    host: HTMLElement;
    canvas: { clientHeight: number };
    now?: () => number;
    setInterval?: (run: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
}
export interface FpsCounterOverlay { frameApplied(scene: SceneView): void; dispose(): void }

const sameSettings = (a: FpsCounterSettings | null, b: FpsCounterSettings) => a !== null && a.corner === b.corner && a.size === b.size && a.color === b.color;
const applyView = (element: HTMLElement, view: FpsCounterView) => {
    const top = view.corner === "topLeft" || view.corner === "topRight";
    const left = view.corner === "topLeft" || view.corner === "bottomLeft";
    const margin = `${view.marginPx}px`;
    element.textContent = view.text;
    Object.assign(element.style, {
        top: top ? margin : "", bottom: top ? "" : margin, left: left ? margin : "", right: left ? "" : margin,
        fontSize: `${view.fontPx}px`, color: view.color,
    });
};

export function createFpsCounterOverlay({ host, canvas, now = () => performance.now(), setInterval = globalThis.setInterval, clearInterval = handle => globalThis.clearInterval(handle as number) }: FpsCounterOverlayOptions): FpsCounterOverlay {
    let meter = EMPTY_METER, settings: FpsCounterSettings | null = null, element: HTMLElement | null = null, timer: unknown = null;
    const render = () => { if (element && settings) applyView(element, counterView(settings, readFps(meter, now()), canvas.clientHeight)); };
    const hide = () => {
        if (timer !== null) clearInterval(timer);
        element?.remove();
        meter = EMPTY_METER; settings = null; element = null; timer = null;
    };
    return {
        // Call only after a successful applyFrame (B19 R8).
        frameApplied(scene) {
            const next = visibleCounter(scene);
            if (!next) { hide(); return; }
            meter = recordFrame(meter, now());
            if (!element) {
                element = host.ownerDocument.createElement("div");
                element.setAttribute("aria-hidden", "true");
                Object.assign(element.style, { position: "absolute", fontFamily: "system-ui, sans-serif", fontWeight: "600", lineHeight: "1", fontVariantNumeric: "tabular-nums", textShadow: "0 1px 2px rgba(0, 0, 0, 0.8), 0 0 4px rgba(0, 0, 0, 0.6)", pointerEvents: "none", whiteSpace: "nowrap" });
                host.appendChild(element);
                timer = setInterval(render, FPS_UPDATE_MS);
                settings = next; render();
            } else if (!sameSettings(settings, next)) { settings = next; render(); }
        },
        dispose: hide,
    };
}
