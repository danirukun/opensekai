// Applies a physical CameraLens to a three.js PerspectiveCamera (CAM-16, Task 5).
import type { PerspectiveCamera } from "three/webgpu";
import { filmGaugeMm, type CameraLens } from "@opensekai/contracts";

// `fovDegrees` is the lens's own vertical FOV, derived at the sensor's aspect ratio (D12). Three's
// setFocalLength/filmGauge instead derive fov from the *camera's* aspect, so the two disagree
// whenever that aspect differs from the sensor's (plan option (a)). filmGauge and focal length
// still drive DoF/bokeh math downstream, so this sets them before forcing fov back to the stored
// value, keeping the inspector readout in sync with lens.fovDegrees.
export function applyPerspectiveLens(camera: PerspectiveCamera, lens: CameraLens): void {
    camera.filmGauge = filmGaugeMm(lens.sensorPreset);
    camera.setFocalLength(lens.focalLengthMm);
    camera.fov = lens.fovDegrees;
    camera.near = lens.near;
    camera.far = lens.far;
    camera.updateProjectionMatrix();
}
