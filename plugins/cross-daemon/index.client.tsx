import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { DaemonsPage } from "./client/daemons-page.client";
import { createDaemonPort } from "./client/peer-sync.client";
import { CrossDaemonSettingsScreen } from "./client/settings-screen.client";
import { registerDaemon } from "./client/sync-scheduler.client";

const DAEMONS_SCREEN_ID = "daemons";

function DaemonsSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Network" active={currentScreen?.screenId === DAEMONS_SCREEN_ID} onPress={() => openScreen({ screenId: DAEMONS_SCREEN_ID })} />;
}

export default function contribute(client: PluginClientContext) {
  const unregisterDaemon = registerDaemon(createDaemonPort(client.rpc));
  const removeSettingsScreen = client.addSettingsScreen({
    id: "cross-daemon",
    title: "Cross-daemon",
    icon: "Network",
    Component: CrossDaemonSettingsScreen,
  });
  const removeDaemonsScreen = client.addScreen({ id: DAEMONS_SCREEN_ID, title: "Cross-daemon", Component: DaemonsPage });
  const removeSidebarItem = client.addSidebarHeaderItem({ id: "cross-daemon", title: "Cross-daemon", Component: DaemonsSidebarItem });
  return () => {
    unregisterDaemon();
    removeSettingsScreen();
    removeSidebarItem();
    removeDaemonsScreen();
  };
}
