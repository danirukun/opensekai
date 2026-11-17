import dgram from 'node:dgram';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseCli } from 'node:util';
import { ARKIT_NAMES, EXPRESSION_STEPS, defaultTrackingConfig, type ArkitName, type ExpressionStepId } from '@opensekai/contracts';
import { encodeBundle, type OscMessage } from './vmc-feed';

// Fake face sender for guided setup checks without a phone or a VMC app (B42 R21).
// It sends a neutral phase, then each expression target of the guide at full value, as VMC bundles or iFacialMocap text.

export type FeedKind = 'vmc' | 'ifacialmocap';
export interface FeedArgs { kind: FeedKind; host: string; port: number; neutralSeconds: number; seconds: number }
export interface HeadAngles { rx: number; ry: number; rz: number }

const NEVER: readonly ArkitName[] = ['cheekPuff', 'tongueOut'];
export const FEED_NAMES: readonly ArkitName[] = ARKIT_NAMES.filter(name => !NEVER.includes(name));
export const FEED_STEPS: readonly ExpressionStepId[] = (Object.keys(EXPRESSION_STEPS) as ExpressionStepId[])
 .filter(step => EXPRESSION_STEPS[step].main.every(name => FEED_NAMES.includes(name)));
export const STEP_SECONDS = 2, RATE = 60, EYE_DEGREES = 20;
const LOOKS = [['eyeLookUpLeft', 'eyeLookUpRight'], ['eyeLookDownLeft', 'eyeLookDownRight'], ['eyeLookInLeft', 'eyeLookInRight'], ['eyeLookOutLeft', 'eyeLookOutRight']] as const;

const zeros = (): Record<string, number> => Object.fromEntries(FEED_NAMES.map(name => [name, 0]));

// The step that runs at t, or null in the neutral phase. The sequence repeats after the last step.
export const stepAt = (t: number, neutralSeconds: number): ExpressionStepId | null =>
 t < neutralSeconds ? null : FEED_STEPS[Math.floor((t - neutralSeconds) / STEP_SECONDS) % FEED_STEPS.length]!;

export function schedule(t: number, neutralSeconds: number): Record<string, number> {
 const values = zeros(), step = stepAt(t, neutralSeconds);
 if (step === null) return values;
 // The look step moves the eyes up, down, in, and out, one quarter of the step each.
 const names = step === 'lookAround'
  ? LOOKS[Math.floor((((t - neutralSeconds) % STEP_SECONDS) / STEP_SECONDS) * LOOKS.length)]!
  : EXPRESSION_STEPS[step].main;
 for (const name of names) values[name] = 1;
 return values;
}

// Degrees. Small enough that the head stays in the calibration range.
export const sway = (t: number): HeadAngles => ({ rx: 2 * Math.sin((2 * Math.PI * t) / 3), ry: 5 * Math.sin((2 * Math.PI * t) / 4), rz: 1.5 * Math.sin((2 * Math.PI * t) / 5) });

const fixed = (n: number) => (Object.is(n, -0) ? 0 : n).toFixed(3);
const ifmName = (name: string) => name.replace(/Left$/, '_L').replace(/Right$/, '_R');
const eyes = (values: Record<string, number>) => {
 const v = (name: string) => values[name] ?? 0;
 const pitch = (side: 'Left' | 'Right') => (v(`eyeLookDown${side}`) - v(`eyeLookUp${side}`)) * EYE_DEGREES;
 return { left: [pitch('Left'), (v('eyeLookOutLeft') - v('eyeLookInLeft')) * EYE_DEGREES, 0], right: [pitch('Right'), (v('eyeLookInRight') - v('eyeLookOutRight')) * EYE_DEGREES, 0] };
};

