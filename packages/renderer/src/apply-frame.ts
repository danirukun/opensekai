import type { RuntimeFrame, Reply } from "@opensekai/contracts";
export function selectFrame(previous: RuntimeFrame | null, incoming: RuntimeFrame): Reply<RuntimeFrame> {
    if (previous?.sessionId === incoming.sessionId && incoming.sequence <= previous.sequence)
        return { ok: false, error: { code: "STALE_FRAME", message: "Frame sequence is stale", ids: [] } };
    return { ok: true, data: incoming };
}
export const failure = (code: import("@opensekai/contracts").ErrorCode, message: string, ids: string[] = []) => Object.assign(new Error(message), { code, ids });
export function createRenderQueue(onIdle: () => void = () => { }) {
    let disposed = false, active = false;
    type Job = {
        kind: "frame" | "capture";
        run: () => Promise<unknown>;
        resolve: (value: any) => void;
        reject: (error: unknown) => void;
    };
    const jobs: Job[] = [];
    const pump = async () => { if (active)
        return; active = true; while (jobs.length && !disposed) {
        const job = jobs.shift()!;
        try {
            job.resolve(await job.run());
        }
        catch (error) {
            job.reject(error);
        }
    } active = false; onIdle(); };
    return {
        enqueue<T>(kind: Job["kind"], run: () => Promise<T>): Promise<T> { return new Promise((resolve, reject) => { if (disposed) {
            reject(failure("CANCELLED", "Renderer disposed"));
            return;
        } if (kind === "frame") {
            const index = jobs.findIndex(x => x.kind === "frame");
            if (index >= 0) {
                const old = jobs.splice(index, 1)[0]!;
                old.reject(failure("CANCELLED", "Frame replaced by latest state"));
            }
        }
        else if (jobs.filter(x => x.kind === "capture").length >= 32) {
            reject(failure("BUSY", "Capture queue limit"));
            return;
        } jobs.push({ kind, run, resolve, reject }); void pump(); }); },
        dispose() { if (disposed)
            return; disposed = true; for (const job of jobs.splice(0))
            job.reject(failure("CANCELLED", "Renderer disposed")); if (!active)
            onIdle(); }
    };
}
