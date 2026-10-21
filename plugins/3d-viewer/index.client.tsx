import type { PluginClientContext } from "@getpaseo/plugin/client";
import { type AddFilePanel, ModelFilePanel } from "./client/file-panel";
import { MODELS_PANEL_ID, ModelsPanel } from "./client/models-panel";
import { selectModel } from "./client/selection";
import { MODEL_EXTENSIONS } from "./shared/formats";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addWorkspacePanel({
      id: MODELS_PANEL_ID,
      title: "3D models",
      icon: "Box",
      context: "workspace",
      locations: ["workspace", "explorer"],
      Component: ModelsPanel,
    }),
    client.addCommandCenterItem({
      id: "open-models",
      title: "Open 3D model viewer",
      icon: "Box",
      context: "workspace",
      keywords: ["3d", "stl", "step", "stp", "3mf", "cad", "model", "viewer", "mesh"],
      onSelect({ openPanel }) {
        openPanel(MODELS_PANEL_ID);
      },
    }),
    client.addSlashCommand({
      name: "view3d",
      description: "Open a 3D model (STL, STEP, 3MF, …) in the 3D viewer tab",
      argumentHint: "[workspace-relative path]",
      context: "workspace",
      onSubmit({ args, workspace, openPanel }) {
        const path = args.trim().replace(/^["']|["']$/g, "");
        if (path) selectModel(workspace.id, path);
        openPanel(MODELS_PANEL_ID);
      },
    }),
  ];

  // Paseo 0.13+ (unreleased at the time of writing): also offer the viewer for model files
  // opened from the file explorer. Older hosts lack addFilePanel and skip this.
  const addFilePanel = (client as unknown as { addFilePanel?: AddFilePanel }).addFilePanel;
  if (typeof addFilePanel === "function") {
    removers.push(
      addFilePanel.call(client, {
        id: "model",
        title: "3D model",
        icon: "Box",
        files: { extensions: MODEL_EXTENSIONS },
        Component: ModelFilePanel,
      }),
    );
  }

  return () => {
    for (const remove of removers) remove();
  };
}
