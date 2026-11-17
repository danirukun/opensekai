# Stage

The stage is the world around your characters. It has an environment, props, lights, haze, and screens.

## Environment

An environment is a 3D model of a room or a stage. A scene can have one environment.

1. Click **Add asset** and select **Environment**.
2. In **Source**, select a model or click **Import file…**. You can import a glTF, a GLB, or a zip file.

**Reflections Intensity** sets the strength of the reflections on the environment. If the model has credits, the Properties column shows them.

## Props

A prop is a 3D model in the scene, for example a chair or a desk. A scene can have many props, and more than one prop can use the same model.

1. Click **Add asset** and select **Prop**.
2. In **Source**, select a model or click **Import file…**.

## Lights

Click **Add asset** and select **Directional Light**, **Point Light**, **Spot Light**, or **Ambient Light**. A new scene has one directional light.

The light settings are:

- **Type**, **Color**, and **Intensity**.
- **Range (m)** for a point light or a spot light.
- **Angle (°)** and **Penumbra** for a spot light.
- **Volumetric**: the light makes a beam in a haze.
- **Affect** section: the light can affect characters, props, and the environment separately.
- **Shadow** section: **Shadow Intensity**, **Soft Shadows**, **Bias**, and **Normal Bias**.

Click **Set Direction From Main Camera** to aim a directional light in the direction of the main camera.

## Haze

A haze is a box in which volumetric lights make beams. Click **Add asset** and select **Haze**. The settings are **Density**, **Smoke**, **Intensity**, and **Drift (m/s)**.

## Screens

A screen is a flat surface in the scene that shows content. Click **Add asset** and select **Screen**. In **Content**, select one of these:

- **Image**: a PNG, JPEG, WebP, or GIF file.
- **Video**: an MP4 or WebM file, with play controls.
- **Web page**: an `https:` page.
- **Display** or **Window**: a live capture of a display or a window on this computer.

## FPS counter

The FPS counter shows the frame rate on the output. A scene can have one FPS counter. Click **Add asset** and select **FPS Counter**. The settings are **Corner**, **Size**, and **Color**.

For the status of each stage feature, see [the parity checklist](../warudo-parity.md#environment-props-and-lighting).
