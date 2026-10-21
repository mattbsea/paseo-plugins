import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { formatInfo } from "../shared/formats";
import { listModelsRpc, type ModelFile } from "../shared/rpc";
import { formatBytes, ModelView } from "./model-view";
import { selectModel, useSelectedModel } from "./selection";

export const MODELS_PANEL_ID = "models";

/** Workspace tab: the workspace's 3D files beside (or, on phones, instead of) the viewer. */
export function ModelsPanel(props: PluginWorkspacePanelProps) {
  const { workspaceId, theme, layout } = props;
  const selected = useSelectedModel(workspaceId);
  const styles = useStyles(theme, layout.compact);

  const list = <ModelList {...props} selected={selected} styles={styles} />;
  const viewer = selected ? (
    <ModelView
      key={selected}
      {...props}
      path={selected}
      onBack={layout.compact ? () => selectModel(workspaceId, null) : undefined}
    />
  ) : (
    <View style={styles.empty}>
      <Text style={styles.muted}>Choose a model to view it.</Text>
    </View>
  );

  if (layout.compact) return <View style={styles.screen}>{selected ? viewer : list}</View>;
  return (
    <View style={[styles.screen, styles.split]}>
      <View style={styles.sidebar}>{list}</View>
      <View style={styles.main}>{viewer}</View>
    </View>
  );
}

function ModelList({
  workspaceId,
  theme,
  selected,
  styles,
}: PluginWorkspacePanelProps & { selected: string | null; styles: Styles }) {
  const listModels = useRpc(listModelsRpc);
  const [filter, setFilter] = useState("");
  const query = useQuery({
    queryKey: ["viewer-3d", "list", workspaceId],
    queryFn: () => listModels({ workspaceId }),
    staleTime: 30_000,
  });
  const files = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = query.data?.files ?? [];
    return needle ? all.filter((file) => file.path.toLowerCase().includes(needle)) : all;
  }, [query.data, filter]);

  return (
    <View style={styles.listColumn}>
      <View style={styles.listHeader}>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter models"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          accessibilityLabel="Filter models"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rescan workspace"
          onPress={() => void query.refetch()}
          style={({ pressed }) => [styles.rescan, pressed ? styles.pressed : null]}
        >
          <Text style={styles.text}>↻</Text>
        </Pressable>
      </View>
      {query.status === "pending" ? (
        <View style={styles.empty}>
          <ActivityIndicator color={theme.colors.foregroundMuted} />
        </View>
      ) : query.status === "error" ? (
        <View style={styles.empty}>
          <Text style={styles.danger}>{query.error.message}</Text>
        </View>
      ) : files.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.muted}>
            {filter ? "No models match." : "No STL, STEP, 3MF, OBJ, PLY, glTF, IGES or BREP files in this workspace."}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list}>
          {files.map((file) => (
            <ModelRow
              key={file.path}
              file={file}
              active={file.path === selected}
              onPress={() => selectModel(workspaceId, file.path)}
              styles={styles}
            />
          ))}
          {query.data?.truncated ? (
            <Text style={[styles.muted, styles.note]}>Large workspace: only the first files found are listed.</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function ModelRow({
  file,
  active,
  onPress,
  styles,
}: {
  file: ModelFile;
  active: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const folder = slash > 0 ? file.path.slice(0, slash) : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${file.path}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, active ? styles.rowActive : null, pressed ? styles.pressed : null]}
    >
      <Text style={styles.text} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.muted} numberOfLines={1}>
        {[formatInfo(file.format).label, formatBytes(file.size), folder].filter(Boolean).join(" · ")}
      </Text>
    </Pressable>
  );
}

type Styles = ReturnType<typeof useStyles>;

function useStyles(theme: PluginWorkspacePanelProps["theme"], compact: boolean) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      split: { flexDirection: "row" as const },
      sidebar: { width: 260, borderRightWidth: 1, borderRightColor: theme.colors.border },
      main: { flex: 1, minWidth: 0 },
      listColumn: { flex: 1 },
      listHeader: {
        flexDirection: "row" as const,
        gap: 6,
        padding: compact ? 10 : 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      input: {
        flex: 1,
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: compact ? 8 : 5,
        fontSize: 13,
      },
      rescan: {
        paddingHorizontal: 10,
        justifyContent: "center" as const,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      list: { flex: 1 },
      row: { paddingHorizontal: compact ? 14 : 10, paddingVertical: compact ? 10 : 7, gap: 2 },
      rowActive: { backgroundColor: theme.colors.surface2 },
      pressed: { opacity: 0.7 },
      text: { color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      danger: { color: theme.colors.statusDanger, fontSize: 13 },
      note: { padding: 10 },
      empty: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        padding: compact ? 16 : 20,
        gap: 8,
      },
    }),
    [theme, compact],
  );
}
