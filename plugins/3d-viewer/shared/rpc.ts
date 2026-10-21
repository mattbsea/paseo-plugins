import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const formatSchema = z.enum(["stl", "obj", "ply", "3mf", "gltf", "glb", "step", "iges", "brep"]);

const dimensionsSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const listModelsRpc = defineRpc({
  name: "models.list",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({
    root: z.string(),
    files: z.array(
      z.object({
        /** Workspace-relative, forward slashes. */
        path: z.string(),
        size: z.number(),
        modifiedMs: z.number(),
        format: formatSchema,
      }),
    ),
    /** True when the scan stopped at its file or directory limit. */
    truncated: z.boolean(),
  }),
});

/**
 * Reads (and for CAD formats, tessellates) a model on the daemon and keeps the result
 * for chunked transfer. Large payloads cannot travel in one RPC message.
 */
export const openModelRpc = defineRpc({
  name: "model.open",
  input: z.object({
    workspaceId: z.string().min(1),
    /** Workspace-relative, or absolute inside the workspace. */
    path: z.string().min(1),
  }),
  output: z.object({
    token: z.string(),
    path: z.string(),
    name: z.string(),
    format: formatSchema,
    /** "file": payload is the original file. "mesh-bundle": daemon-tessellated meshes. */
    payload: z.enum(["file", "mesh-bundle"]),
    fileBytes: z.number(),
    modifiedMs: z.number(),
    payloadBytes: z.number(),
    chunkCount: z.number(),
    /** Known for CAD formats without loading in the client; null otherwise. */
    dimensions: dimensionsSchema.nullable(),
    triangles: z.number().nullable(),
    conversionMs: z.number().nullable(),
  }),
});

export const modelChunkRpc = defineRpc({
  name: "model.chunk",
  input: z.object({ token: z.string(), index: z.number().int().min(0) }),
  output: z.object({ index: z.number(), data: z.string() }),
});

export type ModelListing = z.infer<typeof listModelsRpc.output>;
export type ModelFile = ModelListing["files"][number];
export type OpenedModel = z.infer<typeof openModelRpc.output>;
export type Dimensions = z.infer<typeof dimensionsSchema>;
