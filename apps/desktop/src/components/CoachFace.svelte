<script lang="ts">
 import type {ExpressionStepId} from '@opensekai/contracts';
 import {COACH_LOOPS,coachShape,coachTarget,sampleLoop} from '../editor/coach-face';
 let {step,progress=0}:{step:ExpressionStepId;progress?:number}=$props();
 const uid=$props.id();
 let reduced=$state(false),elapsed=$state(0);
 $effect(()=>{
  const query=matchMedia('(prefers-reduced-motion: reduce)');
  reduced=query.matches;
  const change=()=>{reduced=query.matches;};
  query.addEventListener('change',change);
  return()=>query.removeEventListener('change',change);
 });
 // Each step starts its loop from the rest pose.
 $effect(()=>{
  void step;
  if(reduced)return;
  const start=performance.now();let frame=0;
  const tick=(now:number)=>{elapsed=now-start;frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);
  return()=>cancelAnimationFrame(frame);
 });
 const shape=$derived(coachShape(reduced?coachTarget(step):sampleLoop(COACH_LOOPS[step],elapsed)));
 const RING=2*Math.PI*68;
 const eyes=$derived([{x:56,lid:shape.lidScreenLeft,id:`${uid}-l`},{x:94,lid:shape.lidScreenRight,id:`${uid}-r`}]);
 const brow=(x:number,inner:number,value:number)=>{const lift=(value-.5)*2;const outerY=52-lift*5,innerY=52-lift*8;return `M${x} ${outerY} Q${(x+inner)/2} ${Math.min(outerY,innerY)-4} ${inner} ${innerY}`;};
 const mouth=$derived.by(()=>{
  const w=6+shape.mouthWidth*28,curve=(shape.mouthCurve-.5)*14,open=shape.jaw*18,corner=102-curve;
  return {corner,open,d:`M${75-w} ${corner} Q75 ${102+curve*.6-open*.2} ${75+w} ${corner} Q75 ${102+curve*1.2+open*2} ${75-w} ${corner}Z`};
 });
</script>
<svg class="coach" viewBox="0 0 150 150" aria-hidden="true">
 <circle cx="75" cy="75" r="68" fill="none" stroke="#eeecf2" stroke-width="5"/>
 <circle cx="75" cy="75" r="68" fill="none" stroke="#8571ac" stroke-width="5" stroke-linecap="round" stroke-dasharray={RING} stroke-dashoffset={RING*(1-Math.min(1,Math.max(0,progress)))} transform="rotate(-90 75 75)" opacity={progress>0?1:0}/>
 <ellipse cx="75" cy="77" rx={50+shape.cheekPuff*7} ry="52" fill="#f3d9c8"/>
 <circle cx="47" cy="92" r={6+shape.cheekPuff*6} fill="#eaa9a0" opacity={.3+shape.cheekPuff*.4}/>
 <circle cx="103" cy="92" r={6+shape.cheekPuff*6} fill="#eaa9a0" opacity={.3+shape.cheekPuff*.4}/>
 {#each eyes as eye (eye.id)}
  <clipPath id={eye.id}><ellipse cx={eye.x} cy="68" rx="10" ry="7.5"/></clipPath>
  <g clip-path={`url(#${eye.id})`}>
   <ellipse cx={eye.x} cy="68" rx="10" ry="7.5" fill="#fff"/>
   <circle cx={eye.x+shape.pupil[0]*5} cy={68+shape.pupil[1]*3.5} r="4.5" fill="#2b2350"/>
   <rect x={eye.x-11} y="60" width="22" height={16*eye.lid} fill="#e8c6b2"/>
  </g>
  <ellipse cx={eye.x} cy="68" rx="10" ry="7.5" fill="none" stroke="#5a4030" stroke-width="1.2" opacity=".5"/>
 {/each}
 <path d={brow(46,64,shape.browScreenLeft)} stroke="#5a4030" stroke-width="3" fill="none" stroke-linecap="round"/>
 <path d={brow(104,86,shape.browScreenRight)} stroke="#5a4030" stroke-width="3" fill="none" stroke-linecap="round"/>
 <path d={mouth.d} fill="#7a2f3a" stroke="#7a2f3a" stroke-width="2.5" stroke-linejoin="round"/>
 {#if shape.pucker>0}<ellipse cx="75" cy="102" rx={4+shape.pucker*3} ry={3+shape.pucker*4} fill="none" stroke="#a5525c" stroke-width="2.5" opacity={shape.pucker}/>{/if}
 {#if shape.tongue>0}<ellipse cx="75" cy={mouth.corner+mouth.open*.9+shape.tongue*6} rx="7" ry={4+shape.tongue*5} fill="#e07080" opacity={shape.tongue}/>{/if}
</svg>
<style>.coach{display:block;width:150px;height:150px;margin:0 auto}</style>
