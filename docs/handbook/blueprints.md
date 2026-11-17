# Blueprints

A Blueprint is a graph of nodes. When an event occurs, for example a hotkey, the Blueprint runs and changes the scene. The show file keeps the Blueprints. A show can have 8 Blueprints.

## Blueprint list

The list on the left side of the **Blueprints** panel shows the Blueprints of the show.

- **New blueprint** (the plus sign) adds an empty Blueprint.
- **Import blueprint** adds a Blueprint from a file.
- **Templates** adds a Blueprint that does a common task, for example **Camera Sway**.
- Double-click a name to rename the Blueprint.
- **Duplicate blueprint**, **Export blueprint**, and **Delete blueprint** show when you put the pointer on a row.
- **Enable** and **Disable** turn the Blueprint on or off. A disabled Blueprint does not run.

## Edit a graph

- Right-click the canvas, or click **Nodes** (the magnifying glass), to find and add a node.
- Drag from an output port to an input port to connect two nodes. Release a wire on empty canvas to find a node for it.
- Type a value in an input that has no wire.
- Select a node to see its settings at the right side.
- Click **Variables** to add values that the graph keeps.

The text next to the panel title shows a problem in the graph, if there is one. A graph with a problem continues to run its last correct version.

## Run and debug

Click **Run** to run a graph that starts with a manual event. Click **Debug output** to see the log of the Blueprints.

## Import from a link

A web page can have an `opensekai://` link to a Blueprint file. When you open the link, OpenSekai shows the name, the number of nodes, and the host of the file. Click **Import** to add the Blueprint. OpenSekai adds it disabled.
