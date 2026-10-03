import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { connectClient } from '@opensekai/browser-client';
import { ConnectionDescriptorSchema, type ConnectionDescriptor, type Reply } from '@opensekai/contracts';
import { createMcpServer } from './server';
import { failure } from './tools';
export function parseOperatorDescriptor(input: unknown): Reply<ConnectionDescriptor> {
 const parsed = ConnectionDescriptorSchema.safeParse(input);
 if (!parsed.success) return failure('INVALID_INPUT', 'Invalid connection descriptor');
 if (parsed.data.role !== 'operator' || parsed.data.outputId !== null) return {ok:false,error:{code:'FORBIDDEN',message:'Operator credentials required',ids:[]}};
 return {ok:true,data:parsed.data};
}
export async function runCli(): Promise<void> {
 const file = process.env.OPENSEKAI_CONNECTION_FILE;
 if (!file) throw new Error('Connection descriptor file required');
 const descriptor = parseOperatorDescriptor(JSON.parse(await readFile(file, 'utf8')));
 if (!descriptor.ok) throw new Error(descriptor.error.code);
 const client = await connectClient(descriptor.data);
 const server = createMcpServer(client.api, uri => client.readResource(uri));
 let stopped = false;
 const shutdown = () => { if (stopped) return; stopped = true; client.close(); void server.close(); process.removeListener('SIGINT',shutdown); process.removeListener('SIGTERM',shutdown); };
 server.server.onclose = shutdown;
 process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
 try { await server.connect(new StdioServerTransport()); } catch { shutdown(); throw new Error('MCP transport unavailable'); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 void runCli().catch(() => { process.stderr.write('OpenSekai MCP startup failed\n'); process.exitCode = 1; });
}
