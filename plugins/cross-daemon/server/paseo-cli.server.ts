import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";

// The CLI gives up connecting after its own 15 s; this bounds the whole command.
const CLI_TIMEOUT_MS = 90_000;
const CLI_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const jsonErrorSchema = z.object({ error: z.object({ message: z.string() }) });

// With --json the CLI reports failures as a JSON object on stderr.
function readCliError(stderr: string): string {
  try {
    const parsed = jsonErrorSchema.safeParse(JSON.parse(stderr));
    if (parsed.success) return parsed.data.error.message;
  } catch {
    // Plain-text output.
  }
  return stderr.trim();
}

export interface PaseoCliCommand {
  command: string;
  args: string[];
  // This daemon's PASEO_HOME, for calls to its own agents.
  home: string;
}

export interface PaseoCliOptions {
  // Passed through a file, so no prompt can be read as an option or overflow the argument list.
  promptText?: string;
}

export interface PaseoCli {
  run(link: string, args: readonly string[], options?: PaseoCliOptions): Promise<string>;
  runLocal(args: readonly string[], options?: PaseoCliOptions): Promise<string>;
}

// Every live agent, in any workspace: since 0.12 a plain `paseo ls` leaves out agents in background
// workspaces (those made on behalf of another agent), which would still be working in the folder.
export const LIST_LIVE_AGENTS = ["ls", "--global", "--background", "--json"] as const;

// Null means this daemon: a notice to the agent that sent a message.
export type Daemon = Peer | null;

export function runOn(cli: PaseoCli, daemon: Daemon, args: readonly string[], options?: PaseoCliOptions) {
  return daemon ? cli.run(daemon.link, args, options) : cli.runLocal(args, options);
}

export async function runJson<Schema extends z.ZodType>(cli: PaseoCli, daemon: Daemon, args: readonly string[], schema: Schema) {
  return schema.parse(JSON.parse(await runOn(cli, daemon, args)));
}

async function withPromptFile<T>(promptText: string | undefined, use: (extraArgs: string[]) => Promise<T>): Promise<T> {
  if (promptText === undefined) return use([]);
  const dir = mkdtempSync(join(tmpdir(), "cross-daemon-"));
  const file = join(dir, "prompt.txt");
  writeFileSync(file, promptText, { mode: 0o600 });
  try {
    return await use(["--prompt-file", file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runPaseo(cli: PaseoCliCommand, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number, options?: PaseoCliOptions) {
  return withPromptFile(options?.promptText, (promptArgs) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        cli.command,
        [...cli.args, ...args, ...promptArgs],
        { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, timeout: timeoutMs, maxBuffer: CLI_MAX_OUTPUT_BYTES },
        (error, stdout, stderr) => {
          if (error?.killed) reject(new Error(`paseo timed out after ${timeoutMs / 1000} s`));
          else if (error) reject(new Error(readCliError(stderr) || error.message));
          else resolve(stdout.trim());
        },
      );
    }),
  );
}

// Since 0.12 the CLI reads PASEO_AGENT_ID as "the agent calling me": send stamps the message as sent by
// that agent (and fails on a host too old to record it), and workspace and agent creation take it as
// their caller. The plugin has no such caller, so no call may inherit one from the daemon's environment.
function withoutCaller(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { PASEO_AGENT_ID: _caller, ...rest } = env;
  return rest;
}

export function createPaseoCli(cli: PaseoCliCommand, timeoutMs = CLI_TIMEOUT_MS): PaseoCli {
  return {
    run(link, args, options) {
      const { PASEO_PASSWORD: _password, ...env } = withoutCaller(process.env);
      return runPaseo(cli, ["--host", link, ...args], env, timeoutMs, options);
    },
    runLocal(args, options) {
      return runPaseo(cli, ["--home", cli.home, ...args], withoutCaller(process.env), timeoutMs, options);
    },
  };
}
