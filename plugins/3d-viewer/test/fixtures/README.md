# Test fixtures

| File | Source | Expected size (mm) |
| --- | --- | --- |
| `test_adapter.step`, `.stl` | `scripts/make-cad-fixtures.py` (stepped tube with a slot) | 53 x 53 x 73 |
| `bracket.igs`, `bracket.brep` | `scripts/make-cad-fixtures.py` (OpenCascade via `cadquery-ocp`) | 40 x 20 x 10 |
| `cube.obj`, `cube.ply`, `tetra-ascii.stl` | `scripts/make-mesh-fixtures.mjs` | 10 x 10 x 10 |
| `cube-cm.3mf` | same; `unit="centimeter"`, 2 units | 20 x 20 x 20 |
| `cube.gltf`, `cube.glb`, `cube-external.gltf` + `.bin` | same; metres, 0.03 units | 30 x 30 x 30 |
| `tall-y.glb` | same; Y-up 0.01 x 0.05 x 0.02 m | 10 x 20 x 50 (Z-up) |
