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

## Tracking

The **Tracking** section connects the character to tracking sources:

- **Idle animation**: the character plays a built-in idle motion when no source moves it.
- **Body source**, **Face source**, and **Fingers source**: the tracking source for each part.
- **Tracked Body Parts**: the parts that tracking moves. A part that is off shows the idle pose.
- **Body Movement Intensity**: how much the body follows the source.
- **Set up tracking**: opens the tracking guide.

See [Motion capture](motion-capture.md) for the tracking sources and the guide.
