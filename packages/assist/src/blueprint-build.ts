import { KEYSTROKE_CODES, keystrokeHasModifier, type BlueprintGraph, type BlueprintNode, type Id, type KeystrokeSettings, type Reply } from '@opensekai/contracts';
import { invalid, note, ok, only, putGraph, resolveEntity, type WorkingState } from './compile-kit';
import type { BlueprintAction, BlueprintTrigger, Ref } from './intents';
import { resolveRef } from './refs';
import { WORDS } from './words';

const COLUMN = 240;
type Modifier = 'control' | 'alt' | 'shift' | 'meta';
const MODIFIERS: Record<string, Modifier> = {
 control: 'control', ctrl: 'control', alt: 'alt', option: 'alt', shift: 'shift', meta: 'meta', super: 'meta', cmd: 'meta', command: 'meta',
};
const keyCode = (key: string): string | undefined =>
 /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : KEYSTROKE_CODES.find(c => c.toLowerCase() === key.toLowerCase());

// A hotkey is an accelerator such as `Control+Shift+H`: modifiers, then one key.
const keystroke = (accelerator: string): Reply<KeystrokeSettings> => {
 const parts = accelerator.split('+').map(p => p.trim());
 const code = keyCode(parts.at(-1) ?? '');
 const mods = parts.slice(0, -1).map(p => Object.hasOwn(MODIFIERS, p.toLowerCase()) ? MODIFIERS[p.toLowerCase()] : undefined);
 if (!code || mods.some(m => m === undefined)) return invalid(`Unknown hotkey ${accelerator}`);
 const settings = { code: code as KeystrokeSettings['code'], control: mods.includes('control'), alt: mods.includes('alt'), shift: mods.includes('shift'), meta: mods.includes('meta') };
 return keystrokeHasModifier(settings) ? ok(settings) : invalid('A hotkey needs Control, Alt, or Meta');
};

const at = (id: string, column: number, type: string, settings: object, inputs?: Record<string, boolean>): BlueprintNode =>
 ({ id, version: 1, type, position: { x: COLUMN * column, y: 0 }, settings, ...(inputs ? { inputs } : {}) }) as BlueprintNode;

const triggerNode = (t: BlueprintTrigger): Reply<BlueprintNode> => {
 switch (t.kind) {
  case 'hotkey': { const k = keystroke(t.key); return k.ok ? ok(at('trigger', 0, 'event.keystroke', k.data)) : k; }
  case 'manual': return ok(at('trigger', 0, 'event.manual', {}));
  case 'event': return ok(at('trigger', 0, 'event.custom', { name: t.name, payload: 'none' }));
  case 'youtube': return ok(at('trigger', 0, `youtube.${t.event}`, {}));
  case 'showStart': return ok(at('trigger', 0, 'event.enable', {}));
 }
};

const actionNode = (state: WorkingState, a: BlueprintAction, k: number): Reply<BlueprintNode> => {
 const id = `action_${k}`;
 switch (a.kind) {
  case 'expression': {
   const e = resolveEntity(state, a.character, ['avatar'], 'a character');
   if (!e.ok) return e;
   const settings = { entityId: e.data.id, expression: a.expression };
   return ok(a.mode === 'toggle' ? at(id, k, 'character.toggleExpression', settings) : at(id, k, 'character.setExpression', settings, { active: a.mode === 'on' }));
  }
  case 'visibility': {
   const e = resolveEntity(state, a.entity, null, 'an entity');
   if (!e.ok) return e;
   return ok(a.mode === 'toggle' ? at(id, k, 'scene.toggleVisibility', { entityId: e.data.id }) : at(id, k, 'scene.setVisibility', { entityId: e.data.id }, { visible: a.mode === 'show' }));
  }
  case 'switchCamera': {
   const c = resolveEntity(state, a.camera, ['camera'], 'a camera');
   if (!c.ok) return c;
   const output = state.scene.outputs[0];
   return output ? ok(at(id, k, 'camera.switch', { outputId: output.id, cameraId: c.data.id })) : invalid('Scene has no output');
  }
  case 'wait': return ok(at(id, k, 'flow.delay', { seconds: WORDS.wait[a.length] }));
  case 'emit': return ok(at(id, k, 'event.emit', { name: a.name, payload: 'none' }));
 }
};

// Chat replaces only a graph that it made (R14).
const ownedGraph = (state: WorkingState, ref: Ref): Reply<Id> => {
 const hit = resolveRef(state.proposal.refs, ref);
 return hit?.kind === 'blueprint' && state.proposal.refs.owned.includes(hit.id) && state.blueprints.some(g => g.id === hit.id)
  ? ok(hit.id) : invalid(`${ref} is not a Blueprint that Chat made`, [ref]);
};

export const compileBlueprintBuild = only('blueprint_build', (i, state, context) => {
 const replaced = i.replace === undefined ? null : ownedGraph(state, i.replace);
 if (replaced && !replaced.ok) return replaced;
 const trigger = triggerNode(i.trigger);
 if (!trigger.ok) return trigger;
 const actions = i.actions.reduce<Reply<BlueprintNode[]>>((r, a, k) => {
  if (!r.ok) return r;
  const n = actionNode(state, a, k + 1);
  return n.ok ? ok([...r.data, n.data]) : n;
 }, ok([]));
 if (!actions.ok) return actions;
 const nodes = [trigger.data, ...actions.data];
 const graph: BlueprintGraph = {
  schemaVersion: 1, id: replaced?.data ?? context.newId('blueprint'), name: i.name, enabled: true, nodes, variables: [],
  connections: nodes.slice(1).map((n, k) => ({ id: `wire_${k + 1}`, sourceNodeId: nodes[k]!.id, sourcePort: k === 0 ? 'flow' : 'exit', targetNodeId: n.id, targetPort: 'flow' })),
 };
 const put = putGraph(state, graph, replaced?.data ?? null);
 return put.ok && i.replace !== undefined ? ok(note(put.data, { code: 'replacedExisting', ref: i.replace })) : put;
});
