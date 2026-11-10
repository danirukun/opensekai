import { describe, expect, it } from "vitest";
import { AvatarTrackingSchema, BODY_PARTS, DEFAULT_AVATAR_BODY_TRACKING, FINGER_BONES, HUMANOID_BONES, bodyPartOf, normalizeBodyTracking, type BodyPart } from "../src/index";
describe("body tracking", () => {
    it("gives each humanoid bone one part", () => {
        const count = Object.fromEntries(BODY_PARTS.map(part => [part, 0])) as Record<BodyPart, number>;
        for (const bone of HUMANOID_BONES) { const part = bodyPartOf(bone); expect(part, bone).not.toBeNull(); count[part!]++; }
        expect(count).toEqual({ head: 5, body: 4, leftArm: 4, rightArm: 4, leftFingers: 15, rightFingers: 15, leftLeg: 4, rightLeg: 4 });
        expect(HUMANOID_BONES).toHaveLength(55);
        for (const bone of FINGER_BONES) expect(bodyPartOf(bone)).toBe(bone.startsWith("left") ? "leftFingers" : "rightFingers");
        expect([bodyPartOf("hips"), bodyPartOf("jaw"), bodyPartOf("leftHand"), bodyPartOf("rightToes"), bodyPartOf("rightShoulder")]).toEqual(["body", "head", "leftArm", "rightLeg", "rightArm"]);
        for (const name of ["tail", "", "constructor", "leftThumbTip", "toString"]) expect(bodyPartOf(name), name).toBeNull();
    });
    it("is optional on the avatar tracking and checks the intensity and the parts", () => {
        const ids = { bodySourceId: null, faceSourceId: null };
        expect(AvatarTrackingSchema.safeParse(ids).success).toBe(true);
        expect(AvatarTrackingSchema.safeParse({ ...ids, body: DEFAULT_AVATAR_BODY_TRACKING }).success).toBe(true);
        expect(AvatarTrackingSchema.safeParse({ ...ids, body: { movementIntensity: 0, trackedParts: [] } }).success).toBe(true);
        expect(AvatarTrackingSchema.safeParse({ ...ids, body: { movementIntensity: 2, trackedParts: ["rightLeg", "head"] } }).success).toBe(true);
        for (const body of [{ movementIntensity: 2.01, trackedParts: [] }, { movementIntensity: -0.01, trackedParts: [] }, { movementIntensity: 1, trackedParts: ["head", "head"] }, { movementIntensity: 1, trackedParts: ["tail"] }, { movementIntensity: 1 }, { trackedParts: [] }, { movementIntensity: 1, trackedParts: [], fade: 1 }])
            expect(AvatarTrackingSchema.safeParse({ ...ids, body }).success, JSON.stringify(body)).toBe(false);
    });
    it("stores no group for the default and the parts in the fixed order", () => {
        expect(Object.isFrozen(DEFAULT_AVATAR_BODY_TRACKING) && Object.isFrozen(DEFAULT_AVATAR_BODY_TRACKING.trackedParts)).toBe(true);
        expect(normalizeBodyTracking(undefined)).toBeUndefined();
        expect(normalizeBodyTracking(DEFAULT_AVATAR_BODY_TRACKING)).toBeUndefined();
        expect(normalizeBodyTracking({ movementIntensity: 1, trackedParts: [...BODY_PARTS].reverse() })).toBeUndefined();
        expect(normalizeBodyTracking({ movementIntensity: 1.5, trackedParts: [...BODY_PARTS] })).toEqual({ movementIntensity: 1.5, trackedParts: [...BODY_PARTS] });
        expect(normalizeBodyTracking({ movementIntensity: 1, trackedParts: ["rightLeg", "head", "body"] })).toEqual({ movementIntensity: 1, trackedParts: ["head", "body", "rightLeg"] });
        expect(normalizeBodyTracking({ movementIntensity: 1, trackedParts: [] })).toEqual({ movementIntensity: 1, trackedParts: [] });
    });
});
