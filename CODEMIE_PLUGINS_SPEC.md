# CODEMIE_PLUGINS_SPEC.md

**Specification: Migrate `codemie-plugins` into `codemie` CLI**

---

## Background

This spec covers the full migration and rewrite of the `codemie-plugins` Python project into the `codemie-code` TypeScript/Node.js repository. The goal is a unified CLI where all plugin/toolkit functionality is accessible through a consistent `codemie` entry point.

**Source project**: `codemie-plugins` (Python 3.12+, LangChain, NATS, Click)
**Target project**: `codemie-code` (TypeScript 5.3+, Node.js ≥20, Commander.js)

**JIRA Acceptance Criteria:**
- [ ] All features and logic from `codemie-plugins` migrated into the CLI toolchain
- [ ] TypeScript as implementation language for core and plugin loading logic
- [ ] CLI exposes `codemie plugin <command>` syntax for plugin discovery, installation, and execution
- [ ] Existing CLI functionality preserved; no regressions
- [ ] Documentation for developing and using CLI plugins provided

---

## Command Structure

The existing `codemie plugin` (singular) manages user extensions (list/install/uninstall/enable/disable). The new toolkit functionality is added as a separate `codemie plugins` (plural) command group to avoid conflicts while matching the JIRA requirement for a `codemie plugin <command>` pattern.

```
codemie plugins                          # NEW command group (plural = toolkit runners)
├── development
│   └── run [--repo-path <path>] [--timeout <sec>] [--write-mode diff|write]
├── mcp
│   ├── list
│   └── run -s <server1,server2> [-e KEY=VAL] [--timeout <sec>]
├── logs
│   └── run [--base-path <path>] [--timeout <sec>]
├── notification
│   └── run [--timeout <sec>]
├── code
│   [--model <model>] [--allowed-dir <path>]... [--mcp-servers <servers>] [--debug]
└── config
    ├── list
    ├── get <key>
    ├── set <key> <value>
    ├── generate-key
    └── local-prompt [set <text>|show]
```

The existing `codemie plugin` (singular) commands are unchanged:
```
codemie plugin list | install | uninstall | enable | disable    # unchanged
```

---

## Architecture Overview

```
src/
├── toolkit/                               # NEW subsystem
│   ├── core/
│   │   ├── types.ts                       # RemoteTool, RemoteToolkit, PluginConfig
│   │   ├── base-tool.ts                   # Abstract BaseRemoteTool
│   │   ├── base-toolkit.ts                # Abstract BaseRemoteToolkit
│   │   ├── nats-client.ts                 # NATS subscribe/publish via protobuf
│   │   ├── plugin-client.ts               # Top-level orchestrator
│   │   └── config.ts                      # ToolkitConfigLoader (~/.codemie/toolkit.json)
│   ├── proto/
│   │   ├── service.proto                  # Protocol definition (from codemie-plugins)
│   │   └── service.ts                     # TypeScript encode/decode helpers (protobufjs)
│   ├── plugins/
│   │   ├── development/
│   │   │   ├── development.toolkit.ts     # FileSystemAndCommandToolkit
│   │   │   ├── development.tools.ts       # 7 tools
│   │   │   ├── development.vars.ts        # Metadata constants
│   │   │   └── services/
│   │   │       ├── diff-update.service.ts # SEARCH/REPLACE engine
│   │   │       └── git.service.ts         # Git via exec()
│   │   ├── mcp/
│   │   │   ├── mcp.toolkit.ts
│   │   │   ├── mcp.adapter.ts
│   │   │   └── servers.json               # Predefined: filesystem, puppeteer, jetbrains
│   │   ├── logs-analysis/
│   │   │   ├── logs.toolkit.ts
│   │   │   └── logs.tools.ts              # ParseLogFileTool
│   │   └── notification/
│   │       ├── notification.toolkit.ts
│   │       └── notification.tools.ts      # EmailTool (nodemailer)
│   └── coding/
│       ├── coding.agent.ts                # LangGraph ReAct agent
│       ├── coding.toolkit.ts              # FilesystemToolkit (11 tools)
│       ├── coding.tools.ts                # DynamicStructuredTool implementations
│       └── coding.prompts.ts              # CODING_AGENT_PROMPT + .codemie/prompt.txt
└── cli/
    └── commands/
        └── plugins-toolkit.ts             # createPluginsCommand() → 'codemie plugins'
```

