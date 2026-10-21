import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { decodeBase64 } from "../shared/base64";
import { modelChunkRpc, openModelRpc, type OpenedModel } from "../shared/rpc";

export interface LoadedModel {
  info: OpenedModel;
  bytes: Uint8Array;
}

/**
 * Opens a model on the daemon and pulls its payload in chunks. `fetchBytes` is false on
 * native, where nothing renders it: the daemon still reports CAD dimensions.
 */
export function useModel(workspaceId: string, path: string, fetchBytes: boolean, revision: number, enabled = true) {
  const open = useRpc(openModelRpc);
  const chunk = useRpc(modelChunkRpc);
  return useQuery({
    queryKey: ["viewer-3d", "model", workspaceId, path, fetchBytes, revision],
    // Payloads can be hundreds of MiB; do not keep old ones around.
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    enabled,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<LoadedModel> => {
      const info = await open({ workspaceId, path });
      if (!fetchBytes) return { info, bytes: new Uint8Array(0) };
      const bytes = new Uint8Array(info.payloadBytes);
      let offset = 0;
      for (let index = 0; index < info.chunkCount; index++) {
        if (signal.aborted) throw new Error("Cancelled");
        const part = decodeBase64((await chunk({ token: info.token, index })).data);
        bytes.set(part, offset);
        offset += part.length;
      }
      if (offset !== info.payloadBytes) throw new Error("The model transfer was incomplete. Reload it.");
      return { info, bytes };
    },
  });
}
