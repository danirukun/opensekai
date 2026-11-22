# Characters

A character shows a VRM model in the scene. A scene can have two characters.

## Add a character

1. Click **Add asset** and select **Character**.
2. In the **Model** row of the Properties column, select a VRM file.

OpenSekai loads the model in the background. A progress bar shows the load stage.

To use a different model, select a different file in the **Model** row.

## Expressions

The **Expressions** section shows the expressions of the VRM model. Use the switch of an expression to turn it on or off. Click the arrow next to an expression to see its settings:

- **Layer**: the layer of the expression.
- **Fade (s)**: the time that the expression takes to fade in and fade out.
- **Suppress tracking**: when the expression is on, tracking does not move the selected parts (**Blink**, **Mouth**, or **Brow**).

## Meshes

The **Meshes** section shows the mesh parts of the model. Clear the check box of a part to hide it. For example, you can hide a hat or a coat.

## Debug

The **Debug** section is the last section. It starts folded. It shows what the loaded VRM file contains:

- The VRM version, the generator, the glTF version, the size, and the SHA-256 of the file.
- The glTF extensions of the file. An extension that the file requires has the mark *required*.
- The meta data of the model (for example the name, the authors, and the license) and the counts of nodes, meshes, materials, textures, bones, expressions, and spring bones.
- For the material that you select: its profile, its extensions, the alpha mode, the cull, and for a lilToon material its lilToon version, shader variant, and queue. Its textures, with the size and the color space. Its properties, with a search field.
- The load warnings of the file.

Click **Copy JSON** to copy all of this data to the clipboard.

## Tracking

The **Tracking** section connects the character to tracking sources:

- **Idle animation**: the character stands with the hands down and a small chest sway, or plays an imported VRMA clip, when no source moves it. **Idle source** chooses Builtin or a clip. **Import animation** adds a `.vrma` file.
- **Body source**, **Face source**, and **Fingers source**: the tracking source for each part.
- **Tracked Body Parts**: the parts that tracking moves. A part that is off shows the idle pose.
- **Body Movement Intensity**: how much the body follows the source.
- **Set up tracking**: opens the tracking guide.

See [Motion capture](motion-capture.md) for the tracking sources and the guide.
