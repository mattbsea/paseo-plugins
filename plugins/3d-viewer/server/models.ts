import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { formatForPath, sniffMismatch } from "../shared/formats";
import { CHUNK_BYTES, MAX_CAD_FILE_BYTES, MAX_MESH_FILE_BYTES } from "../shared/limits";
import { encodeMeshBundle, type BundleMesh } from "../shared/mesh-bundle";
import type { listModelsRpc, modelChunkRpc, openModelRpc } from "../shared/rpc";
import { listModels, readModelFile, readSibling, workspaceRoot } from "./files";
import { assertSelfContainedGlb, inlineGltfResources } from "./gltf";
import { tessellate } from "./occt";

interface Prepared {
  payload: Uint8Array;
  expiresAt: number;
}

// Prepared payloads wait here until the client has fetched every chunk. A few recent
// models stay so switching back and forth does not re-read or re-tessellate.
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 4;
const MAX_CACHED_BYTES = 512 * 1024 * 1024;
const prepared = new Map<string, Prepared>();

function remember(payload: Uint8Array): string {
  const now = Date.now();
  for (const [token, entry] of prepared) if (entry.expiresAt < now) prepared.delete(token);
  const token = randomUUID();
  prepared.set(token, { payload, expiresAt: now + TTL_MS });
  let total = 0;
  for (const entry of prepared.values()) total += entry.payload.length;
  // Map iteration is insertion order, so the oldest entries go first.
  for (const [oldest, entry] of prepared) {
    if (prepared.size <= MAX_ENTRIES && total <= MAX_CACHED_BYTES) break;
    if (oldest === token) break;
    prepared.delete(oldest);
    total -= entry.payload.length;
  }
  return token;
}

export function clearPrepared() {
  prepared.clear();
}

export async function handleList(
  { workspaceId }: RpcInput<typeof listModelsRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof listModelsRpc>> {
  const root = await workspaceRoot(paseo, workspaceId);
  return { root, ...(await listModels(root)) };
}

export async function handleOpen(
  { workspaceId, path, includePayload }: RpcInput<typeof openModelRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof openModelRpc>> {
  const info = formatForPath(path);
  if (!info) throw new Error(`${basename(path)} is not a supported 3D format.`);
  const root = await workspaceRoot(paseo, workspaceId);
  const limit = info.kind === "cad" ? MAX_CAD_FILE_BYTES : MAX_MESH_FILE_BYTES;
  const file = await readModelFile(root, path, (size) => {
    if (size > limit) {
      throw new Error(`${basename(path)} is ${mebibytes(size)}; the viewer opens ${info.label} files up to ${mebibytes(limit)}.`);
    }
  });
  const mismatch = sniffMismatch(info.format, file.bytes.subarray(0, 512), file.bytes.length);
  if (mismatch) throw new Error(mismatch);

  let payload: Uint8Array;
  let dimensions: RpcOutput<typeof openModelRpc>["dimensions"] = null;
  let triangles: number | null = null;
  let conversionMs: number | null = null;
  if (info.kind === "cad") {
    const started = Date.now();
    const meshes = await tessellate(info.format as "step" | "iges" | "brep", file.bytes);
    conversionMs = Date.now() - started;
    payload = encodeMeshBundle(meshes);
    ({ dimensions, triangles } = measure(meshes));
  } else if (info.format === "gltf") {
    // Sidecar buffers and images count against the same limit as the .gltf itself.
    let budget = limit - file.bytes.length;
    payload = await inlineGltfResources(file.bytes, async (uri) => {
      const data = await readSibling(root, file.path, uri, budget);
      budget -= data.length;
      return data;
    }, limit);
  } else {
    if (info.format === "glb") assertSelfContainedGlb(file.bytes);
    payload = file.bytes;
  }

  return {
    token: includePayload ? remember(payload) : "",
    path: file.relativePath,
    name: basename(file.path),
    format: info.format,
    payload: info.kind === "cad" ? "mesh-bundle" : "file",
    fileBytes: file.bytes.length,
    modifiedMs: file.modifiedMs,
    payloadBytes: payload.length,
    chunkCount: includePayload ? Math.max(1, Math.ceil(payload.length / CHUNK_BYTES)) : 0,
    dimensions,
    triangles,
    conversionMs,
  };
}

export function handleChunk({ token, index }: RpcInput<typeof modelChunkRpc>): RpcOutput<typeof modelChunkRpc> {
  const entry = prepared.get(token);
  if (!entry) throw new Error("The model expired on the daemon. Reload it.");
  const start = index * CHUNK_BYTES;
  if (start >= entry.payload.length && !(index === 0 && entry.payload.length === 0)) {
    throw new Error("Chunk index out of range.");
  }
  entry.expiresAt = Date.now() + TTL_MS;
  const slice = entry.payload.subarray(start, start + CHUNK_BYTES);
  return { index, data: Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength).toString("base64") };
}

/** Axis-aligned bounding box size and triangle count of tessellated meshes. */
export function measure(meshes: readonly BundleMesh[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const mesh of meshes) {
    const positions = mesh.positions;
    for (let index = 0; index < positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = positions[index + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
    triangles += (mesh.indices ? mesh.indices.length : positions.length / 3) / 3;
  }
  return { dimensions: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] }, triangles };
}

function mebibytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
}
