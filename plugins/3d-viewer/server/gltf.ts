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

export async function inlineGltfResources(
  bytes: Uint8Array,
  readResource: (uri: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
  let json: GltfJson;
  try {
    json = JSON.parse(text.replace(/^﻿/, "")) as GltfJson;
  } catch {
    throw new Error("This glTF file is not valid JSON.");
  }
  let changed = false;
  const inline = async (entry: { uri?: string; mimeType?: string }, fallbackType: string) => {
    if (!entry.uri || entry.uri.startsWith("data:")) return;
    const data = await readResource(entry.uri);
    const extension = entry.uri.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
    const type = entry.mimeType ?? IMAGE_TYPES[extension] ?? fallbackType;
    entry.uri = `data:${type};base64,${Buffer.from(data).toString("base64")}`;
    changed = true;
  };
  for (const buffer of json.buffers ?? []) await inline(buffer, "application/octet-stream");
  for (const image of json.images ?? []) await inline(image, "application/octet-stream");
  return changed ? new Uint8Array(Buffer.from(JSON.stringify(json), "utf8")) : bytes;
}
