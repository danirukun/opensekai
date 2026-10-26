import dgram from 'node:dgram';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// VMC test peer for receiver and sender checks without a tracker or a VMC app.
// feed: sends a face timeline (Blink every 2 s, A I U E O cycle) as VMC bundles.
// listen: prints one summary line per second of the VMC packets that arrive.

export interface OscMessage { address: string; types: string; args: readonly (string | number)[] }

export const VOWELS = ['A', 'I', 'U', 'E', 'O'] as const;
export const BLINK_PERIOD = 2, BLINK_LENGTH = 1, VOWEL_LENGTH = 0.8;

export const oscString = (value: string): Buffer => {
  const raw = Buffer.from(value, 'utf8');
  return Buffer.concat([raw, Buffer.alloc(4 - (raw.length % 4))]);
};

const oscArg = (type: string, value: string | number): Buffer => {
  if (type === 's') return oscString(String(value));
  const out = Buffer.alloc(4);
  if (type === 'i') out.writeInt32BE(Number(value));
  else if (type === 'f') out.writeFloatBE(Number(value));
  else throw new Error(`unsupported OSC type ${type}`);
  return out;
};

export const encodeMessage = ({ address, types, args }: OscMessage): Buffer => {
  if (types.length !== args.length) throw new Error(`${address}: ${types.length} types for ${args.length} args`);
  return Buffer.concat([oscString(address), oscString(`,${types}`), ...args.map((arg, i) => oscArg(types[i]!, arg))]);
};

const IMMEDIATELY = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]);

export const encodeBundle = (messages: readonly OscMessage[]): Buffer => Buffer.concat([
  oscString('#bundle'), IMMEDIATELY,
  ...messages.flatMap(message => {
    const body = encodeMessage(message), size = Buffer.alloc(4);
    size.writeInt32BE(body.length);
    return [size, body];
  })
]);

const readString = (buf: Buffer, at: number): [string, number] => {
  const end = buf.indexOf(0, at);
  if (end < 0) throw new Error('OSC string without terminator');
  return [buf.toString('utf8', at, end), end + 4 - ((end - at) % 4)];
};

const decodeMessage = (buf: Buffer): OscMessage => {
  const [address, afterAddress] = readString(buf, 0);
  const [tags, afterTags] = readString(buf, afterAddress);
  const types = tags.slice(1);
  const args: (string | number)[] = [];
  let at = afterTags;
  for (const type of types) {
    if (type === 's') { const [value, next] = readString(buf, at); args.push(value); at = next; }
    else if (type === 'i') { args.push(buf.readInt32BE(at)); at += 4; }
    else if (type === 'f') { args.push(buf.readFloatBE(at)); at += 4; }
    else throw new Error(`unsupported OSC type ${type}`);
  }
  return { address, types, args };
};

export const decodePacket = (buf: Buffer): OscMessage[] => {
  if (!buf.subarray(0, 8).equals(oscString('#bundle'))) return [decodeMessage(buf)];
  const messages: OscMessage[] = [];
  for (let at = 16; at < buf.length;) {
    const size = buf.readInt32BE(at);
    messages.push(...decodePacket(buf.subarray(at + 4, at + 4 + size)));
    at += 4 + size;
  }
  return messages;
};

const pulse = (phase: number, length: number) => phase < length ? Math.sin((phase / length) * Math.PI) : 0;

export const faceBlend = (t: number): Record<string, number> => {
  const vowel = Math.floor(t / VOWEL_LENGTH) % VOWELS.length;
  const weight = pulse(t % VOWEL_LENGTH, VOWEL_LENGTH);
  return {
    Blink: pulse(t % BLINK_PERIOD, BLINK_LENGTH),
    ...Object.fromEntries(VOWELS.map((name, i) => [name, i === vowel ? weight : 0]))
  };
};

export const faceFrame = (t: number): OscMessage[] => [
  { address: '/VMC/Ext/OK', types: 'i', args: [1] },
  { address: '/VMC/Ext/T', types: 'f', args: [t] },
  ...Object.entries(faceBlend(t)).map(([name, value]): OscMessage => ({ address: '/VMC/Ext/Blend/Val', types: 'sf', args: [name, value] })),
  { address: '/VMC/Ext/Blend/Apply', types: '', args: [] }
];

export interface ListenSummary { packets: number; addresses: Record<string, number>; blend: Record<string, number> }

export const summarize = (packets: readonly OscMessage[][]): ListenSummary => {
  const messages = packets.flat();
  const addresses: Record<string, number> = {};
  messages.forEach(m => { addresses[m.address] = (addresses[m.address] ?? 0) + 1; });
  const blend = Object.fromEntries(messages
    .filter(m => m.address === '/VMC/Ext/Blend/Val')
    .map(m => [String(m.args[0]), Math.round(Number(m.args[1]) * 100) / 100]));
  return { packets: packets.length, addresses, blend };
};

const USAGE = `usage: pnpm evaluate:vmc-feed [--host 127.0.0.1] [--port 39539] [--rate 60] [--seconds N]
       pnpm evaluate:vmc-feed --listen [--host 0.0.0.0] [--port 39539] [--seconds N]`;

const feed = (host: string, port: number, rate: number, seconds: number) => new Promise<void>(done => {
  const socket = dgram.createSocket('udp4');
  const start = performance.now();
  const timer = setInterval(() => {
    const t = (performance.now() - start) / 1000;
    if (t >= seconds) { clearInterval(timer); socket.close(() => done()); return; }
    socket.send(encodeBundle(faceFrame(t)), port, host);
  }, 1000 / rate);
  process.stdout.write(`feeding ${host}:${port} at ${rate} Hz\n`);
  process.once('SIGINT', () => { clearInterval(timer); socket.close(() => done()); });
});

const listen = (host: string, port: number, seconds: number) => new Promise<void>((done, fail) => {
  const socket = dgram.createSocket('udp4');
  let window: OscMessage[][] = [];
  socket.on('message', buf => { try { window.push(decodePacket(buf)); } catch (error) { process.stderr.write(`bad packet: ${error}\n`); } });
  socket.on('error', fail);
  const timer = setInterval(() => { process.stdout.write(`${JSON.stringify(summarize(window))}\n`); window = []; }, 1000);
  const stop = () => { clearInterval(timer); socket.close(() => done()); };
  if (Number.isFinite(seconds)) setTimeout(stop, seconds * 1000);
  process.once('SIGINT', stop);
  socket.bind(port, host, () => process.stdout.write(`listening on ${host}:${port}\n`));
});

async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({ args: argv, options: {
    listen: { type: 'boolean', default: false }, host: { type: 'string' }, port: { type: 'string', default: '39539' },
    rate: { type: 'string', default: '60' }, seconds: { type: 'string' }, help: { type: 'boolean', default: false }
  } });
  if (values.help) { process.stdout.write(`${USAGE}\n`); return 0; }
  const port = Number(values.port), rate = Number(values.rate), seconds = values.seconds === undefined ? Infinity : Number(values.seconds);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !(rate > 0) || !(seconds > 0)) { process.stderr.write(`${USAGE}\n`); return 2; }
  if (values.listen) await listen(values.host ?? '0.0.0.0', port, seconds);
  else await feed(values.host ?? '127.0.0.1', port, rate, seconds);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
}