**Layer flow** (follows existing 5-layer architecture):
```
CLI (plugins-toolkit.ts)
  └─> Toolkit Plugins (development, mcp, logs, notification, coding)
        └─> Core (NatsClient, PluginClient, BaseRemoteTool)
              └─> Utils (errors.ts, logger.ts, processes.ts, paths.ts)
```

---

## New Dependencies

Add to `package.json`:

| Package | Purpose |
|---|---|
| `nats ^2.x` | NATS.io TypeScript client (WebSocket + TCP) |
| `protobufjs ^7.x` | Runtime protobuf encode/decode for NATS messages |
| `nodemailer ^6.x` | SMTP email for notification toolkit |
| `@types/nodemailer ^6.x` | TypeScript types |

Already available (no additions): `@langchain/core`, `@langchain/langgraph`, `@langchain/openai`, `zod ^4.1.12`, `fast-glob ^3.3.2`, `chalk`, `readline` (Node built-in).

---

## Core Infrastructure

### Types (`src/toolkit/core/types.ts`)

```typescript
export interface RemoteToolMetadata {
  name: string;
  label?: string;
  description?: string;
  reactDescription?: string;
  allowedPatterns?: [string, string][];   // [label, regex] — allow-list
  deniedPatterns?: [string, string][];    // [label, regex] — block-list
}

export interface RemoteTool {
  metadata: RemoteToolMetadata;
  getArgsSchema(): Record<string, unknown>;    // JSON Schema
  execute(input: Record<string, unknown>): Promise<string>;
}

export interface RemoteToolkit {
  readonly label: string;
  readonly description?: string;
  getTools(): RemoteTool[];
}

export interface PluginConfig {
  pluginKey: string;       // PLUGIN_KEY env var — used as NATS bearer token
  engineUri: string;       // PLUGIN_ENGINE_URI — NATS server URL
  pluginLabel?: string;    // PLUGIN_LABEL env var
  timeout?: number;        // seconds, default 600
}

export interface ToolkitStoredConfig {
  pluginKey?: string;
  engineUri?: string;
  smtpHost?: string; smtpPort?: number;
  smtpUser?: string; smtpPassword?: string;
}
```

### BaseRemoteTool (`src/toolkit/core/base-tool.ts`)

- `sanitizeInput(input)` — validates against `deniedPatterns`/`allowedPatterns` using regex, throws `PathSecurityError` (reuse from `src/utils/errors.ts`)
- `get prefixedName()` — returns `_${metadata.name}` (NATS subject convention)
- Path security: reuse `isPathWithinDirectory(workingDir, resolvedPath)` from `src/utils/paths.ts`

### Protobuf (`src/toolkit/proto/service.ts`)

Load `service.proto` at runtime via `protobufjs.load()`. Key message types:

- `ServiceMeta { subject, handler: GET(0)|RUN(1), puppet: LANGCHAIN_TOOL(0) }`
- `LangChainTool { name?, description?, args_schema?, result?, error?, query? }`
- GET request → reply with tool schema (`name`, `description`, `args_schema` as JSON)
- RUN request → execute tool with `query` JSON input → reply with `result` or `error`

### NatsClient (`src/toolkit/core/nats-client.ts`)

Port of `codemie/nats_client.py` (experimental path only — legacy protocol skipped):

```typescript
connect(): connects with { servers: engineUri, token: pluginKey }
// Subscribes to 3 patterns:
//   {key}.list         → handleList (GET — tool schema discovery)
//   {key}.live.reply   → handleLiveReply (heartbeat ACK)
//   {key}.*.*.*        → handleRun (RUN — tool execution)
// Publishes heartbeat to {key}.live every 60s
disconnect(): clearInterval(timer), nc.drain()
```

Subject format for tool invocations: `{plugin_key}.{session_id}.{label}.{_tool_name}`

### PluginClient (`src/toolkit/core/plugin-client.ts`)

Port of `codemie/client.py` (experimental path):
- Enriches tools: appends `(plugin: {label})` to descriptions
- Instantiates and manages `NatsClient`

### Config (`src/toolkit/core/config.ts`)

- Reads/writes `~/.codemie/toolkit.json` via `getCodemiePath('toolkit.json')` (reuse `src/utils/paths.ts`)
- Env var priority: `PLUGIN_KEY > PLUGIN_ENGINE_URI > PLUGIN_LABEL > toolkit.json > defaults`
- `generatePluginKey()` → `crypto.randomUUID()` (Node.js built-in)

