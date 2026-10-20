# 10 Change keyboard shortcuts (#161)

Who: later, after masking. Plan with Opus first: keys are handled in several places (`src/canvas/CanvasView.tsx` onKeyDown, `src/ui/TimeStrip.tsx`, `src/video/keys.ts`, `src/ui/menu.ts`), and the list lives in `src/ui/shortcuts.ts`. They need one table of actions first.
