// Writes small hand-built mesh fixtures to test/fixtures/. Each encodes a cube whose
// size in millimetres is known only after the format's unit and axis rules are applied:
//
//   cube.obj, cube.ply, tetra-ascii.stl   10 mm (unitless, read as mm)
//   cube-cm.3mf                           unit="centimeter", 2 units  -> 20 mm
//   cube.gltf / cube.glb                  metres, 0.03 units          -> 30 mm
//   cube-external.gltf + .bin             same, with an external buffer
//   tall-y.glb                            0.01 x 0.05 x 0.02 m, Y-up -> 10 x 20 x 50 mm Z-up
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "three/examples/jsm/libs/fflate.module.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");

// Unit cube corners and 12 outward-facing triangles.
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const TRIANGLES = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
  [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
];
const scaled = (sx, sy = sx, sz = sx) => CORNERS.map(([x, y, z]) => [x * sx, y * sy, z * sz]);

function obj() {
  const lines = ["# 10 mm cube", "o cube"];
  for (const [x, y, z] of scaled(10)) lines.push(`v ${x} ${y} ${z}`);
  for (const [a, b, c] of TRIANGLES) lines.push(`f ${a + 1} ${b + 1} ${c + 1}`);
  return lines.join("\n") + "\n";
}

function ply() {
  const colors = CORNERS.map(([x, y, z]) => [x * 255, y * 255, z * 255]);
  const lines = [
    "ply",
    "format ascii 1.0",
    "comment 10 mm cube with vertex colours",
    `element vertex ${CORNERS.length}`,
    "property float x", "property float y", "property float z",
    "property uchar red", "property uchar green", "property uchar blue",
    `element face ${TRIANGLES.length}`,
    "property list uchar int vertex_indices",
    "end_header",
  ];
  scaled(10).forEach(([x, y, z], index) => lines.push(`${x} ${y} ${z} ${colors[index].join(" ")}`));
  for (const triangle of TRIANGLES) lines.push(`3 ${triangle.join(" ")}`);
  return lines.join("\n") + "\n";
}

function asciiStl() {
  // Regular tetrahedron-ish: 10 x 10 x 10 mm bounding box.
  const p = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]];
  const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  const lines = ["solid tetra"];
  for (const face of faces) {
    lines.push("  facet normal 0 0 0", "    outer loop");
    for (const index of face) lines.push(`      vertex ${p[index].join(" ")}`);
    lines.push("    endloop", "  endfacet");
  }
  lines.push("endsolid tetra");
  return lines.join("\n") + "\n";
}

function threeMf() {
  const vertices = scaled(2)
    .map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`)
    .join("");
  const triangles = TRIANGLES.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("");
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="centimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<resources><object id="1" type="model"><mesh><vertices>${vertices}</vertices>` +
    `<triangles>${triangles}</triangles></mesh></object></resources>` +
    `<build><item objectid="1"/></build></model>`;
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
    ),
    "3D/3dmodel.model": strToU8(model),
  });
}

/** One indexed mesh as a glTF document plus its binary buffer. */
function gltfParts([sx, sy, sz]) {
  const positions = new Float32Array(scaled(sx, sy, sz).flat());
  const indices = new Uint16Array(TRIANGLES.flat());
  const bin = new Uint8Array(positions.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  const json = {
    asset: { version: "2.0", generator: "viewer-3d fixtures" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "cube" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.5, 0.9, 1] } }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [0, 0, 0], max: [sx, sy, sz] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
  };
  return { json, bin };
}

function glb(size) {
  const { json, bin } = gltfParts(size);
  const pad = (bytes, fill) => {
    const padded = new Uint8Array((bytes.length + 3) & ~3).fill(fill);
    padded.set(bytes);
    return padded;
  };
  const jsonChunk = pad(strToU8(JSON.stringify(json)), 0x20);
  const binChunk = pad(bin, 0);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  output.set(jsonChunk, 20);
  view.setUint32(20 + jsonChunk.length, binChunk.length, true);
  view.setUint32(24 + jsonChunk.length, 0x004e4942, true); // "BIN\0"
  output.set(binChunk, 28 + jsonChunk.length);
  return output;
}

const embedded = gltfParts([0.03, 0.03, 0.03]);
embedded.json.buffers[0].uri = `data:application/octet-stream;base64,${Buffer.from(embedded.bin).toString("base64")}`;
const external = gltfParts([0.03, 0.03, 0.03]);
external.json.buffers[0].uri = "cube-external.bin";

const files = {
  "cube.obj": obj(),
  "cube.ply": ply(),
  "tetra-ascii.stl": asciiStl(),
  "cube-cm.3mf": threeMf(),
  "cube.gltf": JSON.stringify(embedded.json, null, 2) + "\n",
  "cube-external.gltf": JSON.stringify(external.json, null, 2) + "\n",
  "cube-external.bin": external.bin,
  "cube.glb": glb([0.03, 0.03, 0.03]),
  "tall-y.glb": glb([0.01, 0.05, 0.02]),
};
for (const [name, contents] of Object.entries(files)) {
  writeFileSync(join(out, name), contents);
  console.log(`wrote ${name}`);
}