export function ifmFrame(values: Record<string, number>, head: HeadAngles): string {
 const { left, right } = eyes(values);
 return [
  ...Object.entries(values).map(([name, value]) => `${ifmName(name)}-${Math.round(Math.min(1, Math.max(0, value)) * 100)}`),
  `head#${[head.rx, head.ry, head.rz, 0, 0, 0].map(fixed).join(',')}`,
  `leftEye#${left.map(fixed).join(',')}`,
  `rightEye#${right.map(fixed).join(',')}`
 ].join('|');
}

// Unity order: Z, then X, then Y.
const quat = ({ rx, ry, rz }: HeadAngles): [number, number, number, number] => {
 const h = (deg: number) => (deg * Math.PI) / 360;
 const [sx, cx, sy, cy, sz, cz] = [Math.sin(h(rx)), Math.cos(h(rx)), Math.sin(h(ry)), Math.cos(h(ry)), Math.sin(h(rz)), Math.cos(h(rz))];
 return [cy * sx * cz + sy * cx * sz, sy * cx * cz - cy * sx * sz, cy * cx * sz - sy * sx * cz, cy * cx * cz + sy * sx * sz];
};

export const vmcFrame = (values: Record<string, number>, head: HeadAngles): Buffer => encodeBundle([
 { address: '/VMC/Ext/OK', types: 'i', args: [1] },
 { address: '/VMC/Ext/Bone/Pos', types: 'sfffffff', args: ['Head', 0, 0, 0, ...quat(head)] },
 ...Object.entries(values).map(([name, value]): OscMessage => ({ address: '/VMC/Ext/Blend/Val', types: 'sf', args: [name, value] })),
 { address: '/VMC/Ext/Blend/Apply', types: '', args: [] }
]);

const USAGE = 'usage: pnpm evaluate:tracking-feed --kind vmc|ifacialmocap [--host 127.0.0.1] [--port N] [--neutral-seconds 3] [--seconds N]';

export function parseArgs(argv: readonly string[]): FeedArgs {
 const { values } = parseCli({ args: [...argv], options: {
  kind: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string' },
  'neutral-seconds': { type: 'string', default: '3' }, seconds: { type: 'string' }
 } });
 const kind = values.kind;
 if (kind !== 'vmc' && kind !== 'ifacialmocap') throw new Error(`--kind must be vmc or ifacialmocap\n${USAGE}`);
 const preset = defaultTrackingConfig(kind);
 const port = values.port === undefined && 'port' in preset ? preset.port : Number(values.port);
 if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port must be 1-65535\n${USAGE}`);
 const neutralSeconds = Number(values['neutral-seconds']), seconds = values.seconds === undefined ? Infinity : Number(values.seconds);
 if (!(neutralSeconds >= 0) || !(seconds >= 0)) throw new Error(`--seconds and --neutral-seconds must be 0 or more\n${USAGE}`);
 return { kind, host: values.host, port, neutralSeconds, seconds };
}

const feed = ({ kind, host, port, neutralSeconds, seconds }: FeedArgs) => new Promise<void>(done => {
 const socket = dgram.createSocket('udp4');
 const start = performance.now();
 let phase: string | undefined;
 const stop = () => { clearInterval(timer); socket.close(() => done()); };
 const timer = setInterval(() => {
  const t = (performance.now() - start) / 1000;
  if (t >= seconds) { stop(); return; }
  const next = stepAt(t, neutralSeconds) ?? 'neutral';
  if (next !== phase) { phase = next; process.stdout.write(`${t.toFixed(1)} s ${phase}\n`); }
  const values = schedule(t, neutralSeconds), head = sway(t);
  socket.send(kind === 'vmc' ? vmcFrame(values, head) : Buffer.from(ifmFrame(values, head)), port, host);
 }, 1000 / RATE);
 process.stdout.write(`feeding ${kind} to ${host}:${port} at ${RATE} Hz\n`);
 process.once('SIGINT', stop);
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 Promise.resolve().then(() => feed(parseArgs(process.argv.slice(2))))
  .then(() => { process.exitCode = 0; }, error => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 2; });
}
