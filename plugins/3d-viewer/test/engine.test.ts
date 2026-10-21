// @vitest-environment jsdom
// three's 3MF loader needs DOMParser; jsdom provides it. Rendering itself needs WebGL
// and is not covered here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { measure, niceStep, parseModel } from "../engine/index";
import type { ModelFormat } from "../shared/formats";
import { encodeMeshBundle } from "../shared/mesh-bundle";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

async function size(format: ModelFormat, name: string) {
  const stats = measure(await parseModel(format, "file", fixture(name)));
  return {
    ...stats,
    dimensions: Object.fromEntries(Object.entries(stats.dimensions).map(([axis, value]) => [axis, Math.round(value * 100) / 100])),
  };
}

describe("parseModel", () => {
  it("reads the binary STL test part in millimetres", async () => {
    const stats = await size("stl", "test_adapter.stl");
    expect(stats.dimensions.x).toBeCloseTo(53, 0);
    expect(stats.dimensions.y).toBeCloseTo(53, 0);
    expect(stats.dimensions.z).toBeCloseTo(73, 0);
    expect(stats.triangles).toBe(new DataView(fixture("test_adapter.stl").buffer).getUint32(80, true));
  });

  it.each<[ModelFormat, string, { x: number; y: number; z: number }]>([
    ["stl", "tetra-ascii.stl", { x: 10, y: 10, z: 10 }],
    ["obj", "cube.obj", { x: 10, y: 10, z: 10 }],
    ["ply", "cube.ply", { x: 10, y: 10, z: 10 }],
    // unit="centimeter"
    ["3mf", "cube-cm.3mf", { x: 20, y: 20, z: 20 }],
    // metres
    ["gltf", "cube.gltf", { x: 30, y: 30, z: 30 }],
    ["glb", "cube.glb", { x: 30, y: 30, z: 30 }],
    // Y-up 10 x 50 x 20 mm becomes Z-up 10 x 20 x 50 mm
    ["glb", "tall-y.glb", { x: 10, y: 20, z: 50 }],
  ])("%s %s", async (format, name, dimensions) => {
    const stats = await size(format, name);
    expect(stats.dimensions).toEqual(dimensions);
    expect(stats.triangles).toBeGreaterThanOrEqual(4);
  });

  it("shows PLY vertex colours untinted by the theme", async () => {
    const object = await parseModel("ply", "file", fixture("cube.ply"));
    let material: { vertexColors: boolean; color: { getHex(): number }; userData: Record<string, unknown> } | null = null;
    object.traverse((child) => {
      const candidate = (child as { material?: typeof material }).material;
      if (candidate) material = candidate;
    });
    expect(material!.vertexColors).toBe(true);
    expect(material!.color.getHex()).toBe(0xffffff);
    expect(Object.keys(material!.userData)).toHaveLength(0);
  });

  it("builds daemon mesh bundles with per-face colours", async () => {
    const bundle = encodeMeshBundle([
      {
        name: "two triangles",
        color: [0.5, 0.5, 0.5],
        positions: new Float32Array([0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 7]),
        normals: null,
        indices: new Uint32Array([0, 1, 2, 0, 1, 3]),
        faceColors: [{ first: 1, last: 1, color: [1, 0, 0] }],
      },
    ]);
    const object = await parseModel("step", "mesh-bundle", bundle);
    expect(measure(object)).toEqual({ dimensions: { x: 5, y: 5, z: 7 }, triangles: 2, meshes: 1 });
    let groups = 0;
    object.traverse((child) => {
      const geometry = (child as { geometry?: { groups: unknown[] } }).geometry;
      if (geometry) groups = geometry.groups.length;
    });
    expect(groups).toBe(2);
  });

  it("refuses CAD bytes that were not tessellated", async () => {
    await expect(parseModel("step", "file", fixture("test_adapter.step"))).rejects.toThrow(/daemon/);
  });
});

describe("niceStep", () => {
  it.each([
    [0.3, 0.5],
    [1, 1],
    [1.2, 2],
    [3, 5],
    [7, 10],
    [42, 50],
  ])("%d -> %d", (value, expected) => {
    expect(niceStep(value)).toBeCloseTo(expected, 10);
  });
});
