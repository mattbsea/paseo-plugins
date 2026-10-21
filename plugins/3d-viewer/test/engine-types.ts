// Compile-time only (npm run typecheck): client/vendor/viewer-engine.d.ts is hand-written
// so a Git install needs no three.js types. This fails when engine/ drifts from it.
import type * as Declared from "../client/vendor/viewer-engine";
import * as engine from "../engine/index";

export const createViewer: (container: HTMLElement, colors: Declared.ViewerColors) => Declared.Viewer = engine.createViewer;
export const niceStep: typeof Declared.niceStep = engine.niceStep;
export const stats: (value: engine.ModelStats) => Declared.ModelStats = (value) => value;
export const viewer: (value: engine.Viewer) => Declared.Viewer = (value) => value;
