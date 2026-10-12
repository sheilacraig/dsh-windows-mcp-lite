# dsh-windows-mcp-lite

**Config-only bridge from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) to [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP).**

English | [中文](README.zh.md)

It mounts the MCP client bridge that already ships inside DeepSeek Harness and points it at the upstream Windows-MCP server over stdio. The whole integration is [`cordis.patch.yml`](cordis.patch.yml) — about 25 lines, no JavaScript, and you can read it to the end before you install it.

```text
DSH agent
  └─ mcp__windows__Snapshot / Click / Type / ...
       └─ @deepseek-ai/dsh-mcp-client        (ships with DeepSeek Harness)
            └─ uvx windows-mcp@0.8.8 serve   (stdio child process)
                 └─ your desktop: UI Automation tree, Win32 input, screen capture
```

## What this deliberately does not do

These are the design decisions, not a missing-feature list:

- **No Host plugin.** There is no `index.js`. Nothing of ours runs inside your harness process.
- **No web routes.** This plugin adds no HTTP endpoint, so it adds no unauthenticated attack surface and no reason to keep your web host on loopback beyond what you already chose.
- **No state file.** No `~/.dsh/...state.json`, no browser storage keys.
- **No installer that writes to your profile.** `npm run prewarm` installs and verifies the upstream server *in your own terminal*, and never edits a profile patch for you.
- **No runtime dependency and no build step.** `dependencies` is empty; there is nothing to compile and no `allowBuilds` approval to grant.
- **No absolute path for your machine.** The bridge invokes `uvx` from `PATH`; a test in this repo fails the build if a machine-specific path appears in a published file.
- **No `peerDependencies`.** The row *names* `@deepseek-ai/dsh-mcp-client`; it never imports it, and DSH resolves shipped packages from its own installation. This follows DSH's own `templates/mcp` bundle shape, which declares none. A peer range would be a hard activation gate whose SemVer prerelease rules silently reject valid hosts; `engines.dsh` declares the host range for the storefront instead.
- **No `screenshots.json`.** There is no interface to photograph. Declaring artwork for a configuration file would be decoration, not evidence; the storefront falls back to whatever it can extract.

If you want an in-app dependency installer, a default-off "Computer Use" toggle, or a doctor tool, other plugins in this ecosystem provide those. This one trades them for being small enough to audit in one screen — which matters more than usual for a plugin that hands over your keyboard, mouse and screen.

## Requirements

