import { useSyncExternalStore } from "react";

// The model each workspace's panel shows. Workspace panels take no parameters, so
// openers (the slash command, Command Center) record the path here before opening
// the panel. Per app session; a restored tab starts at the file list.
const selected = new Map<string, string>();
const listeners = new Set<() => void>();

export function selectModel(workspaceId: string, path: string | null) {
  if (path) selected.set(workspaceId, path);
  else selected.delete(workspaceId);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSelectedModel(workspaceId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => selected.get(workspaceId) ?? null,
    () => selected.get(workspaceId) ?? null,
  );
}
