import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeMeshBundle, encodeMeshBundle } from "../shared/mesh-bundle";
import { handleChunk, handleList, handleOpen, measure } from "../server/models";
import { tessellate } from "../server/occt";
import { CHUNK_BYTES } from "../shared/limits";

const fixtures = join(__dirname, "fixtures");
let workspace: string;
let context: PluginHandlerContext;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "viewer-3d-test-"));
  cpSync(fixtures, join(workspace, "models"), { recursive: true });
  // Things the list must skip and the reader must refuse.
  cpSync(join(fixtures, "cube.obj"), join(workspace, "node_modules", "pkg", "cube.obj"), { recursive: true });
  cpSync(join(fixtures, "cube.obj"), join(workspace, ".hidden", "cube.obj"), { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), "viewer-3d-outside-"));
  writeFileSync(join(outside, "secret.stl"), "solid x\nendsolid x\n");
  symlinkSync(join(outside, "secret.stl"), join(workspace, "escape.stl"));
  context = {
    paseo: {
      workspaces: {
        list: async () => ({
          entries: [{ id: "ws", workspaceDirectory: workspace }],
          pageInfo: { hasMore: false },
        }),
      },
    },
  } as unknown as PluginHandlerContext;
});

afterAll(() => rmSync(workspace, { recursive: true, force: true }));

async function payload(open: Awaited<ReturnType<typeof handleOpen>>): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for (let index = 0; index < open.chunkCount; index++) {
    parts.push(Buffer.from(handleChunk({ token: open.token, index }).data, "base64"));
  }
  return new Uint8Array(Buffer.concat(parts));
}

describe("models.list", () => {
  it("finds models and skips hidden and dependency directories", async () => {
    const { files, truncated } = await handleList({ workspaceId: "ws" }, context);
    const paths = files.map((file) => file.path);
    expect(truncated).toBe(false);
    expect(paths).toContain("models/test_adapter.step");
    expect(paths).toContain("models/cube-cm.3mf");
    expect(paths).not.toContain("node_modules/pkg/cube.obj");
    expect(paths.some((path) => path.startsWith(".hidden"))).toBe(false);
    expect(paths).not.toContain("models/cube-external.bin");
  });

  it("rejects unknown workspaces", async () => {
    await expect(handleList({ workspaceId: "nope" }, context)).rejects.toThrow(/not found/);
  });
});

describe("model.open", () => {
  it("tessellates the STEP test part to its real size", async () => {
    const open = await handleOpen({ workspaceId: "ws", path: "models/test_adapter.step" }, context);
    expect(open.payload).toBe("mesh-bundle");
    expect(open.dimensions!.x).toBeCloseTo(53, 0);
    expect(open.dimensions!.y).toBeCloseTo(53, 0);
    expect(open.dimensions!.z).toBeCloseTo(73, 0);
    const meshes = decodeMeshBundle(await payload(open));
    expect(measure(meshes).dimensions).toEqual(open.dimensions);
  }, 30_000);

  it("accepts absolute paths inside the workspace", async () => {
    const open = await handleOpen({ workspaceId: "ws", path: join(workspace, "models/cube.obj") }, context);
    expect(open.path).toBe("models/cube.obj");
    expect(Buffer.from(await payload(open)).toString()).toContain("o cube");
  });

  it("inlines external glTF buffers", async () => {
    const open = await handleOpen({ workspaceId: "ws", path: "models/cube-external.gltf" }, context);
    const json = JSON.parse(Buffer.from(await payload(open)).toString());
    expect(json.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/);
  });

  it("refuses paths and symlinks that leave the workspace", async () => {
    await expect(handleOpen({ workspaceId: "ws", path: "../x.stl" }, context)).rejects.toThrow(/outside/);
    await expect(handleOpen({ workspaceId: "ws", path: "/etc/x.stl" }, context)).rejects.toThrow(/outside/);
    await expect(handleOpen({ workspaceId: "ws", path: "escape.stl" }, context)).rejects.toThrow(/outside/);
  });

  it("refuses unsupported, missing and mislabelled files", async () => {
    await expect(handleOpen({ workspaceId: "ws", path: "models/cube-external.bin" }, context)).rejects.toThrow(/not a supported/);
    await expect(handleOpen({ workspaceId: "ws", path: "models/missing.stl" }, context)).rejects.toThrow(/not found/);
    writeFileSync(join(workspace, "fake.step"), "not a step file at all");
    await expect(handleOpen({ workspaceId: "ws", path: "fake.step" }, context)).rejects.toThrow(/ISO-10303-21/);
  });

  it("reports an expired token", () => {
    expect(() => handleChunk({ token: "missing", index: 0 })).toThrow(/expired/);
  });
});

describe("OpenCascade", () => {
  it.each([
    ["bracket.igs", "iges"],
    ["bracket.brep", "brep"],
  ] as const)("reads %s as a 40 x 20 x 10 mm block", async (name, format) => {
    const { readFileSync } = await import("node:fs");
    const meshes = await tessellate(format, new Uint8Array(readFileSync(join(fixtures, name))));
    const { dimensions, triangles } = measure(meshes);
    expect(dimensions.x).toBeCloseTo(40, 3);
    expect(dimensions.y).toBeCloseTo(20, 3);
    expect(dimensions.z).toBeCloseTo(10, 3);
    expect(triangles).toBeGreaterThan(12);
  });

  it("fails clearly on garbage", async () => {
    await expect(tessellate("brep", new Uint8Array([1, 2, 3]))).rejects.toThrow(/could not read|no surfaces/);
  });
});

describe("mesh bundle", () => {
  it("round-trips meshes, colours and non-ASCII names", () => {
    const meshes = [
      {
        name: "Bügel ⌀6",
        color: [1, 0.5, 0] as [number, number, number],
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        faceColors: [{ first: 0, last: 0, color: [0, 0, 1] as [number, number, number] }],
      },
      { name: "bare", color: null, positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]), normals: null, indices: null, faceColors: [] },
    ];
    expect(decodeMeshBundle(encodeMeshBundle(meshes))).toEqual(meshes);
  });

  it("rejects truncated data", () => {
    const bytes = encodeMeshBundle([
      { name: "a", color: null, positions: new Float32Array(9), normals: null, indices: null, faceColors: [] },
    ]);
    expect(() => decodeMeshBundle(bytes.subarray(0, bytes.length - 4))).toThrow(/Truncated/);
  });

  it("splits large payloads into chunks", async () => {
    const big = join(workspace, "big.stl");
    const triangles = Math.ceil((CHUNK_BYTES * 2.5) / 50);
    const bytes = Buffer.alloc(84 + triangles * 50);
    bytes.writeUInt32LE(triangles, 80);
    writeFileSync(big, bytes);
    const open = await handleOpen({ workspaceId: "ws", path: "big.stl" }, context);
    expect(open.chunkCount).toBe(3);
    expect((await payload(open)).length).toBe(bytes.length);
  });
});
