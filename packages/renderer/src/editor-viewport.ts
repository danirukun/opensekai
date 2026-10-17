import { Raycaster, Vector2 } from 'three/webgpu';
import type { Object3D, PerspectiveCamera, Scene } from 'three/webgpu';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Id, Reply, SceneView, Transform } from '@opensekai/contracts';
import { persistentTransform } from './transform-edit';
import { createViewportNavigation, type NavigationEdit } from './viewport-navigation';
export type EditorTool = 'translate' | 'rotate' | 'scale';
export interface EditorTransformEdit { entityId: Id; expectedRevision: number; transform: Transform }
export interface EditorViewportState { scene: SceneView | null; selectedId: Id | null; tool: EditorTool; enabled: boolean }
export interface EditorOptions {
    onSelect(id: Id | null): void;
    onCommit(edit: EditorTransformEdit): Promise<Reply<{revision: number}>>;
    onDraft?(draft: {entityId: Id; transform: Transform} | null): void;
    // Camera navigation (R4–R9): each commit is one scenePatch through the normal route.
    onNavigate?(edit: NavigationEdit): Promise<Reply<{revision: number}>>;
    onNavigateEnd?(): void;
    // Tab selects the next camera and Ctrl+Tab the previous one while the canvas has focus.
    onCycleCamera?(direction: 1 | -1): void;
}
export interface EditorHandle { sync(state: EditorViewportState): void; cancel(): void }
const read = (object: Object3D): Transform => ({position:object.position.toArray(),rotation:object.quaternion.toArray(),scale:object.scale.toArray()});
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
    let gesture: {id:Id; revision:number; base:Transform; start:Transform; root:Object3D} | null = null;
    let pending = false, disposed = false;
    let down: {x:number;y:number;gizmo:boolean} | null = null;
    const navigation = options.onNavigate ? createViewportNavigation({
        canvas,
        allowed: () => state.enabled && !pending && !disposed && !gesture && !controls.dragging,
        gizmoHit: () => controls.axis !== null || controls.dragging,
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
    const cancel = () => {
        const active = gesture;
        gesture = null;
        if (active) {active.root.position.fromArray(active.start.position);active.root.quaternion.fromArray(active.start.rotation);active.root.scale.fromArray(active.start.scale);active.root.updateMatrixWorld(true);}
        controls.dragging = false;
        options.onDraft?.(null);
    };
    const begin = () => {
        if (!state.enabled || pending || !state.scene || !state.selectedId) return;
        const entity = state.scene.entities.find(x=>x.id===state.selectedId);
        const root = objects.get(state.selectedId)?.root;
        if (!entity || !root) return;
        gesture = {id:entity.id,revision:state.scene.revision,base:structuredClone(entity.transform),start:read(root),root};
    };
    const draft = () => {
        if (!gesture) return;
        try {options.onDraft?.({entityId:gesture.id,transform:persistentTransform(gesture.base,gesture.start,read(gesture.root))});} catch {cancel();}
    };
    const release = () => {
        const active = gesture;
        if (!active) return;
        if (!state.enabled || active.id!==state.selectedId || active.revision!==state.scene?.revision) {cancel();return;}
        let transform: Transform;
        try {transform=persistentTransform(active.base,active.start,read(active.root));} catch {cancel();return;}
        gesture=null;
        options.onDraft?.(null);
        pending=true;
        refresh();
        try {
            void options.onCommit({entityId:active.id,expectedRevision:active.revision,transform}).catch(()=>undefined).finally(()=>{pending=false;if(!disposed)refresh();});
        } catch {pending=false;refresh();}
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
        sync(next:EditorViewportState) {if(gesture && (next.selectedId!==gesture.id || next.scene?.revision!==gesture.revision || !next.enabled || next.tool!==state.tool))cancel();state=next;navigation?.allowedChanged();refresh();},
        cancel,
        frameRevision(revision:number) {if(gesture && revision!==gesture.revision)cancel();},
        frame(scene:SceneView) {if(gesture && scene.revision!==gesture.revision)cancel();navigation?.frame(scene);},
        frozen(id:Id) {return gesture?.id===id || navigation?.transform(id)!=null;},
        // The navigation draft of a camera, drawn instead of the scene value during a gesture.
        cameraTransform(id:Id) {return navigation?.transform(id) ?? null;},
        refresh,
        dispose() {if(disposed)return;disposed=true;abort();navigation?.dispose();controls.removeEventListener('mouseDown',begin);controls.removeEventListener('objectChange',draft);controls.removeEventListener('mouseUp',release);canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',abort);canvas.removeEventListener('lostpointercapture',abort);canvas.removeEventListener('blur',abort);canvas.removeEventListener('keydown',key);canvas.ownerDocument.defaultView?.removeEventListener('blur',abort);controls.detach();controls.dispose();helper.removeFromParent();}
    };
}
