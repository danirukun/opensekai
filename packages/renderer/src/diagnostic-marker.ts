import { Scene, OrthographicCamera, Mesh, PlaneGeometry, MeshBasicNodeMaterial } from "three/webgpu";
import { encodeMarker, tagId } from "@opensekai/contracts";
import type { RuntimeFrame } from "@opensekai/contracts";

export function createDiagnosticMarker() {
    const scene = new Scene();
    const geometry = new PlaneGeometry(2, 8);
    const black = new MeshBasicNodeMaterial({color: 0x000000, depthTest: false, depthWrite: false, toneMapped: false});
    const white = new MeshBasicNodeMaterial({color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false});
    const cells = Array.from({length: 168}, (_, i) => {
        const mesh = new Mesh(geometry, black);
        mesh.position.set(i * 2 + 1, -4, 0);
        scene.add(mesh);
        return mesh;
    });
    const camera = new OrthographicCamera(0, 1920, 0, -1080, -1, 1);
    return {
        scene,
        camera,
        update(frame: RuntimeFrame, cameraId: string, width: number, height: number) {
            const values = encodeMarker({
                sessionTag: tagId(frame.sessionId), sequence: frame.sequence,
                tick: frame.tick, revision: frame.scene.revision, cameraTag: tagId(cameraId)
            });
            cells.forEach((cell, i) => cell.material = values[i] ? white : black);
            camera.right = width;
            camera.bottom = -height;
            camera.updateProjectionMatrix();
        },
        dispose() {
            geometry.dispose();
            black.dispose();
            white.dispose();
            scene.clear();
        }
    };
}
