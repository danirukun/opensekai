import { DoubleSide, Matrix4, Mesh, MeshBasicNodeMaterial, NoBlending, PerspectiveCamera, PlaneGeometry, Scene, Vector4, type Object3D } from "three/webgpu";
import { vec4 } from "three/tsl";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { LIMITS, isWebScreenUrl, type Id, type SceneView } from "@opensekai/contracts";

/** The page DOM layers of one renderer instance (B30 R5): `back` is behind the canvas and `front` is in front of it. */
export interface WebLayers { back: HTMLElement; front: HTMLElement; interactive: boolean }
/** One web screen that a renderer instance shows (B30 E). `href` is the parsed URL; a screen without a valid URL has no entry. */
export interface WebScreenPlan { entityId: Id; href: string; width: number; height: number; onTop: boolean; visible: boolean }

// The parsed href can be longer than the stored URL (the parser percent-encodes some characters), so both must pass the rule.
const frameHref = (url: string | null) => {
    if (url === null || !isWebScreenUrl(url)) return null;
    const href = new URL(url).href;
    return isWebScreenUrl(href) ? href : null;
};
/** The web screens of a scene, in scene order. A null URL, or a URL or parsed href that fails the rule, gives no entry (R6, R12). */
export const webScreenPlan = (scene: Pick<SceneView, "entities">): WebScreenPlan[] =>
    scene.entities.flatMap(entity => {
        if (entity.kind !== "screen" || entity.content.kind !== "web") return [];
        const href = frameHref(entity.content.url);
        return href ? [{ entityId: entity.id, href, width: entity.content.width, height: entity.content.height, onTop: entity.content.onTop, visible: entity.visible }] : [];
    }).slice(0, LIMITS.webScreens);

/** The quad width for a 1 m high page (R7, R8). */
export const webQuadWidth = (content: { width: number; height: number }) => content.width / content.height;

const corner = new Vector4(), toView = new Matrix4();
/**
 * True when each of the 4 quad corners is in front of the camera near plane (R7). For a perspective camera, the clip
 * space `w` of a point is its distance in front of the camera, so the check is `w > near`.
 */
export function quadInFront(world: Matrix4, viewInverse: Matrix4, aspect: number, near: number): boolean {
    toView.multiplyMatrices(viewInverse, world);
    for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const) {
        corner.set(x * aspect, y, 0, 1).applyMatrix4(toView);
        if (-corner.z <= near) return false;
    }
    return true;
}

export interface FrameAttributes { attributes: Record<string, string>; style: Record<string, string> }
/** The attributes and the style of the iframe of one web screen (R6). No sandbox token other than these three. */
export function frameAttributes(plan: Pick<WebScreenPlan, "href" | "width" | "height">, interactive: boolean): FrameAttributes {
    return {
        attributes: {
            src: plan.href,
            sandbox: "allow-scripts allow-same-origin allow-forms",
            referrerpolicy: "no-referrer",
            ...(interactive ? { allow: "autoplay" } : { tabindex: "-1" })
        },
        style: {
            width: `${plan.width}px`, height: `${plan.height}px`, border: "0", background: "transparent", "color-scheme": "normal",
            "pointer-events": interactive ? "auto" : "none", "backface-visibility": "visible"
        }
    };
}

const applyStyle = (element: HTMLElement, style: Record<string, string>) => { for (const [name, value] of Object.entries(style)) element.style.setProperty(name, value); };

/**
 * The hole (R8, `onTop: false`): an unlit quad that writes depth and RGBA (0, 0, 0, 0), so the canvas is transparent
 * where the screen is the front-most surface. The diffuse alpha stays 1: three 0.180 discards an alpha-0 fragment when
 * the blending is not NormalBlending, and a discarded fragment writes no depth.
 */
export function createHoleMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial({ side: DoubleSide, blending: NoBlending, transparent: false, depthWrite: true, depthTest: true });
    material.outputNode = vec4(0, 0, 0, 0);
    material.fog = false;
    material.toneMapped = false;
    return material;
}
/** A quad that draws nothing and stays a pick target (R8 `onTop: true`, R9 null URL). */
export function createPickMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial({ side: DoubleSide, colorWrite: false, depthWrite: false });
    material.fog = false;
    material.toneMapped = false;
    return material;
}
/** The quad of a web screen: 1 m high and `aspect` m wide, in the local XY plane (R8). It casts and receives no shadow. */
export function createWebQuad(aspect: number, hole: boolean): { root: Mesh; dispose(): void } {
    const geometry = new PlaneGeometry(aspect, 1);
    const material = hole ? createHoleMaterial() : createPickMaterial();
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return { root: mesh, dispose() { geometry.dispose(); material.dispose(); mesh.removeFromParent(); } };
}

interface Frame { plan: WebScreenPlan; object: CSS3DObject; element: HTMLIFrameElement }
/**
 * The CSS world is the scene scaled by this factor. A uniform scale does not change the projection, and it keeps the
 * CSS scale of each iframe near 1 (here 1000 / height). Headless Chromium does not paint a cross-origin iframe with a
 * CSS scale of 1 / height when a second one is in the same 3D context.
 */
