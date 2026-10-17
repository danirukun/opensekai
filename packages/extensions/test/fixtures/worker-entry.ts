import { parentPort } from 'node:worker_threads';
import { installExtensionWorker } from '../../src/worker';

const port = parentPort!;
void installExtensionWorker({
 postMessage: message => port.postMessage(message),
 addEventListener: (_type, listener) => port.on('message', data => listener({ data } as MessageEvent)),
});
