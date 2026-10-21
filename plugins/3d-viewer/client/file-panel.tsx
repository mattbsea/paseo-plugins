import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { ModelView } from "./model-view";

// File panels (a viewer for a file tab, chosen by extension) are documented for Paseo
// 0.13, which is not released yet; @getpaseo/plugin 0.11/0.12 has no types for them.
// These are the documented fields this plugin uses. index.client.tsx registers the panel
// only when the host provides `addFilePanel`, so older hosts never see it.

export interface FilePanelFile {
  readonly path: string;
  watch?(listener: (event: { type: string }) => void): () => void;
}

export interface FilePanelProps extends PluginHostProps {
  workspaceId: string;
  file: FilePanelFile;
}

export interface FilePanelContribution {
  id: string;
  title: string;
  icon: string;
  files: { extensions: readonly string[] };
  Component: (props: FilePanelProps) => ReturnType<typeof ModelView>;
}

export type AddFilePanel = (contribution: FilePanelContribution) => () => void;

export function ModelFilePanel({ file, ...props }: FilePanelProps) {
  // Re-open the model when it changes on disk, e.g. after re-exporting from CAD.
  const [version, setVersion] = useState(0);
  useEffect(() => file.watch?.((event) => event.type === "changed" && setVersion((value) => value + 1)), [file]);
  return <ModelView {...props} path={file.path} externalRevision={version} />;
}