export const CSS_WORLD_SCALE = 1000;
/** The view matrix of the camera in the CSS world: the translation scales, the rotation does not. */
export function cssViewMatrix(viewInverse: Matrix4, target = new Matrix4()): Matrix4 {
    target.copy(viewInverse);
    for (const i of [12, 13, 14]) target.elements[i]! *= CSS_WORLD_SCALE;
    return target;
}
/** What one layer render needs: the quad root of each web screen, the camera, and the logical and CSS sizes (R7). */
export interface WebLayerFrame {
    plans: readonly WebScreenPlan[];
    root(entityId: Id): Object3D | undefined;
    camera: PerspectiveCamera;
    width: number; height: number;
    cssWidth: number; cssHeight: number;
    selectedId: Id | null;
}

/**
 * The two page layers of one renderer instance (R5, R6, R7). Each layer has one CSS3DRenderer with its own scene. The
 * renderer never reads the iframe document and never posts a message to it (R12).
 */
export function createWebLayers(layers: WebLayers) {
    const make = (host: HTMLElement) => {
        const renderer = new CSS3DRenderer();
        const element = renderer.domElement;
        applyStyle(element, { position: "absolute", left: "0", top: "0", "transform-origin": "0 0", "pointer-events": "none", "color-scheme": "normal", background: "transparent" });
        applyStyle(host, { overflow: "hidden", "pointer-events": "none", "color-scheme": "normal", background: "transparent" });
        host.append(element);
        return { renderer, scene: new Scene(), element };
    };
    const back = make(layers.back), front = make(layers.front);
    const frames = new Map<Id, Frame>();
    const scale = new Matrix4(), world = new Matrix4().makeScale(CSS_WORLD_SCALE, CSS_WORLD_SCALE, CSS_WORLD_SCALE);
    // CSS3DRenderer reads the projection and the view matrix of this camera; its matrices are set on each render.
    const cssCamera = new PerspectiveCamera();
    cssCamera.matrixAutoUpdate = false;
    cssCamera.matrixWorldAutoUpdate = false;
    const remove = (id: Id) => { const frame = frames.get(id); if (!frame) return; frame.object.removeFromParent(); frame.element.remove(); frames.delete(id); };
    const build = (plan: WebScreenPlan): Frame => {
        const element = layers.back.ownerDocument.createElement("iframe");
        const { attributes, style } = frameAttributes(plan, layers.interactive);
        for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
        const object = new CSS3DObject(element);
        applyStyle(element, style);
        object.matrixAutoUpdate = false;
        return { plan, object, element };
    };
    const sync = (plans: readonly WebScreenPlan[]) => {
        const wanted = new Set(plans.map(plan => plan.entityId));
        for (const id of [...frames.keys()]) if (!wanted.has(id)) remove(id);
        for (const plan of plans) {
            // The renderer checks the URL again before it builds a frame (R12). A failing plan gives no frame and never throws.
            if (!isWebScreenUrl(plan.href)) { remove(plan.entityId); continue; }
            let frame = frames.get(plan.entityId);
            // A URL change loads the page again; a size change keeps the page (R6).
            if (frame && frame.plan.href !== plan.href) { remove(plan.entityId); frame = undefined; }
            if (!frame) { frame = build(plan); frames.set(plan.entityId, frame); }
            if (frame.plan.width !== plan.width || frame.plan.height !== plan.height) applyStyle(frame.element, { width: `${plan.width}px`, height: `${plan.height}px` });
            const target = plan.onTop ? front.scene : back.scene;
            if (frame.object.parent !== target) { frame.object.removeFromParent(); target.add(frame.object); }
            frame.plan = plan;
        }
    };
    return {
        render(input: WebLayerFrame) {
            sync(input.plans);
            for (const layer of [back, front]) {
                layer.renderer.setSize(input.width, input.height);
                layer.element.style.transform = `scale(${input.cssWidth / input.width}, ${input.cssHeight / input.height})`;
            }
            for (const frame of frames.values()) {
                const root = input.root(frame.plan.entityId);
                const aspect = webQuadWidth(frame.plan);
                // The element is width × height px; the scale makes it 1 m high, on the quad (R7), in the CSS world.
                if (root) frame.object.matrix.copy(world).multiply(root.matrixWorld).multiply(scale.makeScale(1 / frame.plan.height, 1 / frame.plan.height, 1));
                const shown = !!root && frame.plan.visible && root.visible && quadInFront(root.matrixWorld, input.camera.matrixWorldInverse, aspect, input.camera.near);
                frame.element.style.visibility = shown ? "visible" : "hidden";
                frame.element.style.opacity = !layers.interactive && frame.plan.onTop && frame.plan.entityId === input.selectedId ? "0.4" : "";
            }
            cssCamera.projectionMatrix.copy(input.camera.projectionMatrix);
            cssViewMatrix(input.camera.matrixWorldInverse, cssCamera.matrixWorldInverse);
            for (const layer of [back, front]) layer.renderer.render(layer.scene, cssCamera);
        },
        /** The iframe of a screen, for tests. */
        frame(entityId: Id): HTMLIFrameElement | undefined { return frames.get(entityId)?.element; },
        dispose() { for (const id of [...frames.keys()]) remove(id); back.element.remove(); front.element.remove(); }
    };
}
export type WebLayerSet = ReturnType<typeof createWebLayers>;
