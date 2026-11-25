<script lang="ts">
 import {Button, Select} from '@oshi-connect/ui';
 import {
  MAX_OVERLAY_POSES,
  type AvatarAnimation,
  type BodyPart,
  type Reply,
 } from '@opensekai/contracts';
 import {bodyPartOptions} from '../editor/live-fields';
 import {SLIDERS} from '../editor/slider';
 import SliderField from './SliderField.svelte';
 import {
  animationOf,
  defaultHandOverride,
  defaultHandPin,
  handPoseOptions,
  handSideLabels,
  isHandPoseId,
  isOverlayClipEntry,
  isOverlayPoseId,
  moveOverlay,
  newOverlayEntry,
  overlayPoseOptions,
  removeOverlay,
  withHandOverride,
  withHandPin,
  withOverlayClip,
  withOverlayPart,
  withOverlayPose,
  withOverlaySpeed,
  withOverlayWeight,
 } from '../editor/avatar-animation';

 const OVERLAY_CLIP_SPEED = {min: 0, max: 4, step: 0.05, curve: 'linear'} as const;

 type Commit = (id: string, animation: AvatarAnimation, revision: number) => Promise<Reply<{revision: number}> | unknown>;
 let {
  entityId,
  animation,
  revision,
  disabled = false,
  animations = [],
  oncommit,
 }: {
  entityId: string;
  animation?: AvatarAnimation;
  revision: number;
  disabled?: boolean;
  animations?: {id: string; name: string}[];
  oncommit?: Commit;
 } = $props();

 const overlaySourceOptions = $derived([
  ...overlayPoseOptions.map(option => ({value: `pose:${option.value}`, label: option.label})),
  ...animations.map(asset => ({value: `clip:${asset.id}`, label: asset.name})),
 ]);

 const current = $derived(animationOf(animation));
 const leftHand = $derived(current.overrideHandPoses.left ?? defaultHandOverride());
 const rightHand = $derived(current.overrideHandPoses.right ?? defaultHandOverride());
 const leftPin = $derived(current.handPin.left ?? defaultHandPin());
 const rightPin = $derived(current.handPin.right ?? defaultHandPin());

 const commit = (next: AvatarAnimation) => {
  void oncommit?.(entityId, next, revision);
 };
 const addOverlay = () => {
  const entry = newOverlayEntry(current.overlayingPoses);
  if (!entry) return;
  commit({...current, overlayingPoses: [...current.overlayingPoses, entry]});
 };
</script>

