import type { BlueprintComment } from '@opensekai/contracts';
import type { Box } from './box-select';
import { commentRect, commentSize } from './comments';

type Point = { x: number; y: number };
type Size = { width: number; height: number };
export type DragPhase = 'start' | 'move' | 'end';
export interface CommentLayerEvents {
 select(ids: string[], add: boolean): void;
 move(id: string, to: Point, phase: DragPhase): void;
 resize(id: string, size: Size): void;
 menu(id: string, client: Point): void;
 open(id: string): void;
}
export interface CommentLayer {
 sync(comments: readonly BlueprintComment[]): void;
 selected(): string[];
 select(ids: readonly string[], add: boolean): void;
 boxes(): Box[];
 owns(element: unknown): boolean;
 destroy(): void;
}

const additive = (event: PointerEvent | MouseEvent) => event.metaKey || event.ctrlKey || event.shiftKey;

// Comment boxes on the canvas, behind wires and nodes. Only the header and the resize handle take the pointer,
// so a drag on the comment body still pans the canvas.
export function createCommentLayer(holder: HTMLElement, zoom: () => number, events: CommentLayerEvents): CommentLayer {
 const views = new Map<string, { root: HTMLElement; title: HTMLElement; data: BlueprintComment }>();
 const elements = new WeakSet<object>();
 let chosen = new Set<string>(), dragging: string | null = null;
 const doc = holder.ownerDocument;
 const place = (root: HTMLElement, at: Point, size: Size) => {
  root.style.transform = `translate(${at.x}px, ${at.y}px)`;
  root.style.width = `${size.width}px`;
  root.style.height = `${size.height}px`;
 };
 const mark = () => { for (const [id, view] of views) view.root.classList.toggle('selected', chosen.has(id)); };
 // A pointer drag in canvas units; `step` gets the movement since the press, divided by the zoom.
 const drag = (event: PointerEvent, step: (delta: Point, phase: DragPhase) => void) => {
  const start = { x: event.clientX, y: event.clientY }, k = zoom();
  let moved = false;
  const delta = (e: PointerEvent) => ({ x: (e.clientX - start.x) / k, y: (e.clientY - start.y) / k });
  const move = (e: PointerEvent) => {
   if (!moved) { moved = true; step({ x: 0, y: 0 }, 'start'); }
   step(delta(e), 'move');
  };
  const up = (e: PointerEvent) => {
   window.removeEventListener('pointermove', move);
   window.removeEventListener('pointerup', up);
   window.removeEventListener('pointercancel', up);
   if (moved) step(delta(e), 'end');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
 };
 const create = (comment: BlueprintComment) => {
  const root = doc.createElement('div'), header = doc.createElement('div'), title = doc.createElement('span'), handle = doc.createElement('div');
  root.className = 'bp-comment'; header.className = 'bp-comment-header'; handle.className = 'bp-comment-resize';
  root.dataset.testid = 'comment';
  header.appendChild(title); root.appendChild(header); root.appendChild(handle);
  elements.add(root);
  const id = comment.id, view = { root, title, data: comment };
  header.addEventListener('pointerdown', event => {
   if (event.button !== 0) return;
   event.stopPropagation(); event.preventDefault();
   if (!chosen.has(id) || additive(event)) events.select([id], additive(event));
   const origin = { ...view.data.position };
   dragging = id;
   drag(event, (delta, phase) => {
    const to = { x: Math.round(origin.x + delta.x), y: Math.round(origin.y + delta.y) };
    place(root, to, view.data.size);
    events.move(id, to, phase);
    if (phase === 'end') dragging = null;
   });
  });
  handle.addEventListener('pointerdown', event => {
   if (event.button !== 0) return;
   event.stopPropagation(); event.preventDefault();
   const origin = { ...view.data.size };
   drag(event, (delta, phase) => {
    const size = commentSize({ width: origin.width + delta.x, height: origin.height + delta.y });
    place(root, view.data.position, size);
    if (phase === 'end') events.resize(id, size);
   });
  });
  header.addEventListener('dblclick', event => { event.stopPropagation(); events.open(id); });
  for (const part of [header, handle]) part.addEventListener('contextmenu', event => {
   event.preventDefault(); event.stopPropagation();
   if (!chosen.has(id)) events.select([id], false);
   events.menu(id, { x: event.clientX, y: event.clientY });
  });
  holder.insertBefore(root, holder.firstChild);
  return view;
 };
 return {
  sync(comments) {
   const keep = new Set(comments.map(comment => comment.id));
   for (const [id, view] of views) if (!keep.has(id)) { view.root.remove(); views.delete(id); }
   for (const comment of comments) {
    const view = views.get(comment.id) ?? create(comment);
    view.data = comment;
    views.set(comment.id, view);
    view.title.textContent = comment.text;
    if (dragging !== comment.id) place(view.root, comment.position, comment.size);
   }
   chosen = new Set([...chosen].filter(id => keep.has(id)));
   mark();
  },
  selected: () => [...chosen],
  select(ids, add) { chosen = new Set([...(add ? chosen : []), ...ids.filter(id => views.has(id))]); mark(); },
  boxes: () => [...views].map(([id, view]) => ({ id, ...commentRect(view.data) })),
  owns: element => typeof element === 'object' && element !== null && elements.has(element),
  destroy() { for (const view of views.values()) view.root.remove(); views.clear(); },
 };
}
