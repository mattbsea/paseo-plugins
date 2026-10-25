import { type PluginOpenScreenInput, type PluginScreenProps, usePaseo } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { ModelsPanel } from "./models-panel";

export const MODELS_SCREEN_ID = "models";

// The sidebar has no workspace context, so the screen carries the workspace in its params
// (kept in the URL across reloads) and remembers the last one for the next sidebar press.
let lastWorkspaceId: string | null = null;

export function modelsScreenTarget(): PluginOpenScreenInput {
  return { screenId: MODELS_SCREEN_ID, params: lastWorkspaceId ? { workspaceId: lastWorkspaceId } : {} };
}

interface WorkspaceEntry {
  id: string;
  label: string;
  detail: string;
  activityAt: string;
}

/** Full-page 3D models screen opened from the sidebar; `openScreen` updates its params. */
export function createModelsScreen(openScreen: (input: PluginOpenScreenInput) => void) {
  return function ModelsScreen(props: PluginScreenProps) {
    const workspaceId = props.params.workspaceId || null;
    if (workspaceId) lastWorkspaceId = workspaceId;
    const choose = (id: string | null) => {
      lastWorkspaceId = id;
      openScreen({ screenId: MODELS_SCREEN_ID, params: id ? { workspaceId: id } : {} });
    };
    return workspaceId ? (
      <View style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }}>
        <WorkspaceBar {...props} workspaceId={workspaceId} onChange={() => choose(null)} />
        <ModelsPanel
          context="workspace"
          workspaceId={workspaceId}
          theme={props.theme}
          host={props.host}
          layout={props.layout}
          navigation={props.navigation}
        />
      </View>
    ) : (
      <WorkspacePicker {...props} onPick={choose} />
    );
  };
}

function useWorkspaceEntries() {
  const paseo = usePaseo();
  return useQuery({
    queryKey: ["viewer-3d", "workspaces"],
    staleTime: 30_000,
    queryFn: async (): Promise<WorkspaceEntry[]> => {
      const entries: WorkspaceEntry[] = [];
      let cursor: string | undefined;
      // A few pages are plenty for a picker; stop rather than walk an enormous list.
      for (let page = 0; page < 10; page++) {
        const result = await paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
        for (const entry of result.entries) {
          if (entry.archivingAt) continue;
          entries.push({
            id: entry.id,
            label: entry.name,
            detail: entry.projectDisplayName,
            activityAt: entry.activityAt ?? entry.statusEnteredAt ?? "",
          });
        }
        const next = result.pageInfo?.nextCursor ?? undefined;
        if (!result.pageInfo?.hasMore || !next || next === cursor) break;
        cursor = next;
      }
      return entries.sort((a, b) => b.activityAt.localeCompare(a.activityAt));
    },
  });
}

function WorkspaceBar({
  theme,
  layout,
  workspaceId,
  onChange,
}: PluginScreenProps & { workspaceId: string; onChange: () => void }) {
  const workspaces = useWorkspaceEntries();
  const current = workspaces.data?.find((entry) => entry.id === workspaceId);
  const styles = useStyles(theme, layout.compact);
  return (
    <View style={styles.bar}>
      <Text style={styles.muted}>Workspace</Text>
      <Text style={styles.barTitle} numberOfLines={1}>
        {current ? `${current.detail} · ${current.label}` : workspaceId}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose another workspace"
        onPress={onChange}
        style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
      >
        <Text style={styles.text}>Change</Text>
      </Pressable>
    </View>
  );
}

function WorkspacePicker({ theme, layout, onPick }: PluginScreenProps & { onPick: (id: string) => void }) {
  const workspaces = useWorkspaceEntries();
  const styles = useStyles(theme, layout.compact);
  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Choose a workspace</Text>
      <Text style={styles.muted}>3D models are listed from the workspace's directory.</Text>
      {workspaces.status === "pending" ? (
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      ) : workspaces.status === "error" ? (
        <Text style={styles.danger}>{workspaces.error.message}</Text>
      ) : workspaces.data.length === 0 ? (
        <Text style={styles.muted}>No workspaces on this host.</Text>
      ) : (
        <ScrollView style={styles.list}>
          {workspaces.data.map((entry) => (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={`Open 3D models in ${entry.detail} ${entry.label}`}
              onPress={() => onPick(entry.id)}
              style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
            >
              <Text style={styles.text} numberOfLines={1}>
                {entry.label}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {entry.detail}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function useStyles(theme: PluginScreenProps["theme"], compact: boolean) {
  return useMemo(
    () => ({
      screen: {
        flex: 1,
        gap: 8,
        padding: compact ? 16 : 24,
        backgroundColor: theme.colors.surface0,
      },
      heading: { color: theme.colors.foreground, fontSize: compact ? 18 : 20, fontWeight: "600" as const },
      list: { flex: 1, marginTop: 8 },
      row: {
        paddingVertical: compact ? 12 : 9,
        paddingHorizontal: 10,
        gap: 2,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      bar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: compact ? 10 : 14,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      barTitle: { flex: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      button: {
        paddingHorizontal: 10,
        paddingVertical: compact ? 6 : 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      pressed: { opacity: 0.7 },
      text: { color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      danger: { color: theme.colors.statusDanger, fontSize: 13 },
    }),
    [theme, compact],
  );
}
