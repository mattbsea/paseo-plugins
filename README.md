# paseo-plugins

[Paseo](https://paseo.sh) plugins, one per directory under `plugins/`.

| Plugin | ID | What it does |
| --- | --- | --- |
| [3d-viewer](plugins/3d-viewer) | `viewer-3d` | Opens STL, STEP, 3MF, OBJ, PLY, glTF, IGES and BREP models in a workspace tab, with bounding-box dimensions in mm |

Plugins are trusted, unsandboxed code: their daemon side runs with your user's access on
the daemon machine. Read a plugin's README and source before installing it.

## Layout

```text
paseo-plugins/
  package.json          npm workspaces root (private; dev tooling only)
  package-lock.json     one lockfile for every plugin's dev dependencies
  plugins/
    <name>/             one self-contained Paseo plugin
      paseo-plugin.json   manifest: id, name, description, requirements.paseo
      index.client.tsx    app entry (optional)
      index.server.ts     daemon entry (optional)
      client/ server/ shared/
      package.json        plugin-local scripts and devDependencies
      README.md
```

Each plugin directory is a complete plugin. Paseo installs it on its own, so nothing in
it may import from outside that directory.

## Install a plugin

Install from this repository with a subdirectory suffix:

```bash
paseo plugin add git:mattbsea/paseo-plugins:plugins/<name>
# the legacy flag form is equivalent
paseo plugin add git:mattbsea/paseo-plugins --path plugins/<name>
# pin the initial install to a branch, tag or commit
paseo plugin add git:mattbsea/paseo-plugins:plugins/<name> --ref <ref>
```

Keep the `git:` prefix. Without it, Paseo reads `mattbsea/paseo-plugins` as an ID in the
public plugin registry. These plugins are not listed in that registry.

You can also paste `git:mattbsea/paseo-plugins:plugins/<name>` into **Settings → Plugins →
Plugin source**. **Enable plugins** must be on for that daemon.

To try a working copy, install the directory itself:

```bash
paseo plugin install /absolute/path/to/paseo-plugins/plugins/<name>
paseo plugin reload <id>   # after each change
```

Updates: `paseo plugin update <id>` offers the remote's current default `HEAD`,
regardless of the `--ref` used to install.

## Develop

```bash
npm install          # once, at the repository root
npm run typecheck    # every plugin
npm test             # every plugin
```

npm workspaces hoist dev dependencies into the root `node_modules`. Paseo never uses
them: a Git install has no `node_modules`.

**A Git install runs no package manager.** Paseo compiles each plugin with esbuild when
it installs it. Runtime imports must therefore be one of these:

- host-provided modules: `@getpaseo/plugin/*`, `react`, `react-native`,
  `@tanstack/react-query` and `zod` on the client; `@getpaseo/plugin/*`, `zod` and Node
  built-ins on the server;
- files committed inside the plugin directory. `plugins/3d-viewer` vendors prebuilt
  bundles under `client/vendor/` and `server/vendor/`, together with the script that
  regenerates them;
- or packages installed by a `build` step in `paseo-plugin.json`, for example
  `[["npm", "ci", "--omit=dev", "--ignore-scripts"]]`. This needs npm and network access
  on the daemon at install time.

Type imports count as well. Paseo's compiler resolves them, so a client file with
`import type { X } from "some-package"` fails to install when that package is not
committed.

## Add a plugin

1. Scaffold it with the Paseo CLI. IDs must match `^[a-z][a-z0-9-]*$`, so they cannot
   start with a digit.

   ```bash
   paseo plugin init "$PWD/plugins/<name>"
   ```

2. Give it a scoped package name so it fits the workspace, and install from the root:

   ```bash
   (cd plugins/<name> && npm pkg set name=@mattbsea/paseo-<name>)
   npm install
   ```

3. Keep `requirements.paseo` in `paseo-plugin.json` accurate. Raise the minimum when
   using newer APIs.
4. Add `typecheck` and `test` scripts to the plugin's `package.json`. The root scripts
   run them with `--if-present`.
5. Add a README in the plugin directory and a row to the table above.
6. Before pushing, check that a clean checkout compiles without `node_modules`.
   `plugins/3d-viewer/scripts/paseo-compile-check.mjs` shows how: it runs the installed
   Paseo's own compiler on a temporary copy.
