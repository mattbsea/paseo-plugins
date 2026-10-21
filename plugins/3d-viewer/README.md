# 3D model viewer for Paseo

Opens 3D models from a workspace in a Paseo workspace tab next to agents, terminals and
files. It has orbit, zoom and pan, a millimetre grid, fit-to-view with iso, top, front
and right presets, a shaded/wireframe toggle, a bounding-box overlay, and a readout of
the bounding-box size in millimetres.

Plugin ID: `viewer-3d`. IDs must start with a letter, so the ID differs from the
directory name.

## Install

```bash
paseo plugin add git:mattbsea/paseo-plugins:plugins/3d-viewer
# equivalent legacy form
paseo plugin add git:mattbsea/paseo-plugins --path plugins/3d-viewer
# a branch or tag
paseo plugin add git:mattbsea/paseo-plugins:plugins/3d-viewer --ref feat/3d-viewer
```

The `git:` prefix is required: a bare `owner/name` is a registry ID. The install runs no package manager and needs no network beyond the Git
fetch. See [Bundled dependencies](#bundled-dependencies).

Requires Paseo 0.11.1 or later for both the daemon and the app.

## Use it

- **⌘K / Ctrl+K → "Open 3D model viewer"** opens the **3D models** tab for the current
  workspace. It lists every supported file in the workspace. Hidden directories,
  `node_modules`, `dist`, `build`, `out`, `target` and `venv` are skipped. Pick a file to
  view it.
- **`/view3d path/to/part.step`** in the composer opens that file in the tab. The path is
  relative to the workspace.
- The tab can also go in the Explorer sidebar.
- **Paseo 0.13+ (unreleased when this was written):** the plugin also registers a
  *file panel*, so model files opened from the file explorer offer **3D model** in
  "Open with". This path is feature-detected and has not been run against a real 0.13
  host. See [Limitations](#limitations).

Toolbar buttons:

| Button | Action |
| --- | --- |
| Fit / Top / Front / Right | Fit the model in an isometric view or an orthogonal direction |
| Shaded / Wireframe | Switch the shading mode |
| Grid | Show or hide the grid on the XY plane at the bottom of the part, with 1/2/5 x 10ⁿ mm cells |
| Box | Show or hide the bounding-box outline |
| Reload | Re-read the file from disk |

Mouse controls: left-drag orbits, right-drag or shift-drag pans, and the wheel zooms
toward the cursor. On touch, one finger orbits and two fingers zoom and pan.

## Formats

| Format | Extensions | Parsed by | Where | Units and axes |
| --- | --- | --- | --- | --- |
| STL (binary and ASCII) | `.stl` | three.js `STLLoader` | client | mm, Z-up |
| STEP | `.step`, `.stp` | OpenCascade via `occt-import-js` | daemon | converted to mm, Z-up |
| IGES | `.iges`, `.igs` | OpenCascade via `occt-import-js` | daemon | converted to mm, Z-up |
| OpenCascade BREP | `.brep`, `.brp` | OpenCascade via `occt-import-js` | daemon | unitless, read as mm |
| 3MF | `.3mf` | three.js `ThreeMFLoader` | client | the file's `unit` attribute is applied (three's loader ignores it) |
| OBJ | `.obj` | three.js `OBJLoader` | client | mm, Z-up |
| PLY (ASCII and binary) | `.ply` | three.js `PLYLoader` | client | mm, Z-up; vertex colours kept |
| glTF / GLB | `.gltf`, `.glb` | three.js `GLTFLoader` | client | metres → mm; Y-up rotated to Z-up |

STL, OBJ and PLY carry no unit. The viewer treats them as millimetres, which is what
slicers and CAD tools export.

STEP, IGES and BREP are tessellated on the daemon with a deflection of 0.1% of the
bounding-box diagonal and 0.5 rad, then sent as triangle meshes. Colours from the CAD
file are kept, per shape and per face. The daemon reports the bounding box without
loading anything into the client, so phones can show CAD dimensions too.

### Not supported

These are stated rather than half-done:

- **glTF compression extensions**: Draco (`KHR_draco_mesh_compression`), meshopt and
  KTX2/Basis textures. Each needs an extra decoder (wasm or worker) and is uncommon for
  mechanical parts. Such files fail with the loader's error.
- **OBJ materials**: `.mtl` files are not read, so OBJ meshes use the viewer's colour.
- **GLB files that reference external files** are refused, so the client never fetches
  anything. Use `.gltf` for external resources; the daemon inlines those, within the same
  size limit.
- **PLY point clouds** with no faces are rejected with a message.
- **3MF extensions**: beam lattices, slices and volumetric data. Colours and base
  materials do display.
- **FreeCAD `.FCStd`, Fusion `.f3d`, SolidWorks and other native CAD formats.** No
  maintained, permissively usable npm library reads them.
- **Native iOS/Android rendering.** See [Platforms](#platforms).

## Platforms

| Client | Behaviour |
| --- | --- |
| Paseo desktop (Electron), Paseo in a browser | Full WebGL viewer |
| iOS / Android app | File list, file details and, for STEP/IGES/BREP, the daemon-computed bounding box, plus a note that 3D preview needs the desktop or web app |

Plugin panels are React Native components. The host provides no WebGL view or JavaScript
WebView to native plugins, so there is no supported way to draw the model there. The
documented `DocumentFrame` disables JavaScript on native. All browser API use is confined
to `client/web.ts` behind `Platform.OS === "web"`, and the three.js engine is required
lazily from there, so native clients never evaluate it.

## How it works

```text
client (app)                                   daemon (plugin subprocess)
────────────                                   ──────────────────────────
models.list ─────────────────────────────────► scan workspace dir (limits: 5000 dirs, 2000 files)
model.open {workspaceId, path} ──────────────► resolve inside workspace (symlinks resolved first),
                                                 size limit, sniff header,
                                                 STEP/IGES/BREP → OpenCascade → mesh bundle,
                                                 .gltf → inline sibling .bin/images as data URIs,
                                                 keep the payload for 5 min
◄──────────── token, size, chunkCount, CAD dimensions
model.chunk {token, i} × n ──────────────────► 3 MiB slices, base64
three.js engine (web only) parses and renders
```

- Files are read on the daemon. The workspace root comes from the Paseo SDK
  (`workspaces.list`). Paths outside it, including through symlinks, are refused. Only the
  extensions above can be opened.
- Payloads move in 3 MiB chunks, about 4 MiB as base64, so no single RPC message is
  large. Limits: mesh files up to 256 MiB, CAD files up to 64 MiB. OpenCascade's memory
  use grows quickly beyond that.
- OpenCascade is instantiated once per plugin process, which takes about 0.15 s
  including decompression. The 192 KiB STEP test part then tessellates in about 0.6 s
  (measured on the development host).
- The plugin makes no network requests.

## Bundled dependencies

Paseo compiles a plugin with esbuild when it installs it, and bundles whatever is in
`node_modules`. A Git install runs no `npm install` unless the manifest declares a
`build` step, so this plugin commits prebuilt copies of its dependencies instead. That
keeps installs offline and reproducible:

| File | Contents | Built from |
| --- | --- | --- |
| `client/vendor/viewer-engine.js` | `engine/` and the parts of three.js it uses, one minified ESM file with no imports (~680 KiB) | `engine/` + `three` |
| `client/vendor/viewer-engine.d.ts` | Hand-written, import-free types for it. Paseo's compiler follows type imports, so a declaration that imported `three` would fail without `node_modules`. `test/engine-types.ts` checks it against `engine/`. | — |
| `server/vendor/occt-import-js.js` | The Emscripten glue, verbatim | `occt-import-js` |
| `server/vendor/occt-wasm.js` | The 7.3 MiB `occt-import-js.wasm`, brotli-compressed and base64-encoded (~3 MiB) | `occt-import-js` |

**Why the wasm is embedded instead of shipped as a `.wasm` file:** Paseo evaluates the
compiled server bundle from a string in a forked process whose working directory is the
daemon's. The bundle has no `__dirname` and no API that reveals the plugin directory, so
there is no reliable path to read a sibling file from. Embedding it costs about 3 MiB of
repository and bundle size. Decompressing it takes about 55 ms.

The Emscripten glue reads `__dirname` once in Node, even when `wasmBinary` is supplied.
`server/occt.ts` defines a placeholder on `globalThis` while it instantiates, then
removes it. The vendored file itself is not modified.

To change the engine or upgrade a dependency:

```bash
npm install                 # at the repository root (npm workspaces)
npm run build:vendor        # in plugins/3d-viewer
npm test                    # unit tests + verifies the committed vendor files are current
npm run check:paseo-compile # compiles a clean copy with the installed Paseo's own compiler
```

### Library choices

| Library | Version | Licence | Why |
| --- | --- | --- | --- |
| [three](https://www.npmjs.com/package/three) | 0.186.1 | MIT | The standard WebGL library, released monthly. Its maintained loaders cover STL, OBJ, PLY, 3MF and glTF, and `OrbitControls` covers navigation. Only the modules the engine imports are bundled. |
| [occt-import-js](https://www.npmjs.com/package/occt-import-js) | 0.0.23 | LGPL-2.1 | OpenCascade compiled to wasm with a small API for STEP, IGES and BREP that returns triangulated meshes with colours. It is what Online 3D Viewer uses. The last release was December 2024, which is slow but not abandoned. The alternative, `opencascade.js`, was last released in 2023, is 66 MiB and needs a custom build to be practical. |

`occt-import-js` is LGPL-2.1. It is shipped unmodified, as separate files under
`server/vendor/` with its licence and OpenCascade's licence next to it, and it can be
replaced by re-running `npm run build:vendor` against another version. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Development

```bash
npm install                       # repository root
cd plugins/3d-viewer
npm run typecheck                 # app, daemon and engine/test configs
npm test                          # vitest (formats, server, OpenCascade, engine parsing) + vendor check
npm run check:paseo-compile       # simulated Git install with the local Paseo's compiler
paseo plugin install "$PWD"       # local directory install for trying it out
```

There are three TypeScript configs because the runtimes differ.
`tsconfig.json` covers the app (no DOM, no Node). Paseo's compiler reads it.
`tsconfig.server.json` covers the daemon, with Node types. `tsconfig.dev.json` covers
the engine and tests, with DOM and Node types. `engine/`, `test/` and `scripts/` are
never compiled by Paseo.

Fixtures and their expected sizes are listed in
[test/fixtures/README.md](test/fixtures/README.md).

## Limitations

- **File panels need Paseo 0.13, which is not released.** The documented `addFilePanel`
  API is not in `@getpaseo/plugin` 0.11 or 0.12. The plugin registers one only when the
  host provides it, using local types written from the public docs. Until 0.13 ships,
  models open from the **3D models** tab or `/view3d`, not by clicking a file in the
  explorer.
- **The manifest says `>=0.11.1`, not the `>=0.13.0` the docs ask of file-panel plugins.**
  This is deliberate. The file panel is optional and feature-detected, and declaring
  0.13 would block installation on every released Paseo.
- **OpenCascade runs on the plugin process's main thread with no timeout.** While a large
  STEP or IGES file is being tessellated, other requests from this plugin (the model
  list, chunk transfers) wait. The 64 MiB CAD limit bounds this, but a pathological file
  can still take a long time. Moving tessellation to a worker thread would fix it.
- Workspace panels take no parameters in 0.11/0.12. The file that `/view3d` chooses is
  kept in app memory, so a restored tab starts at the file list.
- The STEP and STL fixtures were rendered in headless Chromium using the same engine
  bundle. They have not been rendered inside the Paseo app.
