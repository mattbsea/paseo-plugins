// A .gltf file is JSON that may reference sibling .bin buffers and texture images by
// relative URI. The client only receives one payload, so external references are read
// on the daemon (inside the workspace) and inlined as data URIs.

interface GltfJson {
  buffers?: { uri?: string }[];
  images?: { uri?: string; mimeType?: string }[];
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ktx2: "image/ktx2",
};

/** GLB normally embeds everything; external URIs would make the client fetch, so refuse. */
export function assertSelfContainedGlb(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(16, true) !== 0x4e4f534a) throw new Error("This GLB file has no JSON chunk.");
  const length = view.getUint32(12, true);
  let json: GltfJson;
  try {
    json = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset + 20, Math.min(length, bytes.length - 20)).toString("utf8")) as GltfJson;
  } catch {
    throw new Error("This GLB file's JSON chunk is invalid.");
  }
  const external = [...(json.buffers ?? []), ...(json.images ?? [])].some((entry) => entry.uri && !entry.uri.startsWith("data:"));
  if (external) throw new Error("This GLB file references external files; the viewer opens self-contained GLB files only.");
}

export async function inlineGltfResources(
  bytes: Uint8Array,
  readResource: (uri: string) => Promise<Uint8Array>,
  maxOutputBytes: number,
): Promise<Uint8Array> {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
  let json: GltfJson;
  try {
    json = JSON.parse(text.replace(/^﻿/, "")) as GltfJson;
  } catch {
    throw new Error("This glTF file is not valid JSON.");
  }
  let changed = false;
  let output = bytes.length;
  // A file listed several times is read once; every embedded copy still counts against
  // the output budget, so many references to one big file cannot exhaust memory.
  const read = new Map<string, Promise<Uint8Array>>();
  const inline = async (entry: { uri?: string; mimeType?: string }, fallbackType: string) => {
    if (!entry.uri || entry.uri.startsWith("data:")) return;
    let pending = read.get(entry.uri);
    if (!pending) read.set(entry.uri, (pending = readResource(entry.uri)));
    const data = await pending;
    output += Math.ceil(data.length / 3) * 4;
    if (output > maxOutputBytes) throw new Error("This glTF file and its resources exceed the viewer's size limit.");
    const extension = entry.uri.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
    const type = entry.mimeType ?? IMAGE_TYPES[extension] ?? fallbackType;
    entry.uri = `data:${type};base64,${Buffer.from(data).toString("base64")}`;
    changed = true;
  };
  for (const buffer of json.buffers ?? []) await inline(buffer, "application/octet-stream");
  for (const image of json.images ?? []) await inline(image, "application/octet-stream");
  return changed ? new Uint8Array(Buffer.from(JSON.stringify(json), "utf8")) : bytes;
}
