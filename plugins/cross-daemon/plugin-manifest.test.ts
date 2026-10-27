import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readJson(path: string) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

describe("plugin manifest", () => {
  const manifest = readJson("./paseo-plugin.json");
  const pins = readJson("./package.json").devDependencies;

  it("asks for the Paseo release it was built against, up to the next minor", () => {
    const [, floor, ceiling] = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/.exec(manifest.requirements.paseo) ?? [];
    expect(floor).toBe(pins["@getpaseo/plugin"]);
    const [major, minor] = floor.split(".").map(Number);
    expect(ceiling).toBe(`${major}.${minor + 1}.0`);
  });

  it("pins the three Paseo packages to one version", () => {
    expect(pins["@getpaseo/client"]).toBe(pins["@getpaseo/plugin"]);
    expect(pins["@getpaseo/protocol"]).toBe(pins["@getpaseo/plugin"]);
  });
});
