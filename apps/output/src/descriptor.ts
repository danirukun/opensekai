import { ConnectionDescriptorSchema } from '@opensekai/contracts';
export const DESCRIPTOR_CACHE_KEY = 'opensekai.renderer.descriptor.v1';
export interface DescriptorPorts {
    hash: string;
    origin: string;
    redact(): void;
    storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}
export function loadRendererDescriptor(ports: DescriptorPorts) {
    let storage: ReturnType<DescriptorPorts['storage']> | undefined;
    try {
        ports.redact();
        storage = ports.storage();
        const explicit = ports.hash !== '';
        const encoded = explicit ? ports.hash.slice(1) : storage.getItem(DESCRIPTOR_CACHE_KEY);
        if (!encoded || new TextEncoder().encode(encoded).byteLength > 8192)
            throw new Error();
        const descriptor = ConnectionDescriptorSchema.parse(JSON.parse(decodeURIComponent(encoded)));
        if (descriptor.role !== 'renderer' || descriptor.outputId === null ||
            new URL(descriptor.httpOrigin).origin !== new URL(ports.origin).origin)
            throw new Error();
        if (explicit) storage.setItem(DESCRIPTOR_CACHE_KEY, encoded);
        return { ...descriptor, role: descriptor.role, outputId: descriptor.outputId };
    } catch {
        try { storage?.removeItem(DESCRIPTOR_CACHE_KEY); } catch { /* Storage remains unavailable. */ }
        throw new Error('Renderer initialization failed');
    }
}
