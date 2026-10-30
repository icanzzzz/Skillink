# GUI via CLI Design

> Date: 2026-10-31
> Status: approved for implementation
> Branch: `feature/cli-backend`

## Intent

Make the CLI the only business entry point. The desktop renderer remains the
front end; the Electron main process becomes a thin adapter that validates IPC
requests, maps them to CLI argv, and executes the CLI command layer in-process.

This removes the duplicated GUI-to-Core call paths while avoiding the startup
cost of spawning a new CLI process for every user action.

## Non-goals

- No subprocess-per-command model.
- No long-lived CLI server or JSON-RPC protocol.
- No change to Core business semantics or configuration formats.
- No UI redesign.
- No physical process isolation. CLI and Core code still run inside the Electron
  main process.

## Architecture

```text
Renderer (React)
  -> preload (DesktopApi)
  -> main/ipc.ts            # validates IPC input and maps requests to argv
  -> main/cli-adapter.ts    # serial queue, runCli, JSON parsing, error mapping
  -> @skillink/cli/run      # CLI command layer
  -> @skillink/core
```

`chooseFolder` remains an Electron dialog because it is a host capability, not
business logic.

## CLI contract

### Command layer split

- `apps/cli/src/run.ts` owns `runCli` and `CliContext`.
- `apps/cli/src/index.ts` only guards and starts the executable entry.
- Desktop imports the command layer, never the executable entry.

### `snapshot --json`

Read-only aggregate used by the GUI refresh:

```ts
interface SnapshotReport {
  home: string;
  skills: SkillFile;
  packages: PackageFile;
  route: RouteFile;
  status: StatusReport;
  doctor: DoctorReport;
  targetSkills: TargetSkillSummary[];
  history: HistoryEntry[];
}
```

`snapshot` does not call `ensureHome`; opening the GUI must not create control
plane files. Missing files yield empty defaults.

### JSON results and errors

- Every write command supports `--json`.
- Success prints its result object to stdout.
- Failure with `--json` prints a single structured object to stderr:
  `{"ok":false,"error":{"code":"...","message":"...","details":{...}}}`.
- Exit codes keep their current meaning. `status` and `doctor` still return 1
  when unhealthy, and `apply` still returns 3 on conflicts; the adapter treats
  valid JSON on stdout as data, not as a transport failure.
- Human-readable output remains unchanged when `--json` is absent.

### Parity options

Add CLI options already represented in the desktop API, notably
`target add --mode <mode>` and `gc --no-keep-tagged`.

## Desktop adapter

`apps/desktop/src/main/cli-adapter.ts`:

- Serializes all CLI invocations through one promise queue.
- Captures stdout and stderr.
- Appends `--json` when missing.
- Parses stdout JSON first; parses structured stderr errors when absent.
- Exposes a generic `invoke<T>(argv)` plus `snapshot()`.

`apps/desktop/src/main/cli-commands.ts`:

- Pure argv builders for each IPC request.
- Unit-testable without Electron.

`apps/desktop/src/main/ipc.ts`:

- Keeps zod request validation and sender validation.
- Delegates to the adapter; no direct `@skillink/core` imports.

Renderer:

- `DesktopApi` keeps the existing action surface.
- `App` refreshes with one `getSnapshot()` call; history travels in the snapshot.

## Type boundary

Move CLI boundary DTOs into `@skillink/shared`:

- `ApplyReport` and related operation/conflict types
- `StatusReport` and related state/entry types
- `DoctorReport` and related issue types
- `GcReport` and related candidate/plan types
- `HistoryEntry`
- `ImportSkillResult`
- `TargetSkillSummary`
- `SnapshotReport`
- `CliErrorEnvelope`

Core imports these types from `@skillink/shared` and re-exports them for
backward compatibility. The desktop package drops its direct `@skillink/core`
dependency.

## Performance

- No process spawn; command parsing and execution happen in the existing main
  process.
- `snapshot` merges the reads required by one GUI refresh.
- The serial queue prevents reads from interleaving with writes.
- If main-process blocking becomes a problem later, replace the adapter with an
  Electron `utilityProcess` or resident CLI service without changing IPC or UI.

## Verification

- CLI contract tests for snapshot shape, write JSON, structured errors, exit
  codes, and unchanged human output.
- Desktop adapter tests for argv mapping, serialization, JSON parsing, and error
  mapping.
- Integration test using a temporary `SKILLINK_HOME`.
- Existing renderer tests updated for snapshot history.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, and a desktop packaging smoke test.
