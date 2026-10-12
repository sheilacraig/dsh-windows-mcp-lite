/**
 * Invariants of this plugin. Run with `npm test` (node --test).
 *
 * The point is not coverage: it is that the claims this repository makes — the
 * pinned upstream version, the exclusion list, the tool count, and "no
 * machine-specific path is ever published" — are checked mechanically, so a
 * later edit cannot quietly make the documentation untrue.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(root, relative), 'utf8')

const patchText = read('cordis.patch.yml')
const patch = yaml.load(patchText)
const pkg = JSON.parse(read('package.json'))

/** Upstream windows-mcp 0.8.8 tool set, as published by `tools/list`. */
const UPSTREAM_TOOLS = [
  'App', 'Click', 'Clipboard', 'ControlStatus', 'DisplayInventory', 'FileSystem',
  'Move', 'MultiEdit', 'MultiSelect', 'Notification', 'PowerShell', 'Process',
  'Registry', 'Screenshot', 'Scrape', 'Scroll', 'Shortcut', 'Snapshot', 'Type',
  'Wait', 'WaitFor',
]
const EXCLUDED = ['PowerShell', 'Registry', 'FileSystem', 'Process', 'Scrape']
const PIN = 'windows-mcp@0.8.8'

const row = patch?.[0]?.insert?.[0]
const config = row?.config

test('the patch mounts the in-box MCP client bridge exactly once', () => {
  assert.ok(Array.isArray(patch), 'cordis.patch.yml must be a top-level list')
  assert.equal(patch.length, 1, 'expected exactly one patch entry')
  assert.ok(Array.isArray(patch[0].insert), 'expected an insert list')
  assert.equal(patch[0].insert.length, 1, 'expected exactly one inserted row')
  assert.equal(row.name, '@deepseek-ai/dsh-mcp-client')
  assert.equal(typeof row.id, 'string')
  assert.ok(row.id.length > 0)
})

test('serverName is a valid tool-name namespace', () => {
  assert.match(config.serverName, /^[A-Za-z0-9_-]{1,32}$/)
})

test('transport shape is complete', () => {
  assert.equal(config.transport, 'stdio')
  assert.equal(typeof config.command, 'string')
  assert.ok(config.command.length > 0)
  assert.ok(Array.isArray(config.args) && config.args.length > 0)
  assert.ok(!('url' in config), 'stdio rows must not also carry a url')
})

test('the command carries no machine-specific path', () => {
  assert.equal(config.command, 'uvx', 'the bridge must resolve uvx from PATH')
  for (const arg of config.args) {
    assert.doesNotMatch(
      String(arg),
      /(^[A-Za-z]:[\\/])|(^\\\\)|(\/Users\/)|(\/home\/)/,
      'a published argument must never embed a local path',
    )
  }
})

test('the upstream version is pinned', () => {
  assert.equal(config.args[0], PIN, 'args[0] must be windows-mcp@<exact version>')
  assert.match(config.args[1], /^serve$/)
})

test('the documented exclude list is the one that ships', () => {
  const index = config.args.indexOf('--exclude-tools')
  assert.ok(index > -1, 'expected --exclude-tools')
  const names = String(config.args[index + 1]).split(',').map((name) => name.trim())
  assert.deepEqual(names, EXCLUDED)
  for (const name of names) {
    assert.ok(UPSTREAM_TOOLS.includes(name), `${name} is not an upstream 0.8.8 tool name`)
  }
})

test('the documented tool count follows from the exclusion list', () => {
  const remaining = UPSTREAM_TOOLS.filter((name) => !EXCLUDED.includes(name))
  assert.equal(remaining.length, 16, 'README and CHANGELOG claim 16 tools')
  assert.ok(read('README.md').includes('**16 tools**'))
  assert.ok(read('README.zh.md').includes('**16 个工具**'))
})

test('activation cannot brick the harness, and the timeouts are the documented ones', () => {
  assert.equal(config.failOnStartupError, false)
  assert.equal(config.toolCallTimeoutMs, 120000)
})

test('the privacy defaults are the documented ones', () => {
  assert.equal(config.env.ANONYMIZED_TELEMETRY, 'false')
  assert.equal(config.env.WINDOWS_MCP_DISABLE_FLASH, '1')
})

test('no published file contains a machine-specific path', () => {
  const pattern = /(^|[^A-Za-z0-9])([A-Za-z]:\\|\/Users\/|\/home\/)/
  for (const file of ['cordis.patch.yml', 'package.json', 'locale/en.json', 'locale/zh.json']) {
    assert.doesNotMatch(read(file), pattern, `${file} must not embed a local path`)
  }
})

test('prewarm.mjs agrees with the patch', () => {
  const script = read('tools/prewarm.mjs')
  assert.ok(script.includes(`'${PIN}'`), 'prewarm must run the same pinned spec')
  for (const name of EXCLUDED) {
    assert.ok(script.includes(`'${name}'`), `prewarm must know about ${name}`)
  }
  assert.ok(script.includes(`UPSTREAM_TOOL_COUNT = ${UPSTREAM_TOOLS.length}`))
})

test('the manifest is installable and publishable', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.manifestVersion, 1)
  assert.notEqual(pkg.private, true, 'private:true would make this unpublishable')
  assert.equal(pkg.dependencies, undefined, 'this plugin has no runtime dependency')
  assert.match(pkg.engines.dsh, /0\.2\.0-rc\.1/, 'declare the DSH range the bridge needs')
  assert.equal(pkg.exports['./package.json'], './package.json')
  assert.ok('./locale/*.json' in pkg.exports, 'locale files back the plugin-panel card')
  assert.ok(pkg.files.includes('cordis.patch.yml'))
})

test('display metadata is complete in both languages', () => {
  assert.equal(pkg.icon, './icon.svg')
  assert.ok(existsSync(join(root, 'icon.svg')))
  for (const file of ['locale/en.json', 'locale/zh.json']) {
    const meta = JSON.parse(read(file)).meta
    assert.ok(meta.title.length > 0, `${file} needs meta.title`)
    assert.ok(meta.description.length > 0, `${file} needs meta.description`)
  }
})

test('the repository field points at the repository that is listed', () => {
  assert.match(pkg.repository.url, /github\.com\/sheilacraig\/dsh-windows-mcp-lite/)
  assert.match(pkg.homepage, /github\.com\/sheilacraig\/dsh-windows-mcp-lite/)
})
