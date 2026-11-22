import { describe, expect, it } from "vitest";
import { SENSOR_PRESETS, verticalFovDegrees, focalLengthMmFromVerticalFov, bokehScale, filmGaugeMm, concertFocalLengthMm } from "../src/lens-math";

describe("lens-math", () => {
  it("Full Frame 50mm vertical FOV is about 27°", () => {
    expect(verticalFovDegrees(50, SENSOR_PRESETS.fullFrame.heightMm)).toBeCloseTo(27.0, 0);
  });
  it("round-trips FOV ↔ focal on Full Frame", () => {
    const fov = verticalFovDegrees(85, 24);
    expect(focalLengthMmFromVerticalFov(fov, 24)).toBeCloseTo(85, 5);
  });
  it("filmGauge for fullFrame is 36", () => {
    expect(filmGaugeMm("fullFrame")).toBe(36);
  });
  it("wider aperture raises bokehScale", () => {
    expect(bokehScale(85, 1.8, "full")).toBeGreaterThan(bokehScale(85, 8, "full"));
  });
  it("cheap quality lowers bokehScale", () => {
    expect(bokehScale(85, 1.8, "cheap")).toBeLessThan(bokehScale(85, 1.8, "full"));
  });
  it("Portrait (85mm f/1.8) full bokehScale is clearly visible", () => {
    expect(bokehScale(85, 1.8, "full")).toBeGreaterThanOrEqual(5);
  });
  it("Concert focal yields FOV under 35°", () => {
    expect(verticalFovDegrees(concertFocalLengthMm(), 24)).toBeLessThan(35);
  });
});
