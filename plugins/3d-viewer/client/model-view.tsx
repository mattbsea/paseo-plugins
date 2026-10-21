import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { formatForPath } from "../shared/formats";
import type { Dimensions } from "../shared/rpc";
import { useModel } from "./load-model";
import type { ModelStats, ViewDirection } from "./vendor/viewer-engine";
import { canRender3d, mountViewer, type Viewer, type ViewerColors } from "./web";

interface ModelViewProps extends PluginHostProps {
  workspaceId: string;
  path: string;
  onBack?: () => void;
  /** Bumped by the owner when the file changed on disk; re-reads it. */
  externalRevision?: number;
}

export function ModelView({ workspaceId, path, theme, layout, onBack, externalRevision = 0 }: ModelViewProps) {
  const [reloads, setRevision] = useState(0);
  const revision = reloads + externalRevision;
  const info = formatForPath(path);
  // Native clients cannot draw, so only CAD files (whose dimensions the daemon measures)
  // are opened there; mesh files are not read at all.
  const query = useModel(workspaceId, path, canRender3d, revision, canRender3d || info?.kind === "cad");
  const styles = useStyles(theme, layout.compact);

  const header = (
    <View style={styles.header}>
      {onBack ? <ToolButton label="‹ Models" onPress={onBack} styles={styles} /> : null}
      <View style={styles.titleBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {path.split("/").pop()}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {[info?.label, query.data ? formatBytes(query.data.info.fileBytes) : null, path].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <ToolButton label="Reload" onPress={() => setRevision((value) => value + 1)} styles={styles} />
    </View>
  );

  if (query.status === "error") {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.centered}>
          <Text style={styles.danger}>{query.error.message}</Text>
        </View>
      </View>
    );
  }

  if (!canRender3d) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.centered}>
          {query.fetchStatus === "fetching" ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
          <Text style={styles.body}>
            3D preview needs WebGL, which is available in the Paseo desktop app and in a web browser. Open this
            workspace there to orbit the model.
          </Text>
          {query.data?.info.dimensions ? (
            <DimensionsReadout dimensions={query.data.info.dimensions} triangles={query.data.info.triangles} styles={styles} />
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <WebViewport
        theme={theme}
        loading={query.status === "pending"}
        cad={info?.kind === "cad"}
        data={query.data ?? null}
        styles={styles}
      />
    </View>
  );
}

function WebViewport({
  theme,
  loading,
  cad,
  data,
  styles,
}: {
  theme: PluginHostProps["theme"];
  loading: boolean;
  cad: boolean;
  data: ReturnType<typeof useModel>["data"] | null;
  styles: Styles;
}) {
  const host = useRef<View>(null);
  const viewer = useRef<Viewer | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [grid, setGrid] = useState(true);
  const [box, setBox] = useState(false);

  const colors = useMemo<ViewerColors>(
    () => ({
      background: theme.colors.surface0,
      grid: theme.colors.border,
      gridMajor: theme.colors.foregroundMuted,
      model: theme.colors.foregroundMuted,
      boundingBox: theme.colors.accent,
    }),
    [theme],
  );

  useEffect(() => {
    try {
      viewer.current = mountViewer(host.current, colors);
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : String(error));
    }
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
    // Mount once; colours and toggles are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => viewer.current?.setColors(colors), [colors]);
  useEffect(() => viewer.current?.setWireframe(wireframe), [wireframe]);
  useEffect(() => viewer.current?.setGrid(grid), [grid]);
  useEffect(() => viewer.current?.setBoundingBox(box), [box]);

  useEffect(() => {
    const current = viewer.current;
    if (!data) {
      // A reload is in flight: drop the previous model's numbers and errors.
      setStats(null);
      setParseError(null);
    }
    if (!current || !data) return;
    let cancelled = false;
    setParsing(true);
    setParseError(null);
    current
      .load(data.info.format, data.info.payload, data.bytes)
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setParseError(`Could not display this model: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (!cancelled) setParsing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const fit = (direction: ViewDirection) => viewer.current?.fit(direction);
  const busy = loading || parsing;
  const error = engineError ?? parseError;

  return (
    <View style={styles.viewerColumn}>
      <View style={styles.toolbar}>
        <ToolButton label="Fit" onPress={() => fit("iso")} styles={styles} />
        <ToolButton label="Top" onPress={() => fit("top")} styles={styles} />
        <ToolButton label="Front" onPress={() => fit("front")} styles={styles} />
        <ToolButton label="Right" onPress={() => fit("right")} styles={styles} />
        <View style={styles.toolbarGap} />
        <ToolButton label={wireframe ? "Wireframe" : "Shaded"} active={wireframe} onPress={() => setWireframe(!wireframe)} styles={styles} />
        <ToolButton label="Grid" active={grid} onPress={() => setGrid(!grid)} styles={styles} />
        <ToolButton label="Box" active={box} onPress={() => setBox(!box)} styles={styles} />
      </View>
      <View style={styles.viewport}>
        <View ref={host} style={styles.canvasHost} />
        {busy || error ? (
          <View style={styles.overlay} pointerEvents="none">
            {error ? (
              <Text style={styles.danger}>{error}</Text>
            ) : (
              <>
                <ActivityIndicator color={theme.colors.foregroundMuted} />
                <Text style={styles.muted}>
                  {loading ? (cad ? "Tessellating on the daemon…" : "Loading…") : "Building the scene…"}
                </Text>
              </>
            )}
          </View>
        ) : null}
      </View>
      {stats ? (
        <DimensionsReadout
          dimensions={stats.dimensions}
          triangles={stats.triangles}
          conversionMs={data?.info.conversionMs ?? null}
          styles={styles}
        />
      ) : null}
    </View>
  );
}

function DimensionsReadout({
  dimensions,
  triangles,
  conversionMs,
  styles,
}: {
  dimensions: Dimensions;
  triangles: number | null;
  conversionMs?: number | null;
  styles: Styles;
}) {
  return (
    <ScrollView horizontal style={styles.readoutScroll} contentContainerStyle={styles.readout}>
      <Text style={styles.readoutLabel}>Bounding box</Text>
      <Text style={styles.readoutValue} selectable>
        {`X ${mm(dimensions.x)} × Y ${mm(dimensions.y)} × Z ${mm(dimensions.z)} mm`}
      </Text>
      {triangles !== null ? <Text style={styles.muted}>{`${triangles.toLocaleString()} triangles`}</Text> : null}
      {conversionMs ? <Text style={styles.muted}>{`tessellated in ${(conversionMs / 1000).toFixed(1)} s`}</Text> : null}
    </ScrollView>
  );
}

function ToolButton({
  label,
  onPress,
  active,
  styles,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.button, active ? styles.buttonActive : null, pressed ? styles.buttonPressed : null]}
    >
      <Text style={active ? styles.buttonTextActive : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function mm(value: number): string {
  return value >= 1000 ? value.toFixed(1) : value.toFixed(2);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

type Styles = ReturnType<typeof useStyles>;

function useStyles(theme: PluginHostProps["theme"], compact: boolean) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: compact ? 10 : 14,
        paddingVertical: compact ? 6 : 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      titleBlock: { flex: 1, minWidth: 0 },
      title: { color: theme.colors.foreground, fontSize: compact ? 15 : 16, fontWeight: "600" as const },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      body: { color: theme.colors.foreground, fontSize: 14, textAlign: "center" as const, maxWidth: 420 },
      danger: { color: theme.colors.statusDanger, fontSize: 14, textAlign: "center" as const, maxWidth: 520 },
      centered: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 12,
        padding: compact ? 16 : 24,
      },
      viewerColumn: { flex: 1, minHeight: 0 },
      toolbar: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: compact ? 8 : 12,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      toolbarGap: { width: compact ? 0 : 8 },
      button: {
        paddingHorizontal: 10,
        paddingVertical: compact ? 6 : 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      buttonActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      buttonPressed: { opacity: 0.7 },
      buttonText: { color: theme.colors.foreground, fontSize: 12 },
      buttonTextActive: { color: theme.colors.accentForeground, fontSize: 12 },
      viewport: { flex: 1, minHeight: 120, position: "relative" as const },
      canvasHost: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 },
      overlay: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 8,
        padding: 16,
      },
      readoutScroll: {
        flexGrow: 0,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      readout: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        paddingHorizontal: compact ? 10 : 14,
        paddingVertical: 8,
      },
      readoutLabel: { color: theme.colors.foregroundMuted, fontSize: 12 },
      readoutValue: {
        color: theme.colors.foreground,
        fontSize: compact ? 13 : 14,
        fontWeight: "600" as const,
        fontVariant: ["tabular-nums" as const],
      },
    }),
    [theme, compact],
  );
}
