import type { CameraNavigation, Id, PatchOp, Reply, SceneEntity, SceneView, Transform, Vec3 } from '@opensekai/contracts';
import { NAVIGATION, freeLookFromTransform, freeLookStep, freeLookTurn, orbitDrag, orbitFromTransform, orbitPan, orbitPivot, orbitZoom, transformFromFreeLook, transformFromOrbit, type FreeLookState, type OrbitState } from './camera-navigation';
import { createNavigationCommitter, type NavigationCommitter, type NavigationDraft } from './navigation-commits';
import { add, followOffset, followShift, shiftTransform, type Follow } from './orbit-follow';

export interface NavigationEdit { sceneId: Id; expectedRevision: number; operations: PatchOp[] }
export interface NavigationHost {
    canvas: HTMLCanvasElement;
    // Selection and gizmo state allow navigation (R9), and the press did not hit a gizmo handle.
    allowed(): boolean;
    gizmoHit(): boolean;
    // The persistent scene of the editor model, and a fresh read of it from the session.
    persistent(): SceneView | null;
    inspect(sceneId: Id): Promise<Reply<SceneView>>;
    onNavigate(edit: NavigationEdit): Promise<Reply<{ revision: number }>>;
    onEnd(): void;
    onChange(): void;
}
type Camera = Extract<SceneEntity, { kind: 'camera' }>;
type Mode = { kind: 'freeLook'; state: FreeLookState } | { kind: 'orbit'; state: OrbitState; panned: boolean };
// `transform` is the persistent draft. With `follow`, it is drawn with the follow offset of the target, and `committed` is the persistent camera.
interface Gesture { ending: boolean; cameraId: Id; sceneId: Id; navigation: CameraNavigation; scale: Vec3; fov: number; mode: Mode; committer: NavigationCommitter; transform: Transform | null; pivotOffset: Vec3 | null; follow: Follow | null; committed: Transform; resyncing: boolean }
interface Press { button: number; pointerId: number; x: number; y: number; lastX: number; lastY: number; moved: boolean }
const CLICK_PX = 4;
const WHEEL_IDLE_MS = 150;
const KEYS: Record<string, [axis: 'forward' | 'right' | 'up', sign: number]> = { KeyW: ['forward', 1], KeyS: ['forward', -1], KeyD: ['right', 1], KeyA: ['right', -1], KeyE: ['up', 1], KeyQ: ['up', -1] };

export function navigationCamera(scene: SceneView | null): Camera | null {
    const id = scene?.outputs.find(output => output.id === 'preview_main')?.cameraId;
    const camera = scene?.entities.find(entity => entity.id === id);
    return camera?.kind === 'camera' ? camera : null;
}
export function wheelSteps(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
    return event.deltaMode === 0 ? event.deltaY / 100 : event.deltaMode === 1 ? event.deltaY / 3 : event.deltaY;
}

