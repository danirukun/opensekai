<script lang="ts">
import type {CameraLens} from '@opensekai/contracts';
import {commitFocusFromClientX, layoutLensDepth} from '../editor/lens-depth-diagram';

let {lens,disabled=false,onlive,onend,oncommit}:{lens:Pick<CameraLens,'fovDegrees'|'fStop'|'focusDistance'>;disabled?:boolean;onlive?:(focusDistance:number)=>void;onend?:()=>void;oncommit?:(focusDistance:number)=>void}=$props();

const W=280,H=72;
const layout=$derived(layoutLensDepth(lens,W,H));
let dragging=$state(false);

function clientToDistance(clientX:number,target:SVGSVGElement){
	const left=target.getBoundingClientRect().left;
	return commitFocusFromClientX(clientX,left,W);
}

function down(event:PointerEvent & { currentTarget: SVGSVGElement }){
	if(disabled)return;
	event.currentTarget.setPointerCapture(event.pointerId);
	dragging=true;
	onlive?.(clientToDistance(event.clientX,event.currentTarget));
}

function move(event:PointerEvent & { currentTarget: SVGSVGElement }){
	if(!dragging||disabled)return;
	onlive?.(clientToDistance(event.clientX,event.currentTarget));
}

function up(event:PointerEvent & { currentTarget: SVGSVGElement }){
	if(!dragging)return;
	dragging=false;
	try{event.currentTarget.releasePointerCapture(event.pointerId);}catch{/* already released */}
	const next=clientToDistance(event.clientX,event.currentTarget);
	onend?.();
	oncommit?.(next);
}
</script>

<svg class="depth" width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="slider" tabindex={disabled ? undefined : 0} aria-label="Focus distance" aria-valuemin={0.01} aria-valuemax={1000} aria-valuenow={lens.focusDistance} aria-disabled={disabled||undefined} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
	<rect class="wash" x={layout.padLeft} y={layout.axisY-layout.coneHalfPx} width={W-layout.padLeft-layout.padRight} height={layout.coneHalfPx*2} rx="2"/>
	<line class="cone" x1={layout.padLeft} y1={layout.axisY} x2={W-layout.padRight} y2={layout.axisY-layout.coneHalfPx}/>
	<line class="cone" x1={layout.padLeft} y1={layout.axisY} x2={W-layout.padRight} y2={layout.axisY+layout.coneHalfPx}/>
	<line class="axis" x1={layout.padLeft} y1={layout.axisY} x2={W-layout.padRight} y2={layout.axisY}/>
	<rect class="cam" x={layout.padLeft-10} y={layout.axisY-5} width="10" height="10" rx="1"/>
	<rect class="dof" x={layout.focusX-layout.dofHalfPx} y={layout.axisY-20} width={layout.dofHalfPx*2} height="40"/>
	<line class="focus" x1={layout.focusX} y1={layout.axisY-20} x2={layout.focusX} y2={layout.axisY+20}/>
	<circle class={['marker', { disabled, dragging }]} cx={layout.focusX} cy={layout.axisY} r="5"/>
</svg>

<style>
	.depth{display:block;width:100%;max-width:100%;height:72px;touch-action:none;cursor:ew-resize;border-radius:4px;background:color-mix(in srgb,var(--ds-color-fg, #35333D) 4%, transparent)}
	.depth[aria-disabled=true]{cursor:default;opacity:.55}
	.wash{fill:color-mix(in srgb,var(--ds-color-fg, #35333D) 8%, transparent);stroke:none}
	.cone,.axis,.focus{stroke:color-mix(in srgb,var(--ds-color-fg, #35333D) 45%, transparent);stroke-width:1;fill:none}
	.axis{stroke:color-mix(in srgb,var(--ds-color-fg, #35333D) 22%, transparent)}
	.cam{fill:var(--ds-color-fg, #35333D)}
	.dof{fill:color-mix(in srgb,var(--ds-color-fg, #35333D) 18%, transparent)}
	.marker{fill:var(--ds-color-fg, #35333D)}
	.marker.dragging{fill:var(--ds-color-fg, #35333D)}
</style>