<div class="animation">
 <div class="block">
  <div class="heading-row">
   <span class="heading">Overlaying Animations</span>
   <Button variant="secondary" disabled={disabled || !oncommit || current.overlayingPoses.length >= MAX_OVERLAY_POSES} onclick={addOverlay}>Add</Button>
  </div>
  {#each current.overlayingPoses as entry, index (entry.id)}
   <div class="overlay">
    <div class="row">
     <Select
      label="Source"
      value={isOverlayClipEntry(entry) ? `clip:${entry.assetId}` : `pose:${entry.pose}`}
      options={overlaySourceOptions}
      disabled={disabled || !oncommit}
      onchange={event => {
       const value = event.currentTarget.value;
       if (value.startsWith('pose:')) {
        const pose = value.slice(5);
        if (isOverlayPoseId(pose)) commit(withOverlayPose(current, entry.id, pose));
       } else if (value.startsWith('clip:')) commit(withOverlayClip(current, entry.id, value.slice(5)));
      }}
     />
     <div class="moves">
      <Button variant="ghost" disabled={disabled || !oncommit || index === 0} onclick={() => commit(moveOverlay(current, entry.id, -1))}>Up</Button>
      <Button variant="ghost" disabled={disabled || !oncommit || index === current.overlayingPoses.length - 1} onclick={() => commit(moveOverlay(current, entry.id, 1))}>Down</Button>
      <Button variant="ghost" disabled={disabled || !oncommit} onclick={() => commit(removeOverlay(current, entry.id))}>Remove</Button>
     </div>
    </div>
    <SliderField
     label="Weight"
     value={entry.weight}
     range={SLIDERS.shadowIntensity}
     disabled={disabled || !oncommit}
     oncommit={value => commit(withOverlayWeight(current, entry.id, value))}
    />
    {#if isOverlayClipEntry(entry)}
     <SliderField
      label="Speed"
      value={entry.speed ?? 1}
      range={OVERLAY_CLIP_SPEED}
      disabled={disabled || !oncommit}
      oncommit={value => commit(withOverlaySpeed(current, entry.id, value))}
     />
    {/if}
    <fieldset class="parts" disabled={disabled || !oncommit}>
     <legend>Masked Body Parts</legend>
     {#each bodyPartOptions as part (part.value)}
      <label class="check">
       <input
        type="checkbox"
        checked={entry.maskedBodyParts.includes(part.value)}
        onchange={event => commit(withOverlayPart(current, entry.id, part.value as BodyPart, event.currentTarget.checked))}
       />
       {part.label}
      </label>
     {/each}
    </fieldset>
   </div>
  {/each}
 </div>

 <SliderField
  label="Overlaying Animations Transition Time"
  value={current.overlayTransitionSeconds}
  range={SLIDERS.fade}
  disabled={disabled || !oncommit}
  oncommit={value => commit({...current, overlayTransitionSeconds: value})}
 />

 <div class="block">
  <span class="heading">Override Hand Poses</span>
  {#each (['left', 'right'] as const) as side (side)}
   {@const hand = side === 'left' ? leftHand : rightHand}
   <div class="hand">
    <span class="subheading">{handSideLabels[side]}</span>
    <label class="check">
     <input
      type="checkbox"
      checked={hand.enabled}
      disabled={disabled || !oncommit}
      onchange={event => commit(withHandOverride(current, side, {enabled: event.currentTarget.checked}))}
     />
     Enabled
    </label>
    <Select
     label="Pose"
     value={hand.pose}
     options={handPoseOptions}
     disabled={disabled || !oncommit || !hand.enabled}
     onchange={event => {
      const pose = event.currentTarget.value;
      if (isHandPoseId(pose)) commit(withHandOverride(current, side, {pose}));
     }}
    />
    <SliderField
     label="Weight"
     value={hand.weight}
     range={SLIDERS.shadowIntensity}
     disabled={disabled || !oncommit || !hand.enabled}
     oncommit={value => commit(withHandOverride(current, side, {weight: value}))}
    />
    <label class="check">
     <input
      type="checkbox"
      checked={hand.highPriority}
      disabled={disabled || !oncommit || !hand.enabled}
      onchange={event => commit(withHandOverride(current, side, {highPriority: event.currentTarget.checked}))}
     />
     High Priority
    </label>
   </div>
  {/each}
 </div>

 <div class="block">
  <span class="heading">Hand Pin</span>
  {#each (['left', 'right'] as const) as side (side)}
   {@const pin = side === 'left' ? leftPin : rightPin}
   <div class="hand">
    <span class="subheading">{handSideLabels[side]}</span>
    <label class="check">
     <input
      type="checkbox"
      checked={pin.enabled}
      disabled={disabled || !oncommit}
      onchange={event => commit(withHandPin(current, side, {enabled: event.currentTarget.checked}))}
     />
     Enabled
    </label>
    <Select
     label="Mode"
     value={pin.mode}
     options={[{value: 'preset', label: 'Preset'}, {value: 'hold', label: 'Hold'}]}
     disabled={disabled || !oncommit || !pin.enabled}
     onchange={event => {
      const mode = event.currentTarget.value;
      if (mode === 'preset' || mode === 'hold') commit(withHandPin(current, side, {mode}));
     }}
    />
   </div>
  {/each}
 </div>
</div>

<style>
 .animation { display: grid; gap: 14px; }
 .block { display: grid; gap: 10px; }
 .heading-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
 .heading, .subheading { font-size: 12px; font-weight: 600; }
 .overlay, .hand { display: grid; gap: 8px; padding: 8px 0; border-top: 1px solid var(--ds-color-border, rgba(127, 127, 127, 0.25)); }
 .row { display: grid; gap: 8px; }
 .moves { display: flex; flex-wrap: wrap; gap: 4px; }
 .check { display: flex; align-items: center; gap: 7px; font-size: 12px; }
 .parts { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
 .parts legend { padding: 0; margin-bottom: 6px; font-size: 12px; font-weight: 600; }
</style>