export function createViewportNavigation(host: NavigationHost) {
    const { canvas } = host;
    const view = canvas.ownerDocument.defaultView;
    let scene: SceneView | null = null;
    let gesture: Gesture | null = null;
    let press: Press | null = null;
    let settling: { cameraId: Id; revision: number; transform: Transform; follow: Follow | null } | null = null;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    let suppressMenu = false, menuTimer: ReturnType<typeof setTimeout> | null = null;
    const keys = new Set<string>();
    let fast = false, frameRequest: number | null = null, lastStep: number | null = null;

    const navigation = (camera: Camera): CameraNavigation => camera.navigation ?? { mode: 'none' };
    const draft = (): NavigationDraft | null => gesture?.transform ? { transform: gesture.transform, ...(gesture.pivotOffset ? { pivotOffset: gesture.pivotOffset } : {}) } : null;
    const stopKeys = () => { keys.clear(); fast = false; if (frameRequest !== null) view?.cancelAnimationFrame(frameRequest); frameRequest = null; lastStep = null; };
    const stopWheel = () => { if (wheelTimer !== null) clearTimeout(wheelTimer); wheelTimer = null; };

    const begin = (camera: Camera): Gesture | null => {
        // A gesture that waits for its last reply takes no more input; the next one starts after it ends.
        if (gesture) return gesture.ending ? null : gesture;
        if (!scene || !host.allowed()) return null;
        const mode = navigation(camera);
        if (mode.mode === 'none') return null;
        let start: Mode, follow: Follow | null = null, committed = camera.transform;
        if (mode.mode === 'freeLook') start = { kind: 'freeLook', state: freeLookFromTransform(camera.transform) };
        else if (mode.targetId) {
            // The orbit works around the persistent target, so it starts when the editor scene is the frame revision (R6a).
            const persistent = host.persistent();
            const saved = persistent?.revision === scene.revision ? persistent : null;
            const savedCamera = saved?.entities.find(entity => entity.id === camera.id);
            const target = saved?.entities.find(entity => entity.id === mode.targetId && entity.kind === 'avatar');
            if (!savedCamera || !target) return null;
            follow = { cameraId: camera.id, targetId: mode.targetId, base: [...target.transform.position] };
            committed = savedCamera.transform;
            start = { kind: 'orbit', state: orbitFromTransform(committed, orbitPivot(target.transform.position, mode.pivotOffset)), panned: false };
        } else start = { kind: 'orbit', state: orbitFromTransform(camera.transform, orbitPivot(null, mode.pivotOffset)), panned: false };
        const cameraId = camera.id, sceneId = scene.sceneId;
        const committer = createNavigationCommitter(scene.revision, {
            send: commit => {
                const operations: PatchOp[] = [{ kind: 'setTransform', entityId: cameraId, transform: commit.transform }];
                if (commit.pivotOffset && mode.mode === 'orbitCharacter') operations.push({ kind: 'setCameraNavigation', entityId: cameraId, navigation: { ...mode, pivotOffset: commit.pivotOffset } });
                return host.onNavigate({ sceneId, expectedRevision: commit.expectedRevision, operations }).then(reply => {
                    if (reply.ok && gesture?.committer === committer) gesture.committed = commit.transform;
                    return reply;
                });
            },
            onConflict: () => {
                const active = gesture?.committer === committer ? gesture : null;
                if (!active?.follow) return false;
                resync(active);
                return true;
            },
            onEnd: end => {
                const last = gesture?.committer === committer ? gesture : null;
                if (last) gesture = null;
                settling = end.ok && end.committed && last?.transform ? { cameraId, revision: end.revision, transform: last.transform, follow: last.follow } : null;
                host.onChange();
                host.onEnd();
            },
            now: () => performance.now(),
            setTimer: (run, ms) => setTimeout(run, ms),
            clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
        });
        gesture = { ending: false, cameraId, sceneId, navigation: mode, scale: [...camera.transform.scale], fov: camera.lens.fovDegrees, mode: start, committer, transform: null, pivotOffset: null, follow, committed: structuredClone(committed), resyncing: false };
        settling = null;
        host.onChange();
        return gesture;
    };
    const update = (active: Gesture, mode: Mode) => {
        active.mode = mode;
        active.transform = mode.kind === 'freeLook' ? transformFromFreeLook(mode.state, active.scale) : transformFromOrbit(mode.state, active.scale);
        const next = draft();
        if (next) active.committer.offer(next);
    };
    // The other edit wins: the gesture ends without a commit and the scene value shows.
    const abort = () => {
        const active = gesture;
        gesture = null;
        press = null;
        stopKeys();
        stopWheel();
        if (active) { active.committer.abort(); settling = null; host.onChange(); host.onEnd(); }
    };
    // A revision that the gesture did not make. When it only moved the target and the camera together (the Blueprint idle
    // commit of a walk), the gesture moves with them and continues; any other change ends it (R8).
    const resync = (active: Gesture) => {
        if (active.resyncing || !active.follow) return;
        active.resyncing = true;
        active.committer.hold();
        host.inspect(active.sceneId).then(reply => {
            if (gesture !== active || !active.follow) return;
            const moved = reply.ok ? followShift(reply.data, active.follow, active.committed) : null;
            if (!reply.ok || !moved) { abort(); return; }
            active.follow = { ...active.follow, base: add(active.follow.base, moved) };
            active.committed = shiftTransform(active.committed, moved);
            if (active.mode.kind === 'orbit') active.mode = { ...active.mode, state: { ...active.mode.state, pivot: add(active.mode.state.pivot, moved) } };
            if (active.transform) active.transform = shiftTransform(active.transform, moved);
            active.resyncing = false;
            active.committer.rebase(reply.data.revision, draft => ({ ...draft, transform: shiftTransform(draft.transform, moved) }));
        }, () => { if (gesture === active) abort(); });
    };
    const finish = () => {
        stopKeys();
        if (!gesture || press || wheelTimer !== null) return;
        gesture.ending = true;
        gesture.committer.finish();
    };
    const step = (time: number) => {
        frameRequest = null;
        const active = gesture;
        if (!active || active.ending || active.mode.kind !== 'freeLook' || !press || press.button !== 2 || keys.size === 0) { lastStep = null; return; }
        const dt = lastStep === null ? 0 : Math.min(0.1, (time - lastStep) / 1000);
        lastStep = time;
        const input = { forward: 0, right: 0, up: 0, fast, sensitivity: active.navigation.mode === 'none' ? 1 : active.navigation.sensitivity };
        for (const code of keys) { const [axis, sign] = KEYS[code]!; input[axis] += sign; }
        if (dt > 0) update(active, { kind: 'freeLook', state: freeLookStep(active.mode.state, input, dt) });
        frameRequest = view?.requestAnimationFrame(step) ?? null;
    };

    const pointerDown = (event: PointerEvent) => {
        if (press || event.button > 2) return;
        const camera = navigationCamera(scene);
        if (!camera || !host.allowed()) return;
        const mode = navigation(camera).mode;
        if (mode === 'none' || (mode === 'freeLook' && event.button !== 2) || (event.button === 0 && host.gizmoHit())) return;
        if (event.button !== 0) event.preventDefault();
        canvas.focus();
        try { canvas.setPointerCapture(event.pointerId); } catch { return; }
        press = { button: event.button, pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
        if (event.button === 2) suppressMenu = true;
    };
    const pointerMove = (event: PointerEvent) => {
        if (!press || event.pointerId !== press.pointerId) return;
        if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= CLICK_PX) return;
        const camera = navigationCamera(scene);
        const active = camera ? begin(camera) : null;
        if (!active) return;
        const dx = event.clientX - press.lastX, dy = event.clientY - press.lastY;
        press.moved = true;
        press.lastX = event.clientX;
        press.lastY = event.clientY;
        const sensitivity = active.navigation.mode === 'none' ? 1 : active.navigation.sensitivity;
        const mode = active.mode;
        if (mode.kind === 'freeLook') update(active, { kind: 'freeLook', state: freeLookTurn(mode.state, dx, dy, sensitivity) });
        else if (press.button === 1) {
            const panned = orbitPan(mode.state, dx, dy, canvas.getBoundingClientRect().height, active.fov);
            if (active.navigation.mode === 'orbitCharacter') active.pivotOffset = (active.pivotOffset ?? active.navigation.pivotOffset).map((value, i) => value + panned.delta[i]!) as Vec3;
            update(active, { kind: 'orbit', state: panned.state, panned: true });
        } else update(active, { kind: 'orbit', state: orbitDrag(mode.state, dx, dy, sensitivity), panned: mode.panned });
    };
    const pointerUp = (event: PointerEvent) => {
        const ended = press;
        if (!ended || event.pointerId !== ended.pointerId) return;
        press = null;
        if (ended.button === 2) {
            // A right drag does not open the context menu; a right click still does (R7).
            if (menuTimer !== null) clearTimeout(menuTimer);
            menuTimer = setTimeout(() => { suppressMenu = false; menuTimer = null; }, 300);
            if (!ended.moved) canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, button: 2 }));
        }
        finish();
    };
    const lostCapture = (event: PointerEvent) => { if (press && event.pointerId === press.pointerId) { press = null; finish(); } };
    const blur = () => { press = null; stopWheel(); finish(); };
    const contextMenu = (event: MouseEvent) => {
        if (!event.isTrusted || !suppressMenu) return;
        event.preventDefault();
        event.stopPropagation();
    };
    const middleDown = (event: MouseEvent) => { if (event.button === 1 && navigationCamera(scene)?.navigation?.mode === 'orbitCharacter') event.preventDefault(); };
    const wheel = (event: WheelEvent) => {
        const camera = navigationCamera(scene);
        if (!camera || navigation(camera).mode !== 'orbitCharacter') return;
        event.preventDefault();
        const active = begin(camera);
        if (!active || active.mode.kind !== 'orbit') return;
        update(active, { ...active.mode, state: orbitZoom(active.mode.state, wheelSteps(event)) });
        stopWheel();
        wheelTimer = setTimeout(() => { wheelTimer = null; finish(); }, WHEEL_IDLE_MS);
    };
    const keyDown = (event: KeyboardEvent) => {
        if (!press || press.button !== 2 || !(event.code in KEYS || event.key === 'Shift')) return;
        const camera = navigationCamera(scene);
        if (!camera || navigation(camera).mode !== 'freeLook') return;
        event.preventDefault();
        fast = event.shiftKey;
        if (!(event.code in KEYS)) return;
        if (!begin(camera)) return;
        press.moved = true;
        keys.add(event.code);
        if (frameRequest === null) frameRequest = view?.requestAnimationFrame(step) ?? null;
    };
    const keyUp = (event: KeyboardEvent) => { fast = event.shiftKey; if (keys.delete(event.code)) event.preventDefault(); };

    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', lostCapture);
    canvas.addEventListener('lostpointercapture', lostCapture);
    canvas.addEventListener('mousedown', middleDown);
    canvas.addEventListener('contextmenu', contextMenu);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('keydown', keyDown);
    canvas.addEventListener('keyup', keyUp);
    canvas.addEventListener('blur', blur);
    view?.addEventListener('blur', blur);
    return {
        frame(next: SceneView) {
            scene = next;
            const active = gesture;
            if (active) {
                const camera = navigationCamera(next);
                if (camera?.id !== active.cameraId || navigation(camera).mode !== active.navigation.mode) abort();
                else if (!active.committer.owns(next.revision)) { if (active.follow) resync(active); else abort(); }
            }
            if (settling && (next.revision >= settling.revision || navigationCamera(next)?.id !== settling.cameraId)) { settling = null; host.onChange(); }
        },
        // The camera transform to draw: the gesture draft until the scene shows the last commit.
        transform(cameraId: Id): Transform | null {
            const drawn = (transform: Transform, follow: Follow | null) => follow ? shiftTransform(transform, followOffset(scene, follow)) : transform;
            if (gesture?.cameraId === cameraId && gesture.transform) return drawn(gesture.transform, gesture.follow);
            return settling?.cameraId === cameraId ? drawn(settling.transform, settling.follow) : null;
        },
        active() { return gesture !== null; },
        allowedChanged() { if (gesture && !host.allowed()) abort(); },
        abort,
        dispose() {
            abort();
            if (menuTimer !== null) clearTimeout(menuTimer);
            canvas.removeEventListener('pointerdown', pointerDown);
            canvas.removeEventListener('pointermove', pointerMove);
            canvas.removeEventListener('pointerup', pointerUp);
            canvas.removeEventListener('pointercancel', lostCapture);
            canvas.removeEventListener('lostpointercapture', lostCapture);
            canvas.removeEventListener('mousedown', middleDown);
            canvas.removeEventListener('contextmenu', contextMenu);
            canvas.removeEventListener('wheel', wheel);
            canvas.removeEventListener('keydown', keyDown);
            canvas.removeEventListener('keyup', keyUp);
            canvas.removeEventListener('blur', blur);
            view?.removeEventListener('blur', blur);
        },
    };
}
export type ViewportNavigation = ReturnType<typeof createViewportNavigation>;
export { NAVIGATION };
