import { DEVICE_KINDS, type BlueprintGraph, type DeviceEvent, type DeviceKind, type DeviceUpdate } from '@opensekai/contracts';
import type { DeviceEnv } from './blueprint-eval/devices';

const kindOf = (type: string): DeviceKind | undefined => DEVICE_KINDS.find(kind => type.startsWith(`${kind}.`));

// The device kinds that enabled graphs read, in DEVICE_KINDS order. The host runs an adapter only for these.
export const activeDevices = (graphs: readonly BlueprintGraph[]): DeviceKind[] => {
 const used = new Set(graphs.filter(graph => graph.enabled).flatMap(graph => graph.nodes.flatMap(node => kindOf(node.type) ?? [])));
 return DEVICE_KINDS.filter(kind => used.has(kind));
};

export interface DeviceTick { env: DeviceEnv; events: DeviceEvent[] }
export interface DeviceInput { ingest(update: DeviceUpdate | undefined): DeviceTick }

// Gamepad and pointer state come whole with each clock; MIDI Control Change values last until the next change.
export function createDeviceInput(): DeviceInput {
 const midi = new Map<string, number>();
 return {
  ingest(update) {
   const events: DeviceEvent[] = [];
   for (const event of update?.events ?? []) {
    if (event.kind !== 'midiControl') { events.push(event); continue; }
    midi.set(`${event.channel}:${event.controller}`, event.value);
    midi.set(`0:${event.controller}`, event.value);
   }
   return { env: { gamepads: update?.gamepads ?? [], pointer: update?.pointer ?? null, midi }, events };
  },
 };
}