---

## Development Toolkit

### Diff Update Service (`services/diff-update.service.ts`)

Implements SEARCH/REPLACE block format used by AI coding assistants:

```
<<<<<<< SEARCH
content to find (must match exactly)
=======
replacement content
>>>>>>> REPLACE
```

- Parse blocks via regex: `/<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g`
- Apply each block: exact match first → whitespace-normalized match fallback
- Throw `ToolExecutionError` if a SEARCH block is not found
- **Out of scope for v1**: Python's fuzzy similarity matching (`try_dotdotdots`)

### Git Service (`services/git.service.ts`)

```typescript
execute(command: string, args: string[]): Promise<string>
// Allowlist: add, commit, push, pull, status, diff, log, checkout, branch, fetch, stash, merge
// Uses exec() from src/utils/processes.ts with cwd: repoPath
// Throws ToolExecutionError for unlisted commands
```

### Development Tools (7 tools)

| Class | Input | Behavior |
|---|---|---|
| `ReadFileTool` | `{ file_path }` | Read with path validation |
| `WriteFileTool` | `{ file_path, content }` | Write + auto-mkdir |
| `ListDirectoryTool` | `{ directory }` | Files + types, max depth 2 |
| `RecursiveFileRetrievalTool` | `{ directory, pattern? }` | `fast-glob` recursive listing |
| `CommandLineTool` | `{ command, working_dir? }` | `exec()` with 30s timeout |
| `DiffUpdateFileTool` | `{ file_path, diff_content }` | Read → `DiffUpdateService` → write |
| `GenericGitTool` | `{ command, args? }` | Delegates to `GitService` |

All tools validate paths via `isPathWithinDirectory(repoPath, resolvedPath)`.

### FileSystemAndCommandToolkit

```typescript
export class FileSystemAndCommandToolkit extends BaseRemoteToolkit {
  readonly label = 'development';
  constructor(repoPath = process.cwd(), useDiffWrite = true) {}
  // Returns 6-7 tools based on useDiffWrite flag
}
```

---

## MCP Adapter Toolkit

**`servers.json`** (curated, not exact Python match):
- `filesystem` — `@modelcontextprotocol/server-filesystem`
- `puppeteer` — `@modelcontextprotocol/server-puppeteer`
- `jetbrains` — `@jetbrains/mcp-proxy`

**`McpToolAdapter`** wraps `StructuredToolInterface` (LangChain) as `RemoteTool`. Reuses existing `@modelcontextprotocol/sdk` already in the project.

**`McpAdapterToolkit`** — async `initialize()` must be called before `PluginClient.connect()`:

```typescript
async initialize(): Promise<void>  // launches MCP servers, discovers tools, wraps as McpToolAdapter
```

---

## Logs Analysis Toolkit

**`ParseLogFileTool`**:
- Input: `{ file_path, filter_pattern?, max_lines?, error_only? }`
- Reads file, applies optional regex filter or `/ERROR|WARN|EXCEPTION|FATAL/i` filter
- Returns last `max_lines` (default 1000) with line numbers + summary stats

**`LogsAnalysisToolkit`** includes: `ReadFileTool`, `ListDirectoryTool`, `WriteFileTool`, `ParseLogFileTool`.

---

## Notification Toolkit

**`EmailTool`** (nodemailer):
- Input: `{ to, subject, body, cc?, attachment_path? }`
- SMTP config from env vars (`SMTP_HOST/PORT/USER/PASSWORD`) → `toolkit.json` → `ConfigurationError`

---

## Interactive Coding Agent

### Tools (11 `DynamicStructuredTool` with Zod schemas)

| Tool | Zod Input |
|---|---|
| `read_file` | `{ path: z.string() }` |
| `read_multiple_files` | `{ paths: z.array(z.string()) }` |
| `write_file` | `{ path: z.string(), content: z.string() }` |
| `edit_file` | `{ path: z.string(), diff: z.string() }` (uses DiffUpdateService) |
| `create_directory` | `{ path: z.string() }` |
| `list_directory` | `{ path: z.string() }` |
| `directory_tree` | `{ path: z.string(), depth: z.number().optional() }` |
| `move_file` | `{ source: z.string(), destination: z.string() }` |
| `search_files` | `{ pattern: z.string(), path: z.string().optional() }` (fast-glob) |
| `list_allowed_directories` | `{}` |
| `execute_command` | `{ command: z.string(), cwd: z.string().optional() }` |

