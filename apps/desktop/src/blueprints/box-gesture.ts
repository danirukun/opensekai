import { rectFrom, type Rect } from './box-select';

type Point = { x: number; y: number };
// Shift and a primary-button drag that starts on empty canvas draws a selection rectangle. ⌘ or Control also held adds to the selection.
export const startsBoxSelect = (event: Pick<PointerEvent, 'button' | 'shiftKey'>, onEmptyCanvas: boolean) => event.button === 0 && event.shiftKey && onEmptyCanvas;

export function attachBoxSelect(container: HTMLElement, isEmpty: (target: EventTarget | null) => boolean, toCanvas: (client: Point) => Point, done: (rect: Rect, add: boolean) => void): () => void {
 const band = container.ownerDocument.createElement('div');
 band.className = 'bp-box-select';
 const down = (event: PointerEvent) => {
  if (!startsBoxSelect(event, isEmpty(event.target))) return;
  event.stopPropagation(); event.preventDefault();
  const box = container.getBoundingClientRect(), start = { x: event.clientX, y: event.clientY };
  const draw = (to: Point) => {
   const rect = rectFrom({ x: start.x - box.left, y: start.y - box.top }, { x: to.x - box.left, y: to.y - box.top });
   Object.assign(band.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  draw(start);
  container.appendChild(band);
  const move = (e: PointerEvent) => draw({ x: e.clientX, y: e.clientY });
  const up = (e: PointerEvent) => {
   window.removeEventListener('pointermove', move);
   window.removeEventListener('pointerup', up);
   window.removeEventListener('pointercancel', up);
   band.remove();
   done(rectFrom(toCanvas(start), toCanvas({ x: e.clientX, y: e.clientY })), e.metaKey || e.ctrlKey);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
 };
 // Capture phase, so the area does not start a pan for this press.
 container.addEventListener('pointerdown', down, true);
 return () => { container.removeEventListener('pointerdown', down, true); band.remove(); };
}
