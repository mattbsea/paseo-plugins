import { Platform } from "react-native";
import type { Viewer, ViewerColors } from "./vendor/viewer-engine";

// The only module that touches browser APIs. The WebGL engine (three.js) is required
// lazily so iOS and Android never evaluate it.

// Bundled by Paseo's esbuild into a lazily evaluated module; typed here because this
// project has neither DOM nor Node types.
declare const require: (id: string) => unknown;

export type { Viewer, ViewerColors };

export const canRender3d = Platform.OS === "web";

/**
 * Mounts a WebGL viewport inside `host`, the DOM node React Native Web renders for a
 * <View>. Returns null on native platforms.
 */
export function mountViewer(host: unknown, colors: ViewerColors): Viewer | null {
  if (!canRender3d || !host) return null;
  const engine = require("./vendor/viewer-engine.js") as typeof import("./vendor/viewer-engine");
  return engine.createViewer(host as object, colors);
}