### CodingAgent (`src/toolkit/coding/coding.agent.ts`)

```typescript
export class CodingAgent {
  constructor(private allowedDirs: string[], private mcpServers?: string[]) {}

  async initialize(): Promise<void> {
    // LLM priority:
    //   1. env vars LLM_SERVICE_BASE_URL + LLM_SERVICE_API_KEY (direct Azure, matching Python)
    //   2. active codemie profile via ConfigLoader.load() (SSO/LiteLLM/Bedrock proxy)
    // All providers expose OpenAI-compatible API via proxy → use ChatOpenAI from @langchain/openai

    const profile = await ConfigLoader.load(process.cwd());
    const llm = new ChatOpenAI({
      configuration: { baseURL: process.env.LLM_SERVICE_BASE_URL ?? profile.baseUrl },
      openAIApiKey: process.env.LLM_SERVICE_API_KEY ?? profile.apiKey,
      modelName: process.env.LLM_MODEL ?? profile.model,
      streaming: true,
      temperature: 0.2,
    });

    const tools = new CodingToolkit({ allowedDirs }).getTools();
    // + optional MCP tools via McpClientManager
    this.agent = createReactAgent({ llm, tools });
  }

  async runInteractive(): Promise<void>      // readline REPL — reads stdin, streams output
  async run(input: string): Promise<string>  // single-shot for scripting
}
```

### System Prompt

- Default: `CODING_AGENT_PROMPT` constant in `coding.prompts.ts`
- Override: loads `.codemie/prompt.txt` from cwd if it exists (matches Python behavior)

---

## CLI Commands (`src/cli/commands/plugins-toolkit.ts`)

### Shared `runToolkitServer()` helper

```typescript
async function runToolkitServer(toolkit: RemoteToolkit, timeout: number): Promise<void> {
  const config = ToolkitConfigLoader.buildPluginConfig();
  // throws ConfigurationError if PLUGIN_KEY not set

  const client = new PluginClient(toolkit.getTools(), config);
  await client.connect();

  const shutdown = async () => { await client.disconnect(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (timeout > 0) setTimeout(shutdown, timeout * 1000);

  logger.success(`${toolkit.label} toolkit running. Press Ctrl+C to stop.`);
  await new Promise(() => {});  // keep alive
}
```

### Register in `src/cli/index.ts`

```typescript
import { createPluginsCommand } from './commands/plugins-toolkit.js';
program.addCommand(createPluginsCommand());  // new — adds 'codemie plugins'
```

No changes to existing commands. The existing `createPluginCommand()` for `codemie plugin` (singular) remains unchanged.

---

## Reused Existing Utilities

| Utility | File | Used for |
|---|---|---|
| `isPathWithinDirectory()` | `src/utils/paths.ts` | Path security in all file tools |
| `getCodemiePath()` | `src/utils/paths.ts` | `~/.codemie/toolkit.json` location |
| `exec()` | `src/utils/processes.ts` | `CommandLineTool`, `GitService` |
| `ConfigurationError`, `PathSecurityError`, `ToolExecutionError` | `src/utils/errors.ts` | All error handling |
| `logger` | `src/utils/logger.ts` | All toolkit logging |
| `ConfigLoader.load()` | `src/utils/config.ts` | Active profile for coding agent LLM |
| `fast-glob` | package.json | `RecursiveFileRetrievalTool`, `SearchFilesTool` |
| `zod` | package.json | All Zod input schemas in coding tools |
| `@langchain/core`, `@langchain/langgraph`, `@langchain/openai` | package.json | Coding agent |
| `@modelcontextprotocol/sdk` | existing dep | MCP server lifecycle in mcp toolkit |

---

## Implementation Sequence

| Phase | Files | Notes |
|---|---|---|
| **1. Core infrastructure** | `types.ts`, `base-tool.ts`, `base-toolkit.ts`, `nats-client.ts`, `plugin-client.ts`, `config.ts`, `proto/service.ts` | Critical path |
| **2. Development toolkit** | `development.tools.ts`, `diff-update.service.ts`, `git.service.ts`, `development.toolkit.ts` | Highest value |
| **3. MCP adapter** | `mcp.adapter.ts`, `mcp.toolkit.ts`, `servers.json` | Reuses existing MCP infra |
| **4. Logs analysis** | `logs.tools.ts`, `logs.toolkit.ts` | Low complexity |
| **5. Notification** | `notification.tools.ts`, `notification.toolkit.ts` | Requires SMTP config |
| **6. Coding agent** | `coding.tools.ts`, `coding.toolkit.ts`, `coding.agent.ts`, `coding.prompts.ts` | No NATS dependency — fully independent |
| **7. CLI + integration** | `plugins-toolkit.ts`, patch `src/cli/index.ts` | Wire everything |

