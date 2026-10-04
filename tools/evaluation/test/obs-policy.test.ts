const socketPorts = vi.hoisted(() => ({
    connect: vi.fn(), disconnect: vi.fn(async () => {
    })
}));
vi.mock('obs-websocket-js', () => ({
    default: class {
        connect = socketPorts.connect;
        disconnect = socketPorts.disconnect;
    }
}));
import { it, expect, vi } from 'vitest';
import { createObsAdapter, connectObs, REQUIRED_REQUESTS } from '../src/obs';
function transport(overrides: Record<string, unknown> = {}) {
    const call = vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'GetVersion')
            return {
                obsVersion: '32', obsWebSocketVersion: '5', availableRequests: [...REQUIRED_REQUESTS]
            };
        if (method === 'GetStreamStatus' || method === 'GetRecordStatus')
            return {
                outputActive: false
            };
        if (method === 'GetCurrentProgramScene')
            return {
                currentProgramSceneName: 'user_scene'
            };
        if (method === 'GetVideoSettings')
            return {
                baseWidth: 1920, baseHeight: 1080, fpsNumerator: 60, fpsDenominator: 1
            };
        if (method === 'GetSceneList')
            return {
                scenes: []
            };
        if (method === 'GetInputList')
            return {
                inputs: []
            };
        return overrides[method] ?? {};
    });
    return {
        call, disconnect: vi.fn(async () => {
        })
    };
}
const options = {
    profileId: 'webgl2_smoke_v1' as const, outputUrl: 'http://127.0.0.1:9000/renderer/#secret', destinationDir: '/tmp/test', sceneName: 'test', sourceName: 'source'
};
it('fails missing OBS without exposing URL', async () => {
    await expect(connectObs('ws://remote.invalid:4455')).rejects.toMatchObject({
        code: 'INVALID_INPUT'
    });
});
it('requires advertised requests before mutation', async () => {
    const t = transport();
    t.call.mockResolvedValueOnce({
        obsVersion: '32', obsWebSocketVersion: '5', availableRequests: ['GetVersion']
    } as never);
    await expect(createObsAdapter(t)).rejects.toMatchObject({
        code: 'UNSUPPORTED'
    });
    expect(t.call.mock.calls).toHaveLength(1);
});
it('refuses active streaming before scenes change', async () => {
    const t = transport();
    const original = t.call.getMockImplementation()!;
    t.call.mockImplementation(async (method: string, params?: Record<string, unknown>) => method === 'GetStreamStatus' ? {
        outputActive: true
    } : original(method));
    const obs = await createObsAdapter(t);
    await expect(obs.withOwnedScene(options, async () => {
    })).rejects.toMatchObject({
        code: 'BUSY'
    });
    expect(t.call.mock.calls.some(([m]) => m === 'CreateScene')).toBe(false);
});
it('restores prior scene and removes only owned resources on failure', async () => {
    const t = transport();
    const obs = await createObsAdapter(t);
    await expect(obs.withOwnedScene(options, async (owned) => {
        expect(owned.sceneName).not.toBe(options.sceneName);
        throw new Error('action failed');
    })).rejects.toThrow('action failed');
    const restored = t.call.mock.calls.find(([m, p]) => m === 'SetCurrentProgramScene' && (p as {
        sceneName?: string;
    })?.sceneName === 'user_scene');
    expect(restored).toBeDefined();
    expect(t.call.mock.calls.filter(([m]) => m === 'RemoveScene')).toHaveLength(4);
    expect(t.call.mock.calls.filter(([m]) => m === 'RemoveInput')).toHaveLength(4);
});
it('reports missing OBS and authentication with sanitized errors', async () => {
    socketPorts.connect.mockRejectedValueOnce(new Error('secret URL'));
    await expect(connectObs('ws://127.0.0.1:4455')).rejects.toMatchObject({
        code: 'UNAVAILABLE', message: 'OBS connection unavailable'
    });
    socketPorts.connect.mockRejectedValueOnce({
        code: 4009, message: 'password required secret'
    });
    await expect(connectObs('ws://127.0.0.1:4455')).rejects.toMatchObject({
        code: 'FORBIDDEN', message: 'OBS authentication required'
    });
});
it('refuses active recording before setup', async () => {
    const t = transport();
    const original = t.call.getMockImplementation()!;
    t.call.mockImplementation(async (method: string) => method === 'GetRecordStatus' ? {
        outputActive: true
    } : original(method));
    const obs = await createObsAdapter(t);
    await expect(obs.withOwnedScene(options, async () => {
    })).rejects.toMatchObject({
        code: 'BUSY'
    });
    expect(t.call.mock.calls.some(([m]) => m === 'CreateScene')).toBe(false);
});
it('rejects bounded screenshot data before allocation', async () => {
    const t = transport({
        GetSourceScreenshot: {
            imageData: 'data:image/png;base64,' + 'A'.repeat(Math.ceil(2 * 1024 * 1024 / 3) * 4 + 4)
        }
    });
    const obs = await createObsAdapter(t);
    await expect(obs.screenshot('owned')).rejects.toMatchObject({
        code: 'INVALID_INPUT'
    });
});
it('cleans partial setup without touching preexisting names', async () => {
    const t = transport();
    const original = t.call.getMockImplementation()!;
    t.call.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'CreateInput' && params?.inputKind === 'image_source')
            throw new Error('setup failed');
        return original(method, params);
    });
    const obs = await createObsAdapter(t);
    await expect(obs.withOwnedScene(options, async () => {
    })).rejects.toMatchObject({
        code: 'UNAVAILABLE'
    });
    expect(t.call.mock.calls.filter(([m]) => m === 'RemoveScene')).toHaveLength(2);
    expect(t.call.mock.calls.filter(([m]) => m === 'RemoveInput')).toHaveLength(1);
    expect(t.call.mock.calls.filter(([m]) => m === 'RemoveScene' || m === 'RemoveInput').every(([, p]) => !Object.values(p ?? {}).includes('user_scene') && !Object.values(p ?? {}).includes('source') && !Object.values(p ?? {}).includes('test'))).toBe(true);
});
