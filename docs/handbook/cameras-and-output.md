# Cameras and output

## Cameras

A camera shows the scene from one position. A scene can have 8 cameras. To add a camera, click **Add asset** and select **Camera**.

The Properties column of a camera has these sections:

- **Rendering**: **Render Environment** and **Anti-aliasing**.
- **Grading**: tone mapping, exposure, color, and bloom.
- **Lens**: the field of view and other lens settings.
- **Control**: the **Control Mode** (None, Free Look, or Orbit Character) and its settings. The mode sets how the mouse moves the camera in the Scene view.
- **Screenshot**: **Take Screenshot** saves a transparent PNG of the camera view. **Open Screenshots Folder** opens the folder of the screenshots.

To send a camera to the output, right-click it in the asset list and click **Use as output camera**.

## Output

The **Output** panel controls the image that OBS shows.

1. In **Camera**, select the output camera.
2. In **Quality**, select **Production**, **Performance**, or **Preview**.
3. Click **Copy OBS URL**. In OBS, add a browser source and paste the URL. You can also drag **Drag to OBS** into OBS.

The state next to the camera shows **OBS ready**, **OBS waiting**, or **OBS disconnected**.

These settings also change the output:

- **Resolution**: the size of the output.
- **Render scale**: the resolution at which OpenSekai draws the output.
- **Frame limit**: 30 FPS or 60 FPS.

The output has a transparent background. The output continues when the editor window is minimized.
