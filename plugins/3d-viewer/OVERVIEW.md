Opens 3D models from your workspace in a tab next to agents, terminals and files. It is
built for checking parts for 3D printing.

Supported formats: STL, STEP/STP, 3MF, OBJ, PLY, glTF/GLB, IGES and OpenCascade BREP. The
viewer orbits, zooms and pans, and has a millimetre grid, fit-to-view with isometric,
top, front and right presets, a shaded/wireframe toggle and a bounding-box overlay. It
shows the bounding-box size in millimetres. 3MF units are applied, glTF metres are
converted, and Y-up files are turned Z-up.

Open it from the Command Center with "Open 3D model viewer". It lists the models in the
workspace. You can also type `/view3d path/to/part.step` in the composer.

STEP, IGES and BREP files are converted to triangle meshes on the daemon with a bundled
copy of OpenCascade. Other formats are read on the daemon and drawn in the app. The
plugin reads only files with these extensions inside the current workspace, and makes no
network requests.

The 3D view works in the Paseo desktop app and in a browser. The iOS and Android apps
list the models, and show STEP, IGES and BREP dimensions, but cannot draw them.

Requires Paseo 0.11.1 or later. Draco-compressed glTF, OBJ material files, point clouds
and native CAD formats such as FreeCAD or Fusion files are not supported.
