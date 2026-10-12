#!/usr/bin/env node
/**
 * Pre-warm and verify the upstream Windows-MCP server, outside DeepSeek Harness.
 *
 * Why this exists: the bridge starts `uvx windows-mcp@<pin> serve
 * --exclude-tools ...`, and `uvx` builds that environment on first use. In a
 * harness that gives up on the initial MCP connection long before a cold
 * download finishes, the plugin then looks broken. This script does the
 * download here, in your own terminal, with no timeout, and proves the pinned
 * version answers the MCP handshake before the harness ever tries.
 *
 * It runs the same argv the bridge runs and speaks the minimum protocol by hand
 * (initialize -> tools/list). No dependency: Node's child_process and JSON are
 * enough.
 *
 *   node tools/prewarm.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/** Must match the pin in cordis.patch.yml — a test asserts the two agree. */
const SPEC = 'windows-mcp@0.8.8'
/** Must match --exclude-tools in cordis.patch.yml — a test asserts it. */
const EXCLUDED = ['PowerShell', 'Registry', 'FileSystem', 'Process', 'Scrape']
/** Upstream 0.8.8 publishes 21 tools; this plugin's default excludes 5. */
const UPSTREAM_TOOL_COUNT = 21

const READY_TIMEOUT_MS = 20 * 60 * 1000
const ANSWER_TIMEOUT_MS = 90 * 1000
const EXIT_GRACE_MS = 5000

const t0 = Date.now()
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
const say = (line) => process.stdout.write(`${line}\n`)
const warn = (line) => process.stderr.write(`${line}\n`)

function findUvx() {
  const fromPath = spawnSync('uvx', ['--version'], { encoding: 'utf8' })
  if (!fromPath.error && fromPath.status === 0) {
    return { cmd: 'uvx', where: 'on PATH' }
  }
  const fallback = join(homedir(), '.local', 'bin', platform() === 'win32' ? 'uvx.exe' : 'uvx')
  if (existsSync(fallback)) {
    const local = spawnSync(fallback, ['--version'], { encoding: 'utf8' })
    if (!local.error && local.status === 0) {
      return { cmd: fallback, where: `not on PATH; using ${fallback}` }
    }
  }
  return undefined
}

function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (platform() === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

async function main() {
  if (platform() !== 'win32') {
    warn('[prewarm] Windows-MCP is Windows-only; nothing to do here.')
    process.exitCode = 1
    return
  }

  const uvx = findUvx()
  if (uvx === undefined) {
    warn('[prewarm] `uvx` was not found.')
    warn('          Install uv first: https://docs.astral.sh/uv/')
    warn('          Then re-run: node tools/prewarm.mjs')
    process.exitCode = 1
    return
  }

  say(`[prewarm] uvx ${uvx.where}`)
  say(`[prewarm] starting: uvx ${SPEC} serve --exclude-tools ${EXCLUDED.join(',')}`)
  say('[prewarm] a cold uv cache downloads a few tens of MB here; this can take minutes.')
  say('')

  const stderrTail = []
  const child = spawn(uvx.cmd, [SPEC, 'serve', '--exclude-tools', EXCLUDED.join(',')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const pending = new Map()
  let buffered = ''
  let sawJsonRpc = false

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffered += chunk
    let index
    while ((index = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, index).trim()
      buffered = buffered.slice(index + 1)
      if (line === '') continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue // server logs share this channel; only JSON-RPC matters
      }
      sawJsonRpc = true
      if (message.id !== undefined && pending.has(message.id)) {
        const settle = pending.get(message.id)
        pending.delete(message.id)
        settle(message)
      }
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim() === '') continue
      stderrTail.push(line)
      if (stderrTail.length > 40) stderrTail.shift()
    }
  })

  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code ?? -1)))
  const died = exited.then((code) => {
    killTree(child)
    return code
  })

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
  const waitFor = (id, timeoutMs, label) =>
    Promise.race([
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`${label}: no response within ${Math.round(timeoutMs / 1000)}s`))
        }, timeoutMs)
        pending.set(id, (message) => {
          clearTimeout(timer)
          resolve(message)
        })
      }),
      died.then((code) => {
        throw new Error(`the server exited with code ${code} before answering ${label}`)
      }),
    ])

  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'dsh-windows-mcp-lite/prewarm', version: '1.0.0' },
      },
    })
    const ready = await waitFor(1, READY_TIMEOUT_MS, 'initialize')
    if (ready.error !== undefined) throw new Error(`initialize failed: ${JSON.stringify(ready.error)}`)
    const info = ready.result?.serverInfo ?? {}
    say(`[prewarm] ready in ${elapsed()} — ${info.name ?? '?'} ${info.version ?? '?'} (protocol ${ready.result?.protocolVersion ?? '?'})`)

    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const listed = await waitFor(2, ANSWER_TIMEOUT_MS, 'tools/list')
    const tools = (listed.result?.tools ?? []).map((tool) => tool.name).sort()
    if (tools.length === 0) throw new Error('tools/list returned no tools')

    const leaked = EXCLUDED.filter((name) => tools.includes(name))
    const expected = UPSTREAM_TOOL_COUNT - EXCLUDED.length

    say('')
    say(`[prewarm] tools (${tools.length}): ${tools.join(', ')}`)
    say(`[prewarm] expect ${expected} = upstream ${UPSTREAM_TOOL_COUNT} - excluded ${EXCLUDED.length}`)
    say(`[prewarm] excluded and confirmed absent: ${EXCLUDED.join(', ')}`)

    if (leaked.length > 0) {
      throw new Error(
        `these tools should have been excluded but are present: ${leaked.join(', ')} — ` +
          'upstream either renamed them or ignored --exclude-tools; check the pin',
      )
    }
    if (tools.length !== expected) {
      throw new Error(
        `expected ${expected} tools, got ${tools.length} — upstream ${SPEC} changed its tool set; ` +
          'review the pin and the exclusion list, then update this script and the README',
      )
    }

    child.stdin.end()
    const code = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(null), EXIT_GRACE_MS))])
    if (code === null) killTree(child)

    say('')
    say(`[prewarm] OK — ${SPEC} is installed, verified, and answers the MCP handshake.`)
    say('[prewarm] The harness bridge will reuse this environment; enable the plugin and restart DSH.')
  } catch (error) {
    killTree(child)
    warn('')
    warn(`[prewarm] FAILED after ${elapsed()}: ${error instanceof Error ? error.message : String(error)}`)
    if (stderrTail.length > 0) {
      warn('[prewarm] last lines from the server:')
      for (const line of stderrTail) warn(`          ${line}`)
    }
    if (!sawJsonRpc) {
      warn('[prewarm] hints:')
      warn('          - `uvx` must be the one DSH will use: install uv and open a new terminal.')
      warn('          - If you ran this inside an agent session that confines file writes,')
      warn('            comtypes may be unable to create its COM cache under %APPDATA%.')
      warn('            Run it in a normal terminal instead.')
    }
    process.exitCode = 1
  }
}

await main()
