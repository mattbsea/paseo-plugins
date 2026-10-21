/** Raw bytes per model.chunk response; ~4 MiB once base64-encoded. */
export const CHUNK_BYTES = 3 * 1024 * 1024;

/** Largest mesh file the viewer transfers to a client. */
export const MAX_MESH_FILE_BYTES = 256 * 1024 * 1024;

/** Largest CAD file the daemon tessellates; OpenCascade's memory use grows quickly beyond this. */
export const MAX_CAD_FILE_BYTES = 64 * 1024 * 1024;

/** Workspace scan limits for the model list. */
export const MAX_LISTED_FILES = 2000;
export const MAX_SCANNED_DIRECTORIES = 5000;
