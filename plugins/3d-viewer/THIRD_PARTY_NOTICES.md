# Third-party notices

## three.js

`client/vendor/viewer-engine.js` contains portions of [three.js](https://github.com/mrdoob/three.js)
0.186.1 (core, `OrbitControls`, `STLLoader`, `OBJLoader`, `PLYLoader`, `3MFLoader`,
`GLTFLoader`, `BufferGeometryUtils`, `SkeletonUtils` and the bundled fflate), under the MIT
License. The full text is in `client/vendor/LICENSE.three.txt`. fflate is MIT-licensed,
Copyright (c) 2023 Arjun Barrett.

## occt-import-js and Open CASCADE Technology

`server/vendor/occt-import-js.js` and the wasm in `server/vendor/occt-wasm.js` are
[occt-import-js](https://github.com/kovacsv/occt-import-js) 0.0.23 by Viktor Kovacs. That
library compiles [Open CASCADE Technology](https://dev.opencascade.org/) to WebAssembly.
Both are licensed under the GNU Lesser General Public License version 2.1; Open CASCADE
also grants an additional exception. The full texts are in
`server/vendor/LICENSE.occt-import-js.txt` and `server/vendor/LICENSE.occt.txt`.

The library is distributed unmodified. The JavaScript is byte-for-byte the published
file. The wasm is the published file, brotli-compressed and base64-encoded, and the
plugin decompresses it before instantiating it. You may replace it with another build.
Source code is available from the links above. To rebuild these files from any version
of the npm package, run `npm run build:vendor`.
