import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeBase64 } from "../shared/base64";
import { extensionOf, formatForPath, MODEL_EXTENSIONS, sniffMismatch, type ModelFormat } from "../shared/formats";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

describe("formatForPath", () => {
  it.each([
    ["part.stl", "stl"],
    ["PART.STL", "stl"],
    ["dir/part.step", "step"],
    ["part.stp", "step"],
    ["C:\\cad\\part.STP", "step"],
    ["part.igs", "iges"],
    ["part.iges", "iges"],
    ["part.brep", "brep"],
    ["part.brp", "brep"],
    ["part.3mf", "3mf"],
    ["part.obj", "obj"],
    ["part.ply", "ply"],
    ["scene.gltf", "gltf"],
    ["scene.glb", "glb"],
  ])("%s is %s", (path, format) => {
    expect(formatForPath(path)?.format).toBe(format);
  });

  it("rejects unsupported and extensionless files", () => {
    expect(formatForPath("part.fcstd")).toBeNull();
    expect(formatForPath("stl")).toBeNull();
    expect(formatForPath(".stl")).toBeNull();
    expect(formatForPath("dir.stl/readme")).toBeNull();
  });

  it("classifies CAD formats for daemon tessellation", () => {
    expect(formatForPath("a.step")?.kind).toBe("cad");
    expect(formatForPath("a.igs")?.kind).toBe("cad");
    expect(formatForPath("a.brep")?.kind).toBe("cad");
    expect(formatForPath("a.stl")?.kind).toBe("mesh");
  });

  it("lists every extension without dots", () => {
    expect(MODEL_EXTENSIONS).toContain("stp");
    expect(MODEL_EXTENSIONS.every((extension) => !extension.includes("."))).toBe(true);
    expect(extensionOf("/a/b/c.Tar.GZ")).toBe("gz");
  });
});

describe("sniffMismatch", () => {
  it.each<[string, ModelFormat]>([
    ["test_adapter.stl", "stl"],
    ["tetra-ascii.stl", "stl"],
    ["test_adapter.step", "step"],
    ["cube.glb", "glb"],
    ["cube.gltf", "gltf"],
    ["cube-cm.3mf", "3mf"],
    ["cube.ply", "ply"],
    ["cube.obj", "obj"],
    ["bracket.igs", "iges"],
    ["bracket.brep", "brep"],
  ])("accepts %s", (name, format) => {
    const bytes = fixture(name);
    expect(sniffMismatch(format, bytes.subarray(0, 512), bytes.length)).toBeNull();
  });

  it("accepts glTF JSON with a byte order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('{"asset":{}}')]);
    expect(sniffMismatch("gltf", bytes, bytes.length)).toBeNull();
  });

  it("rejects mislabelled files", () => {
    const step = fixture("test_adapter.step");
    expect(sniffMismatch("stl", step.subarray(0, 512), step.length)).toMatch(/STL/);
    expect(sniffMismatch("glb", step.subarray(0, 512), step.length)).toMatch(/glTF/);
    const stl = fixture("test_adapter.stl");
    expect(sniffMismatch("step", stl.subarray(0, 512), stl.length)).toMatch(/STEP/);
    expect(sniffMismatch("3mf", stl.subarray(0, 512), stl.length)).toMatch(/ZIP/);
  });
});

describe("decodeBase64", () => {
  it("matches Buffer for every padding length", () => {
    for (let length = 0; length < 70; length++) {
      const bytes = new Uint8Array(length).map((_, index) => (index * 37 + length) & 0xff);
      expect(decodeBase64(Buffer.from(bytes).toString("base64"))).toEqual(bytes);
    }
  });

  it("rejects invalid characters", () => {
    expect(() => decodeBase64("ab$d")).toThrow(/Invalid base64/);
  });
});
