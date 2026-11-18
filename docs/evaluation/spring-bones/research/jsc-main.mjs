// Minimal TextDecoder for GLTFLoader in the jsc shell (UTF-8 only).
if (typeof AbortController === "undefined") globalThis.AbortController = class { constructor() { this.signal = { aborted: false, addEventListener() {}, removeEventListener() {} }; } abort() { this.signal.aborted = true; } };
if (typeof TextDecoder === 'undefined') globalThis.TextDecoder = class { decode(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return decodeURIComponent(escape(s)); } };
import { run } from './jsc-entry.mjs';
run([0, 1, 2].map(k => readFile(`${globalThis.BENCH_DIR}/a${k}.json`)), 'JavaScriptCore', globalThis.MODE).catch(e => print('ERR ' + e));