- **Windows 10 or 11.** The upstream server is Windows-only.
- **DeepSeek Harness with the in-box MCP client bridge.** Declared range: `>=0.2.0-rc.1 <0.3.0-0`; the author verified this plugin on **0.2.0-rc.2** (desktop).
- **[uv](https://docs.astral.sh/uv/) on the `PATH` of the process that runs DSH.** `uvx` starts the upstream server and builds its isolated environment. If you installed uv with its official installer, this is already true.
- Optional: **a model that accepts image input**, if you want `Screenshot` to arrive as a real image. Without it the bridge degrades the image to a text diagnostic; `Snapshot` returns plain text and needs no vision at all.

## Install

From the app: **Settings → Plugins → Add plugin**, and enter one of

```text
dsh-windows-mcp-lite                                # npm package
github:sheilacraig/dsh-windows-mcp-lite             # GitHub repository
C:\path\to\a\local\checkout                         # absolute path
```

From a CLI-owned profile:

```sh
dsh plugin --profile <profile> add dsh-windows-mcp-lite
```

The Electron desktop profile belongs to the app; install through its plugin panel there.

Then restart DSH, so the new patch layer composes at startup.

## First run is the slow one

`uvx` builds an isolated environment for the upstream server the first time, which downloads a few tens of megabytes of Python dependencies. On a slow link that is minutes, and the bridge gives up on the initial connection long before that; after the dependencies are cached, startup is quick.

Do it outside the harness instead, where there is no timeout:

```sh
npm run prewarm
```

The script runs `uvx windows-mcp@0.8.8 serve --exclude-tools ...` — the same argv the bridge uses — speaks `initialize` + `tools/list` to it, prints the server identity, the time it took, and the exact tool list, then exits. It is the same process the bridge will start, so a successful run means the harness side has nothing left to download or discover. With the environment warm, the author's run reached `initialize` in 2.1 s.

## What the model gets

**16 tools**, named `mcp__windows__<Tool>`. Upstream 0.8.8 publishes 21; this plugin excludes five by default (see [Least privilege](#least-privilege-by-default)).

| Tool | What it does |
| --- | --- |
| `Screenshot` | Screen capture with cursor position and window list |
| `Snapshot` | Full desktop state: accessibility tree, interactive elements, scrollable regions |
| `DisplayInventory` | Display layout, work areas, DPI |
| `Click`, `Move`, `Scroll` | Mouse input, including explicit drag |
| `Type`, `Shortcut` | Keyboard input |
| `Wait`, `WaitFor` | Fixed delay, or poll the UI until a condition holds |
| `MultiSelect`, `MultiEdit` | Bulk selection / bulk text entry |
| `Clipboard` | Read and set clipboard content |
| `Notification` | Windows toast notifications |
| `App` | Launch an application, resize or focus a window |
| `ControlStatus` | Who owns the desktop right now — upstream cannot exclude this one |

## Verify

1. Run `npm run prewarm` once (above). It proves the server and the pinned version.
2. In DSH, ask the agent to call `mcp__windows__DisplayInventory`. It only reads display geometry — it does not click or type.
3. Then `mcp__windows__Snapshot` for the accessibility tree as text.

## Least privilege by default

`--exclude-tools PowerShell,Registry,FileSystem,Process,Scrape` — five upstream tools stay off, because DeepSeek Harness already owns shell, file, registry and process access under its own approval policy and sandbox. Enabling upstream's copies would add a second path to the same capabilities with none of those controls.

To change the set, override the row in your profile patch (see below). Removing `--exclude-tools` restores all 21 tools.

## Configuration

Every default lives in [`cordis.patch.yml`](cordis.patch.yml). To change one, override the row in **your profile's** patch — do not edit the installed copy:

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- id: windows-mcp-lite
  config:
    serverName: windows
    transport: stdio
    command: uvx
    args: [windows-mcp@0.8.8, serve, --exclude-tools, "PowerShell,Registry,FileSystem,Process,Scrape,App"]
    toolCallTimeoutMs: 120000
    failOnStartupError: false
    env:
      ANONYMIZED_TELEMETRY: "false"
      WINDOWS_MCP_DISABLE_FLASH: "1"
```

Two things about that override, both of which cost people time:

- **A patch replaces the entire `config` object; it does not deep-merge.** Every key you leave out is a key you delete. `serverName` and `transport` are required, `command` is required for `stdio`, `url` for `streamable-http`.
- **`serverName` decides every tool name** (`mcp__<serverName>__<tool>`). Changing it renames the whole tool set and invalidates prompt-cache prefixes.

**Only one Windows-MCP bridge per profile.** Two rows using the same `serverName` conflict, and the second one fails at load. Disable any other Windows-MCP plugin in the same profile before enabling this one.

Prefer a pre-installed interpreter over `uvx`? `uv tool install windows-mcp`, then set `command: windows-mcp` with `args: [serve, --exclude-tools, ...]`. Prefer a resident HTTP server? Switch `transport` to `streamable-http` and give `url` — note that the HTTP form has no `env`, so telemetry and flash settings then belong to how you start the server.

## Security

Installing this gives an agent your mouse, keyboard, clipboard and screen, through a process that runs with your user rights. Judge it as "handing over this desktop session".

- **stdio, not a listener.** The bridge starts a child process connected by pipes. Nothing binds a port.
- **Least privilege by default**, as described above.
- **Upstream telemetry is off** in the shipped config (upstream reports anonymously to PostHog by default). The config also turns off the orange capture border.
- **The harness file sandbox does not apply to it.** MCP tool calls are ordinary tool calls, so tool approval resolves them; the sandbox is implemented in the harness's own file and shell tools. This child process is not confined by it.
- **Control is best-effort, not a boundary.** Upstream lets a real user take the desktop back by moving the physical mouse or pressing `Ctrl+Alt+Shift+Backspace`, and external commands it already launched keep running after a takeover.
- **Pinned upstream version.** `windows-mcp@0.8.8` is a fixed version, so an upstream release cannot silently change what this bridge does. Bump it deliberately and re-run `npm run prewarm`.
- **Read [`cordis.patch.yml`](cordis.patch.yml) before installing.** That file is the entire plugin; everything else here is metadata, documentation and a test.

## Troubleshooting

| Symptom | Cause and what to do |
| --- | --- |
| `USER_CONTROL` on a tool call, or `ControlStatus` reports `state: "user"` | Upstream gives the desktop to the **person** first and hands it to the agent only after about 10 seconds without physical input. You own it right now, and `wait_seconds` is the idle time it is still asking for. Move the mouse or press `Ctrl+Alt+Shift+Backspace` to take control back deliberately. `ControlStatus` keeps answering while everything else is blocked, so it is the one call to make when a tool refuses. |
| No `mcp__windows__*` tools at all | The bridge could not start the server. Run `npm run prewarm` in a terminal — it fails with the same reason, plus hints. The usual cause is `uvx` missing from the `PATH` **of the process that runs DSH**: a desktop shortcut or editor can carry a different `PATH` than the shell where you installed uv. The harness log has an `mcp-client(windows)` line. |
| Tools vanished after an upgrade | Tool names are `mcp__<serverName>__<tool>`. Changing `serverName`, or unpinning the upstream version to one whose tool names differ, renames the whole set. |
| `Screenshot` arrives as text | The current model does not accept image input. `Snapshot` is the text-first alternative: it extracts the accessibility tree instead of pixels. |
| Every desktop tool is refused at once | A second Windows-MCP row is enabled in the same profile with the same `serverName`; only the first one loads. Disable the other plugin. |

## Development

```sh
npm install     # devDependency: js-yaml, for the test only
npm test        # node --test — asserts the bridge invariants
npm run prewarm # installs and verifies the upstream server
```

`npm test` enforces, among other things: exactly one inserted row pointing at `@deepseek-ai/dsh-mcp-client`; a `serverName` valid for tool names; a pinned `windows-mcp@x.y.z` argument; the documented exclude list; the documented tool count; and that **no absolute path or drive letter appears in any published file**.

## Uninstall

Remove the bundle from **Settings → Plugins**, or delete the row from the profile patch. Disabling the bundle removes the whole configuration with it. Nothing is left behind: this plugin writes no files.

## License and attribution

MIT — see [LICENSE](LICENSE).

- All desktop automation is [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP) (MIT). This repository only wires it up.
- The MCP client bridge belongs to DeepSeek Harness and is not redistributed here.
- Not affiliated with DeepSeek or with the Windows-MCP authors.