**Total: ~30 new files, 4 new npm packages.**

Phases 3–5 can proceed in parallel once Phase 1 is complete. Phase 6 is fully independent.

---

## Documentation Requirements (JIRA AC)

The following documentation must be created or updated as part of this ticket:

### 1. Developer Guide: `docs/plugins/developing-plugins.md`

- How to create a custom toolkit (implement `BaseRemoteToolkit` + `BaseRemoteTool`)
- Tool input/output schema conventions (Zod + JSON Schema)
- Path security requirements (allowed/denied patterns)
- How to register and run a custom toolkit via `PluginClient`

### 2. User Guide: `docs/plugins/using-plugins.md`

- PLUGIN_KEY setup and generation (`codemie plugins config generate-key`)
- Connecting to NATS: `PLUGIN_ENGINE_URI` configuration
- Running each toolkit: development, mcp, logs, notification
- Using the interactive coding agent (`codemie plugins code`)
- MCP server configuration

### 3. CLI Help Text

- All new commands must have complete `.description()` and `.helpText()` in Commander.js
- Options must have descriptions and defaults documented inline

### 4. Update `README.md`

- Add `codemie plugins` command group to the top-level command table
- Add quick-start section for toolkit usage

---

## Verification

### Build & Quality
```bash
npm install                  # installs new deps (nats, protobufjs, nodemailer)
npm run build                # TypeScript compilation — must have 0 errors
npm run lint                 # ESLint — must have 0 warnings
```

### Development Toolkit (requires PLUGIN_KEY + NATS URI)
```bash
export PLUGIN_KEY=$(codemie plugins config generate-key)
export PLUGIN_ENGINE_URI=nats://nats-codemie.example.com:443
codemie plugins development run --repo-path /tmp/test-repo
# Verify: agent on remote platform can invoke ReadFileTool, GenericGitTool, etc.
```

### MCP Toolkit
```bash
codemie plugins mcp list                     # shows available servers
codemie plugins mcp run -s filesystem        # should connect to NATS
```

### Logs Analysis Toolkit
```bash
codemie plugins logs run --base-path /var/log
```

### Notification Toolkit
```bash
export SMTP_HOST=smtp.example.com SMTP_PORT=587 SMTP_USER=user SMTP_PASSWORD=pass
codemie plugins notification run
```

### Interactive Coding Agent (local, no NATS)
```bash
# With env vars (matching Python behavior):
export LLM_SERVICE_BASE_URL=https://ai.example.com/v1
export LLM_SERVICE_API_KEY=<key>
codemie plugins code --allowed-dir /tmp/project

# With active codemie profile:
codemie plugins code --allowed-dir /tmp/project
```

### Config Management
```bash
codemie plugins config generate-key          # generates UUID
codemie plugins config set engineUri nats://...
codemie plugins config list                  # shows all stored values
codemie plugins config local-prompt set "You are a TypeScript expert..."
```

### Regression Check
```bash
codemie plugin list            # existing command — must still work
codemie plugin install <path>  # existing command — must still work
codemie list                   # agent list — must still work
codemie doctor                 # health check — must still pass
```

---

## Out of Scope (v1)

- Legacy NATS protocol (Python's `LEGACY_PROTOCOL=true` path)
- Fuzzy/similarity matching in `DiffUpdateService` (Python's `try_dotdotdots` strategy)
- Bedrock direct auth in coding agent (proxied via SSO/LiteLLM, which is OpenAI-compatible)
- `deploy-templates/` (Helm chart) — not applicable for Node.js distribution

---

## Security Considerations

- `PLUGIN_KEY` is a sensitive token — stored in `~/.codemie/toolkit.json`, never logged
- Tool path validation: all file tools enforce `isPathWithinDirectory(repoPath, path)` from `src/utils/paths.ts`
- Shell execution in `CommandLineTool`: command string is passed to `exec()` with sanitized CWD; no shell interpolation
- SMTP credentials (`smtpPassword`) must never appear in logs — use `sanitizeLogArgs()` from `src/utils/security.ts`
