import { BoxGeometry, BufferGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, EdgesGeometry, Float32BufferAttribute, Group, LineBasicNodeMaterial, LineSegments, Mesh, MeshBasicNodeMaterial, Raycaster, SphereGeometry, Vector2 } from 'three/webgpu';
import type { Object3D, PerspectiveCamera, Scene } from 'three/webgpu';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Id, LightSettings, Reply, SceneView, Transform } from '@opensekai/contracts';
import { persistentTransform } from './transform-edit';
import { createViewportNavigation, type NavigationEdit } from './viewport-navigation';
import { createNavigationCommitter, type NavigationCommitter, type NavigationEnd } from './navigation-commits';
import { SHADOW_BOX } from './scene-lights';
export type EditorTool = 'translate' | 'rotate' | 'scale';
export interface EditorTransformEdit { entityId: Id; expectedRevision: number; transform: Transform }
export interface EditorViewportState { scene: SceneView | null; selectedId: Id | null; tool: EditorTool; enabled: boolean }
export interface EditorOptions {
    onSelect(id: Id | null): void;
    // A gizmo gesture commits through this at most every GIZMO_COMMIT_MS, and once more on release (B12 R1).
    onCommit(edit: EditorTransformEdit): Promise<Reply<{revision: number}>>;
    onDraft?(draft: {entityId: Id; transform: Transform} | null): void;
    onGestureEnd?(): void;
    // Camera navigation (R4–R9): each commit is one scenePatch through the normal route.
    onNavigate?(edit: NavigationEdit): Promise<Reply<{revision: number}>>;
    onNavigateEnd?(): void;
    // A fresh persistent scene, read when an Orbit Character gesture meets a revision that it did not make.
    onInspect?(sceneId: Id): Promise<Reply<SceneView>>;
    // Tab selects the next camera and Ctrl+Tab the previous one while the canvas has focus.
    onCycleCamera?(direction: 1 | -1): void;
}
export interface EditorHandle { sync(state: EditorViewportState): void; cancel(): void }
export const GIZMO_COMMIT_MS = 33;
const read = (object: Object3D): Transform => ({position:object.position.toArray(),rotation:object.quaternion.toArray(),scale:object.scale.toArray()});
const sameTransform = (a: Transform, b: Transform) => (['position','rotation','scale'] as const).every(row => a[row].every((value, index) => value === b[row][index]));
// The spot cone outline (B13 R13): four lines from the light to a circle at the range (5 m for range 0), along −Z.
export const SPOT_HELPER_LENGTH = 5;
export function conePositions(angleDegrees: number, range: number, segments = 32): number[] {
    const length = range > 0 ? range : SPOT_HELPER_LENGTH, radius = length * Math.tan((angleDegrees / 2) * Math.PI / 180);
    const at = (i: number) => { const a = (i / segments) * Math.PI * 2; return [Math.cos(a) * radius, Math.sin(a) * radius, -length]; };
    const rays = [0, segments / 4, segments / 2, (segments * 3) / 4].flatMap(i => [0, 0, 0, ...at(i)]);
    const circle = Array.from({ length: segments }, (_, i) => [...at(i), ...at(i + 1)]).flat();
    return [...rays, ...circle];
}
const outlineMaterial = (color: string) => new LineBasicNodeMaterial({ color, toneMapped: false, transparent: true, opacity: 0.5 });
// An aid only: a click on it does not select the light.
const aid = <T extends Object3D>(object: T, name: string): T => { object.name = name; object.raycast = () => {}; return object; };
// A light helper (R14): a disc, and for a directional light an arrow along −Z, in the light color. A directional light with a shadow
// also shows the outline of its shadow box, normal to its direction (B12 R10). A spot light shows its cone (B13 R13). Only the editor viewport adds one.
export function createLightHelper(light: LightSettings): Object3D {
    const material = new MeshBasicNodeMaterial({ color: light.color, side: DoubleSide, toneMapped: false });
    const root = new Group();
    root.add(new Mesh(new CircleGeometry(0.12, 24), material));
    if (light.type === 'directional') {
        const shaft = new Mesh(new CylinderGeometry(0.015, 0.015, 0.4, 8), material);
        shaft.rotation.x = Math.PI / 2;
        shaft.position.z = -0.2;
        const tip = new Mesh(new ConeGeometry(0.05, 0.12, 12), material);
        tip.rotation.x = -Math.PI / 2;
        tip.position.z = -0.46;
        // Four edges as line segments: three.js 0.180 does not draw a LineLoop.
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        const edges = corners.flatMap(([x, y], i) => { const [nx, ny] = corners[(i + 1) % 4]!; return [x!, y!, 0, nx!, ny!, 0]; });
        const outline = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(edges.map(v => v * SHADOW_BOX), 3));
        root.add(shaft, tip, aid(new LineSegments(outline, outlineMaterial(light.color)), 'shadow-box'));
    }
    if (light.type === 'spot') root.add(aid(new LineSegments(new BufferGeometry(), outlineMaterial(light.color)), 'cone'));
    root.userData.lightKey = '';
    updateLightHelper(root, light);
    return root;
}
export function updateLightHelper(root: Object3D, light: LightSettings) {
    const shadow = light.type === 'directional' && light.shadow.enabled;
    const cone = light.type === 'spot' ? `${light.cone?.angleDegrees ?? 40}:${light.range}` : '';
    const key = `${light.color}|${shadow}|${cone}`;
    if (root.userData.lightKey === key) return;
    root.userData.lightKey = key;
    root.userData.lightColor = light.color;
    root.traverse(object => { const material = (object as Mesh).material as MeshBasicNodeMaterial | undefined; material?.color?.set(light.color); });
    const box = root.getObjectByName('shadow-box');
    if (box) box.visible = shadow;
    const lines = root.getObjectByName('cone') as LineSegments | undefined;
    if (lines) {
        lines.geometry.dispose();
        lines.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(conePositions(light.cone?.angleDegrees ?? 40, light.range), 3));
    }
}
// A haze helper (B13 R13): the wire box of the unit volume, which the entity scale sizes, and a small center handle.
// The handle and the edges are pick targets; the faces are not, so a character inside the haze stays pickable.
export function createHazeHelper(): Object3D {
    const root = new Group();
    const box = new LineSegments(new EdgesGeometry(new BoxGeometry(1, 1, 1)), outlineMaterial('#a8c0ff'));
    box.name = 'haze-box';
    const handle = new Mesh(new SphereGeometry(0.12, 16, 12), new MeshBasicNodeMaterial({ color: '#a8c0ff', toneMapped: false }));
    handle.name = 'haze-handle';
    root.add(box, handle);
    root.userData.hazeHelper = true;
    return root;
}
/** Keeps the handle the same size when the box scale changes. */
export function updateHazeHelper(root: Object3D) {
    const handle = root.getObjectByName('haze-handle');
    if (handle) { handle.scale.set(1 / root.scale.x, 1 / root.scale.y, 1 / root.scale.z); handle.updateMatrixWorld(true); }
}
export function assertEditorScope(outputId: Id, diagnostics: boolean) {
    if (outputId !== 'preview_main' || diagnostics) throw new Error('Editor requires preview_main without diagnostics');
}
export function pickRoots<T extends {root:Object3D;pickable?:boolean}>(objects: Map<string,T>): [string,T][] {
    return [...objects.entries()].filter(([,value])=>value.root.visible&&value.pickable!==false);
}
export function createEditorViewport(canvas: HTMLCanvasElement, camera: PerspectiveCamera, scene: Scene, objects: Map<string,{root:Object3D;pickable?:boolean}>, options: EditorOptions) {
    const controls = new TransformControls(camera,canvas);
    const helper = controls.getHelper();
    scene.add(helper);
    let state: EditorViewportState = {scene:null,selectedId:null,tool:'translate',enabled:false};
    // `last` is the last offered draft; `final` is the transform that the ending commits put in the scene (the end pose, or `base` for a revert).
    interface Gesture {id:Id; base:Transform; start:Transform; root:Object3D; committer:NavigationCommitter; sent:boolean; last:Transform|null; ending:boolean; final:Transform|null}
    let gesture: Gesture | null = null;
    // After the last commit the root keeps its pose until a frame with the committed revision arrives (B12 R5).
    let settle: {id:Id; revision:number; transform:Transform} | null = null;
    let pending = false, disposed = false;
    let down: {x:number;y:number;gizmo:boolean} | null = null;
    const navigation = options.onNavigate ? createViewportNavigation({
        canvas,
        allowed: () => state.enabled && !pending && !disposed && !gesture && !controls.dragging,
        gizmoHit: () => controls.axis !== null || controls.dragging,
        persistent: () => state.scene,
        inspect: sceneId => options.onInspect?.(sceneId) ?? Promise.resolve({ ok: false, error: { code: 'UNAVAILABLE', message: 'Scene read unavailable', ids: [] } }),
        onNavigate: edit => options.onNavigate!(edit),
        onEnd: () => options.onNavigateEnd?.(),
        onChange: () => refresh(),
    }) : null;
    const refresh = () => {
        controls.enabled = state.enabled && !pending && !disposed && !navigation?.active();
        controls.setMode(state.tool);
        const root = state.selectedId ? objects.get(state.selectedId)?.root : undefined;
        if (controls.enabled && root?.visible) controls.attach(root); else controls.detach();
    };
    const restore = (active: Gesture) => {active.root.position.fromArray(active.start.position);active.root.quaternion.fromArray(active.start.rotation);active.root.scale.fromArray(active.start.scale);active.root.updateMatrixWorld(true);};
    // Another edit, a selection change, or a disabled editor ends the gesture without a revert (B12 R2).
    const stop = () => {
        const active = gesture;
        gesture = null;
        if (active) {active.committer.abort();restore(active);if(active.ending)pending=false;if(active.sent)options.onGestureEnd?.();}
        controls.dragging = false;
        options.onDraft?.(null);
    };
    // A cancel by the user: after a sent commit, one more commit puts back the start transform (B12 R3).
    const cancel = () => {
        const active = gesture;
        if (!active || active.ending) {if(!active)stop();return;}
        if (!active.sent) {stop();return;}
        restore(active);
        controls.dragging = false;
        options.onDraft?.(null);
        active.ending = true;
        active.final = active.base;
        active.committer.offer({transform:active.base});
        pending = true;
        refresh();
        active.committer.finish();
    };
    const finished = (active: Gesture, end: NavigationEnd) => {
        if (gesture !== active) return;
        gesture = null;
        pending = false;
        if (end.ok && end.committed && active.final) settle = {id:active.id,revision:end.revision,transform:active.final};
        if (!end.ok) {restore(active);controls.dragging = false;options.onDraft?.(null);}
        if (active.sent) options.onGestureEnd?.();
        if (!disposed) refresh();
    };
    const persistent = (active: Gesture): Transform | null => {
        if (active.ending) return active.final;
        try {return persistentTransform(active.base,active.start,read(active.root));} catch {return null;}
    };
    const begin = () => {
        if (!state.enabled || pending || !state.scene || !state.selectedId) return;
        const entity = state.scene.entities.find(x=>x.id===state.selectedId);
        const root = objects.get(state.selectedId)?.root;
        if (!entity || !root) return;
        settle = null;
        const active: Gesture = {id:entity.id,base:structuredClone(entity.transform),start:read(root),root,sent:false,last:null,ending:false,final:null,committer:null!};
        active.committer = createNavigationCommitter(state.scene.revision,{
            send: ({transform,expectedRevision}) => {active.sent = true;return options.onCommit({entityId:active.id,expectedRevision,transform});},
            onEnd: end => finished(active,end),
            onConflict: () => false,
            now: () => performance.now(),
            setTimer: (run,ms) => setTimeout(run,ms),
            clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
            intervalMs: GIZMO_COMMIT_MS,
        });
        gesture = active;
    };
    const draft = () => {
        const active = gesture;
        if (!active || active.ending) return;
        let transform: Transform;
        try {transform=persistentTransform(active.base,active.start,read(active.root));} catch {stop();return;}
        options.onDraft?.({entityId:active.id,transform});
        active.last = transform;
        active.committer.offer({transform});
    };
    const release = () => {
        const active = gesture;
        if (!active || active.ending) return;
        if (!state.enabled || active.id!==state.selectedId || !state.scene || !active.committer.owns(state.scene.revision)) {stop();return;}
        let transform: Transform;
        try {transform=persistentTransform(active.base,active.start,read(active.root));} catch {stop();return;}
        options.onDraft?.(null);
        active.ending = true;
        // A press without a move is not an edit.
        if (active.last && !sameTransform(transform,active.last)) active.committer.offer({transform});
        active.final = active.last ? transform : null;
        pending = true;
        refresh();
        active.committer.finish();
    };
    const owned = (revision: number) => {
        if (gesture && !gesture.committer.owns(revision)) stop();
        if (settle && revision >= settle.revision) settle = null;
    };
    const pointerDown = (event:PointerEvent) => {if(event.button!==0)return;canvas.focus();down={x:event.clientX,y:event.clientY,gizmo:controls.axis!==null || controls.dragging};};
    const pointerUp = (event:PointerEvent) => {
        const click=down;down=null;
        if(!click || click.gizmo || controls.dragging || gesture || !state.enabled || pending || Math.hypot(event.clientX-click.x,event.clientY-click.y)>4)return;
        const rect=canvas.getBoundingClientRect();
        if(!rect.width || !rect.height)return;
        const ray=new Raycaster();ray.setFromCamera(new Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
        const roots=pickRoots(objects);
        const hit=ray.intersectObjects(roots.map(([,v])=>v.root),true)[0];
        let node: Object3D | undefined=hit?.object;
        while(node){const match=roots.find(([,v])=>v.root===node);if(match){options.onSelect(match[0]);return;}node=node.parent??undefined;}
        options.onSelect(null);
    };
    const abort = () => {down=null;cancel();};
    const key = (event:KeyboardEvent) => {
        if(event.key==='Escape' && (gesture || down || controls.dragging)){event.preventDefault();abort();return;}
        if(event.key==='Tab' && !event.shiftKey && !event.altKey && !event.metaKey && options.onCycleCamera && !navigation?.active()){event.preventDefault();options.onCycleCamera(event.ctrlKey?-1:1);}
    };
    controls.addEventListener('mouseDown',begin);
    controls.addEventListener('objectChange',draft);
    controls.addEventListener('mouseUp',release);
    canvas.addEventListener('pointerdown',pointerDown);
    canvas.addEventListener('pointerup',pointerUp);
    canvas.addEventListener('pointercancel',abort);
    canvas.addEventListener('lostpointercapture',abort);
    canvas.addEventListener('blur',abort);
    canvas.addEventListener('keydown',key);
    canvas.ownerDocument.defaultView?.addEventListener('blur',abort);
    refresh();
    return {
        sync(next:EditorViewportState) {if(gesture && (next.selectedId!==gesture.id || !next.scene || !next.enabled || next.tool!==state.tool))stop();if(next.scene)owned(next.scene.revision);state=next;navigation?.allowedChanged();refresh();},
        cancel,
        frameRevision(revision:number) {owned(revision);},
        frame(scene:SceneView) {owned(scene.revision);navigation?.frame(scene);},
        frozen(id:Id) {return gesture?.id===id || settle?.id===id || navigation?.transform(id)!=null;},
        // The persistent draft of the dragged entity, then its committed transform until the frame catches up (B12 R6).
        draftTransform(id:Id):Transform|null {if(gesture?.id===id)return persistent(gesture);return settle?.id===id?settle.transform:null;},
        // The navigation draft of a camera, drawn instead of the scene value during a gesture.
        cameraTransform(id:Id) {return navigation?.transform(id) ?? null;},
        refresh,
        dispose() {if(disposed)return;disposed=true;down=null;stop();settle=null;navigation?.dispose();controls.removeEventListener('mouseDown',begin);controls.removeEventListener('objectChange',draft);controls.removeEventListener('mouseUp',release);canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',abort);canvas.removeEventListener('lostpointercapture',abort);canvas.removeEventListener('blur',abort);canvas.removeEventListener('keydown',key);canvas.ownerDocument.defaultView?.removeEventListener('blur',abort);controls.detach();controls.dispose();helper.removeFromParent();}
    };
}
