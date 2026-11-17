# Motion capture

A tracking source receives motion from an app or a camera. A character uses the motion of its sources. See [Characters](characters.md#tracking) to connect a source to a character.

## Tracking sources

Click **Add asset** and select one of these sources:

- **VMC Receiver**: receives the VMC protocol over the network.
- **iFacialMocap Receiver**: receives face data from the iFacialMocap app on a phone.
- **OpenSeeFace Receiver**: receives face data from the OpenSeeFace tracker.
- **MediaPipe Tracker**: tracks the face, the upper body, and the fingers with a camera on this computer.
- **FaceKit Tracker**: tracks the face with a camera on this computer. This source is available on macOS only.

The Properties column of a source has these sections:

- **Receiver**: the address, the port, the camera, or other input settings.
- **Smoothing**: the filter that removes small jumps in the motion.
- **Face**: calibration and the face mapping.
- **Diagnostics**: the state of the source.

To start or stop a source, right-click it in the asset list and click **Start** or **Stop**.

## Tracking guide

The tracking guide connects a phone app to a character, step by step.

1. Select a character.
2. In the **Tracking** section, click **Set up tracking**.
3. Select the app: **SelfReflect**, **iFacialMocap**, or **Other VMC app**.
4. Do the steps that the guide shows. The guide shows the address to type in the app, or asks for the address of the phone. Then it asks you to make some faces.

To stop the guide, click **Close**. If you close the guide before it fits the face ranges, it removes the source that it added.

## VMC sender

A VMC sender sends the pose of a character to a different app with the VMC protocol.

1. Click **Add asset** and select **VMC Sender**.
2. Type the **IP Address** and the **Port** of the receiving app. Click **Apply**.
3. In **Character**, select the character to send.
4. Click **Start**.

A new VMC sender is stopped. The state shows next to the **Start** button.
