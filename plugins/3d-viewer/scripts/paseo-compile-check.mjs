// Simulates a Git install: copies the plugin to an empty temp directory (no node_modules
// anywhere above it), compiles it with the installed Paseo daemon's own plugin compiler,
// evaluates the server bundle and drives its RPC handlers against the test fixtures.
//
//   node scripts/paseo-compile-check.mjs [path/to/@getpaseo/server/dist/server/server/plugins]
//
// Defaults to the daemon next to the `paseo` CLI on PATH. Does not talk to a running daemon.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function daemonPluginsDir() {
  if (process.argv[2]) return process.argv[2];
  // The CLI binary resolves into .../@getpaseo/cli/...; the daemon is its dependency.
  const cli = realpathSync(execFileSync("sh", ["-c", "command -v paseo"], { encoding: "utf8" }).trim());
  const marker = `${sep}@getpaseo${sep}cli${sep}`;
  const cliDir = cli.slice(0, cli.lastIndexOf(marker) + marker.length - 1);
  return join(cliDir, "node_modules/@getpaseo/server/dist/server/server/plugins");
}

const pluginsDir = daemonPluginsDir();
const { compilePlugin } = await import(pathToFileURL(join(pluginsDir, "compiler.js")).href);
const { evaluateBundle } = await import(pathToFileURL(join(pluginsDir, "bundle-evaluator.js")).href);

const staging = mkdtempSync(join(tmpdir(), "viewer-3d-install-"));
const plugin = join(staging, "plugin");
const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "."], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
for (const file of tracked) cpSync(join(root, file), join(plugin, file), { recursive: true });

let failed = false;
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failed = true;
};

try {
  const started = Date.now();
  const { clientBundle, serverBundle } = await compilePlugin({
    client: join(plugin, "index.client.tsx"),
    server: join(plugin, "index.server.ts"),
  });
  check(true, `compiled without node_modules in ${Date.now() - started} ms`);
  check(true, `client bundle ${(clientBundle.length / 1024).toFixed(0)} KiB, server bundle ${(serverBundle.length / 1024).toFixed(0)} KiB`);

  // Client bundle: evaluate with host modules stubbed and register against recording
  // contexts shaped like a 0.11/0.12 host (no addFilePanel) and a 0.13 host (with it).
  const stubModule = new Proxy(
    {},
    { get: (_target, key) => (key === "__esModule" ? true : key === "Platform" ? { OS: "ios" } : () => null) },
  );
  // Shared modules are real (RPC contracts run zod at load); UI modules are stubs.
  const daemonRequire = createRequire(join(pluginsDir, "compiler.js"));
  const clientRequire = (name) => (name === "zod" || name === "@getpaseo/plugin" ? daemonRequire(name) : stubModule);
  const clientExports = (0, eval)(clientBundle)(clientRequire);
  for (const [host, methods] of [
    ["0.11 host", ["addScreen", "addSidebarHeaderItem", "addWorkspacePanel", "addCommandCenterItem", "addSlashCommand"]],
    ["0.13 host", ["addScreen", "addSidebarHeaderItem", "addWorkspacePanel", "addCommandCenterItem", "addSlashCommand", "addFilePanel"]],
  ]) {
    const registrations = [];
    const context = Object.fromEntries(
      methods.map((method) => [
        method,
        (contribution) => {
          registrations.push(`${method}:${contribution.id ?? contribution.name}`);
          return () => {};
        },
      ]),
    );
    const clientCleanup = clientExports.default(context);
    check(typeof clientCleanup === "function", `${host} registered: ${registrations.join(", ")}`);
    clientCleanup();
  }

  // Server bundle: evaluate with the daemon's real runtime modules.
  const setup = evaluateBundle(serverBundle);
  const handlers = new Map();
  const cleanup = setup({ handle: (contract, handler) => handlers.set(contract.name, { contract, handler }) });
  check(handlers.size === 3, `server registered: ${[...handlers.keys()].join(", ")}`);

  const fixtures = join(plugin, "test/fixtures");
  const paseo = {
    workspaces: {
      list: async () => ({ entries: [{ id: "ws", workspaceDirectory: fixtures }], pageInfo: { hasMore: false } }),
    },
  };
  const call = async (name, input) => {
    const { contract, handler } = handlers.get(name);
    return contract.output.parse(await handler(contract.input.parse(input), { paseo }));
  };

  const listing = await call("models.list", { workspaceId: "ws" });
  check(listing.files.length > 0, `models.list found ${listing.files.map((file) => file.path).join(", ")}`);

  const before = Date.now();
  const step = await call("model.open", { workspaceId: "ws", path: "test_adapter.step" });
  const { x, y, z } = step.dimensions;
  check(
    Math.abs(x - 53) < 2 && Math.abs(y - 53) < 2 && Math.abs(z - 73) < 2,
    `STEP tessellated in ${Date.now() - before} ms: ${x.toFixed(2)} x ${y.toFixed(2)} x ${z.toFixed(2)} mm, ${step.triangles} triangles, ${step.payloadBytes} bytes in ${step.chunkCount} chunk(s)`,
  );
  let received = 0;
  for (let index = 0; index < step.chunkCount; index++) {
    received += Buffer.from((await call("model.chunk", { token: step.token, index })).data, "base64").length;
  }
  check(received === step.payloadBytes, `chunks reassemble to ${received} bytes`);

  const stl = await call("model.open", { workspaceId: "ws", path: "test_adapter.stl" });
  check(stl.payload === "file" && stl.payloadBytes === statSync(join(fixtures, "test_adapter.stl")).size, "STL passes through unchanged");

  const escape = await call("model.open", { workspaceId: "ws", path: "../../etc/passwd.stl" }).then(
    () => "opened",
    (error) => error.message,
  );
  check(escape !== "opened", `path outside the workspace rejected: ${escape}`);

  await cleanup?.();
} catch (error) {
  check(false, error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
