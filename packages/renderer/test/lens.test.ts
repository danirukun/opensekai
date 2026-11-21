import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three/webgpu";
import { DEFAULT_CAMERA_LENS, lensWithFocalLength, lensWithSensorPreset, type CameraLens } from "@opensekai/contracts";
import { applyPerspectiveLens } from "../src/lens";

const ASPECT_16_9 = 16 / 9;

describe("applyPerspectiveLens (CAM-16, Task 5)", () => {
    it("sets filmGauge, near, and far from the physical lens", () => {
        const camera = new PerspectiveCamera();
        const lens: CameraLens = lensWithSensorPreset(DEFAULT_CAMERA_LENS, "super35");
        camera.aspect = ASPECT_16_9;
        applyPerspectiveLens(camera, lens);
        expect(camera.filmGauge).toBeCloseTo(24.89, 6); // Super 35 width (filmGaugeMm), not the legacy default 35.
        expect(camera.near).toBe(lens.near);
        expect(camera.far).toBe(lens.far);
    });

    it("keeps the three.js fov readout within 0.1 degrees of the stored fovDegrees at 16:9", () => {
        const camera = new PerspectiveCamera();
        camera.aspect = ASPECT_16_9;
        const lens = lensWithFocalLength(DEFAULT_CAMERA_LENS, 85);
        applyPerspectiveLens(camera, lens);
        expect(camera.fov).toBeCloseTo(lens.fovDegrees, 1);
    });

    // D12: fovDegrees is the derived vertical FOV at the sensor's own aspect ratio, so three's
    // setFocalLength (which factors in the *camera's* aspect) disagrees with it whenever the
    // camera aspect differs from the sensor aspect -- 16:9 output vs. e.g. Full Frame's 3:2.
    // Plan option (a): keep filmGauge (and so setFocalLength) for DoF/bokeh consumers, then force
    // camera.fov back to lens.fovDegrees so the inspector readout always matches the stored value.
    it("documents that camera.fov is forced to lens.fovDegrees, overriding three's own aspect-dependent fov from setFocalLength", () => {
        const camera = new PerspectiveCamera();
        camera.aspect = ASPECT_16_9;
        const lens = lensWithFocalLength(DEFAULT_CAMERA_LENS, 85); // Full Frame, 36x24 (3:2) sensor.
        camera.setFocalLength(lens.focalLengthMm);
        camera.filmGauge = 36;
        camera.updateProjectionMatrix();
        const threeOwnFov = camera.fov;
        expect(threeOwnFov).not.toBeCloseTo(lens.fovDegrees, 1); // Three's fov drifts at a non-3:2 aspect.
        applyPerspectiveLens(camera, lens);
        expect(camera.fov).toBeCloseTo(lens.fovDegrees, 6); // applyPerspectiveLens corrects it back.
    });

    it("updates the projection matrix so the camera is immediately ready to render", () => {
        const camera = new PerspectiveCamera();
        camera.aspect = ASPECT_16_9;
        const before = camera.projectionMatrix.clone();
        applyPerspectiveLens(camera, lensWithFocalLength(DEFAULT_CAMERA_LENS, 24));
        expect(camera.projectionMatrix.equals(before)).toBe(false);
    });
});
