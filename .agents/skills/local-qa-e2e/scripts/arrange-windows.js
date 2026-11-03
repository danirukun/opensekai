#!/usr/bin/env osascript -l JavaScript
// Fit the OpenSekai window to the main screen's visible frame, raise it on top,
// and print the ffmpeg crop that keeps only that area.
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

  // The window minimum comes from apps/desktop/src-tauri/tauri.conf.json (960 × 600).
  if (width < 960 || height < 600) throw new Error(`Screen too small: ${width} × ${height} pt visible, need 960 × 600 pt.`);

  const events = Application('System Events');
  const app = events.processes.byName(processName);
  if (!app.exists()) throw new Error(`No process ${processName}. Is the app running?`);
  const windows = app.windows();
  const window = windows.find(item => item.name() === 'OpenSekai');
  if (!window) throw new Error(`Window not found. Open windows: ${windows.map(item => item.name()).join(', ')}`);

  window.position = [left, top];
  window.size = [width, height];
  app.frontmost = true;
  window.actions.byName('AXRaise').perform();

  const fraction = value => (value).toFixed(5);
  // Even sizes, because H.264 with yuv420p rejects odd dimensions.
  const crop = `crop=trunc(iw*${fraction(width / full.size.width)}/2)*2:trunc(ih*${fraction(height / full.size.height)}/2)*2:trunc(iw*${fraction(left / full.size.width)}):trunc(ih*${fraction(top / full.size.height)})`;
  return JSON.stringify({
    screen: { width: full.size.width, height: full.size.height },
    window: { x: left, y: top, width, height },
    crop,
  }, null, 2);
}
