# Scene Camera Frame Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this bounded slice.

**Goal:** Show the exact preview image boundary without adding a frame to OBS.

**Architecture:** A fitted DOM surface contains the canvas and a pointer-transparent frame. The existing renderer and VRM node-material path remain in place.

**Tech Stack:** Svelte 5, CSS, Three.js 0.180.0, three-vrm 3.5.5.

**Spec:** docs/superpowers/specs/2026-10-04-camera-frame-design.md

## Global Constraints
Use a 24 pixel inset and the current 16:9 output ratio. Do not add dependencies, output overlays, or redundant UI copy.

## Review Focus
Collapsed viewport clamps to zero. Wide and tall layouts fit within both dimensions. Frame does not change canvas size. Pointer actions reach the canvas. OBS shows only the rendered image.

## Task 1: Frame layout
- [x] Add pure fit tests: fitPreview(800,300,24) gives width 448 and height 252; fitPreview(320,600,24) gives width 272 and height 153; fitPreview(20,20,24) gives zero dimensions.
- [x] Add an optional inset argument to fitPreview, default zero. Fit using width and height minus twice the inset.
- [x] In App.svelte, store the fitted surface dimensions in Svelte state and update them from ResizeObserver. Put the canvas inside a surface div with these dimensions, with an aria-hidden frame sibling.
- [x] In app.css, make the viewport dark, move checkerboard to the surface, set canvas width and height to 100%, and draw an inset frame with pointer-events:none.
- [x] Run pnpm test:unit apps/desktop/test/ui-message.test.ts and pnpm check.

## Task 2: Runtime acceptance and checkpoint
- [x] Save the current scene privately, run pnpm build:mac, restart the app, and restore the original entities and settings.
- [x] Inspect the Scene window and resize it. Check frame edges and canvas interaction.
- [x] Use an isolated local OBS source with the current output URL. Inspect clean output and actual WebGPU status. Restore the previous OBS scene.
- [x] Add scoped evidence and parity status, review the diff, and commit source plus contract.
