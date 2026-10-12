# Changelog

## 1.0.0 — 2026-10-12

First release.

- One-row configuration bundle: mounts the in-box `@deepseek-ai/dsh-mcp-client`
  bridge against `windows-mcp@0.8.8` over stdio. No Host code, no web route, no
  state file, no runtime dependency.
- Least-privilege default: `PowerShell`, `Registry`, `FileSystem`, `Process` and
  `Scrape` are excluded, leaving 16 `mcp__windows__*` tools (upstream 0.8.8
  publishes 21).
- Upstream telemetry and the screenshot border are off by default.
- `npm run prewarm` installs and verifies the upstream server outside DeepSeek
  Harness, so the first in-harness start is not a cold download.
- `npm test` asserts the bridge invariants, including that no machine-specific
  absolute path can reach the published package.
