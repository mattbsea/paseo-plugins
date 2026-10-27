import type { PluginClientContext } from "@getpaseo/plugin/client";
import { describe, expect, it, vi } from "vitest";

// The screens pull in React Native, which this Node test cannot load; only the registrations matter here.
vi.mock("@getpaseo/plugin/client/ui", () => ({ SidebarRow: () => null }));
vi.mock("./client/daemons-page.client", () => ({ DaemonsPage: () => null }));
vi.mock("./client/settings-screen.client", () => ({ CrossDaemonSettingsScreen: () => null }));

const { default: contribute } = await import("./index.client");

function fakeClient() {
  const calls: string[] = [];
  const removed: string[] = [];
  const register = (method: string) => (contribution: { id: string }) => {
    calls.push(`${method}:${contribution.id}`);
    return () => removed.push(`${method}:${contribution.id}`);
  };
  const client = {
    rpc: vi.fn(),
    addSettingsScreen: register("settings"),
    addScreen: register("screen"),
    addSidebarHeaderItem: register("sidebar"),
  } as unknown as PluginClientContext;
  return { client, calls, removed };
}

describe("client entry", () => {
  it("adds its page as a screen and its sidebar row with the current registration calls", () => {
    const { client, calls } = fakeClient();
    contribute(client);
    expect(calls).toEqual(["settings:cross-daemon", "screen:daemons", "sidebar:cross-daemon"]);
  });

  it("removes everything it added", () => {
    const { client, removed } = fakeClient();
    contribute(client)();
    expect(removed.sort()).toEqual(["screen:daemons", "settings:cross-daemon", "sidebar:cross-daemon"]);
  });
});
