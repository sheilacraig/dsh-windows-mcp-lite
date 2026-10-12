<!-- The npm sentence below is included only when the package is actually published. -->

Adds one entry: `sheilacraig/dsh-windows-mcp-lite`, category `tools`.

**What it is.** A configuration-only DeepSeek Harness bundle that mounts the in-box `@deepseek-ai/dsh-mcp-client` bridge against [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP) over stdio. The whole plugin is one file, [`cordis.patch.yml`](https://github.com/sheilacraig/dsh-windows-mcp-lite/blob/main/cordis.patch.yml): no Host code, no web route, no state file, no runtime dependency, no build step.

**What it deliberately is not.** Other Windows-MCP plugins in this ecosystem ship a Host half — an in-app dependency installer, a default-off Computer Use switch, their own HTTP routes, a doctor tool. This one ships none of that, so the entire integration can be read in one screen before installing something that takes over the keyboard, the mouse and the screen. It also pins the upstream version (`windows-mcp@0.8.8`) so an upstream release cannot change what the bridge does under you, and it excludes `PowerShell`, `Registry`, `FileSystem`, `Process` and `Scrape` by default, leaving **16** of the 21 tools upstream 0.8.8 publishes.

**Where to check those claims against the source:**

- [`cordis.patch.yml`](https://github.com/sheilacraig/dsh-windows-mcp-lite/blob/main/cordis.patch.yml) — the pinned version and the exclusion list, as shipped.
- [`test/patch.test.mjs`](https://github.com/sheilacraig/dsh-windows-mcp-lite/blob/main/test/patch.test.mjs) — `npm test`, which checks the pin, the exclusion list, the 16-tool count, the display metadata, the submission rules, and that no machine-specific absolute path can reach a published file.
- [`tools/prewarm.mjs`](https://github.com/sheilacraig/dsh-windows-mcp-lite/blob/main/tools/prewarm.mjs) — runs the same argv the bridge runs and fails if the tool set or the exclusions drift.

**Verified before submitting** on DSH 0.2.0-rc.2 (desktop, Windows 11): `uvx windows-mcp@0.8.8 serve --exclude-tools ...` answered `initialize` in 1.9 s on a warm cache, and `tools/list` returned exactly the 16 documented tools with the 5 exclusions absent.

{{NPM_LINE}}

Maintenance: any change to the pin, the exclusion list or the documented tool count has to keep that test suite green.
