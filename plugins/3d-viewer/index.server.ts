import type { PluginServerContext } from "@getpaseo/plugin/server";
import { clearPrepared, handleChunk, handleList, handleOpen } from "./server/models";
import { listModelsRpc, modelChunkRpc, openModelRpc } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(listModelsRpc, handleList);
  server.handle(openModelRpc, handleOpen);
  server.handle(modelChunkRpc, handleChunk);
  return () => clearPrepared();
}
