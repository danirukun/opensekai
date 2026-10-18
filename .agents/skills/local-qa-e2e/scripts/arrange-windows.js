#!/usr/bin/env osascript -l JavaScript
// Tile the OpenSekai Editor (left) and Scene (right) windows side by side over the main screen's
// visible frame, raise both on top, and print the ffmpeg crop that keeps only that area.
// Usage: osascript -l JavaScript arrange-windows.js [process name]
// Needs Accessibility permission for the terminal that runs it (System Settings > Privacy & Security).
ObjC.import('AppKit');

function run(argv) {
  const processName = argv[0] || 'opensekai-desktop';
  const screen = $.NSScreen.mainScreen;
  const full = screen.frame, visible = screen.visibleFrame;
  // Cocoa uses a bottom-left origin; System Events uses top-left.
  const left = visible.origin.x - full.origin.x;
  const top = full.size.height - (visible.origin.y - full.origin.y) - visible.size.height;
  const width = visible.size.width, height = visible.size.height;

  // Window minimums come from apps/desktop/src-tauri/tauri.conf.json (Editor 620, Scene 480).
  const editorWidth = Math.max(620, Math.round(width * 0.55));
  const sceneWidth = width - editorWidth;
  if (sceneWidth < 480) throw new Error(`Screen too narrow to tile: ${width} pt visible, need 1100 pt.`);

  const events = Application('System Events');
  const app = events.processes.byName(processName);
  if (!app.exists()) throw new Error(`No process ${processName}. Is the app running?`);
  const windows = app.windows();
  const find = test => {
    const match = windows.find(window => test(window.name()));
    if (!match) throw new Error(`Window not found. Open windows: ${windows.map(window => window.name()).join(', ')}`);
    return match;
  };
  const editor = find(name => name.includes('Editor'));
  const sceneWindow = find(name => name.includes('Scene'));

  const place = (window, x, w) => {
    window.position = [left + x, top];
    window.size = [w, height];
  };
  place(editor, 0, editorWidth);
  place(sceneWindow, editorWidth, sceneWidth);

  app.frontmost = true;
  sceneWindow.actions.byName('AXRaise').perform();
  editor.actions.byName('AXRaise').perform();

  const fraction = value => (value).toFixed(5);
  // Even sizes, because H.264 with yuv420p rejects odd dimensions.
  const crop = `crop=trunc(iw*${fraction(width / full.size.width)}/2)*2:trunc(ih*${fraction(height / full.size.height)}/2)*2:trunc(iw*${fraction(left / full.size.width)}):trunc(ih*${fraction(top / full.size.height)})`;
  return JSON.stringify({
    screen: { width: full.size.width, height: full.size.height },
    editor: { x: left, y: top, width: editorWidth, height },
    scene: { x: left + editorWidth, y: top, width: sceneWidth, height },
    crop,
  }, null, 2);
}
