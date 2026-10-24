#!/usr/bin/env node
/**
 * Apply, revert or inspect the tray restart patch on an installed DSH Desktop.
 *
 * The bundle does this by itself on activation; this script exists for the
 * cases the plugin cannot cover: checking what an installation currently
 * carries, restoring it by hand, and removing the entry for good.
 *
 * USAGE
 *   node tools/tray-restart.mjs status [--install <dir>]
 *   node tools/tray-restart.mjs apply  [--install <dir>]
 *   node tools/tray-restart.mjs revert [--install <dir>]
 *
 * `status` also reports the enable marker, which is what decides whether the
 * patched shell shows the entry. `revert` restores the shell byte-for-byte and
 * removes the marker.
 */

import { existsSync, rmSync } from 'node:fs'
import { apply, enableMarkerPath, revert, status } from '../asar-patch.js'

const argv = process.argv.slice(2)
const command = argv.find((argument) => !argument.startsWith('--')) ?? 'status'
const flagIndex = argv.indexOf('--install')
const installRoot = flagIndex === -1 ? undefined : argv[flagIndex + 1]

const options = installRoot === undefined ? {} : { installRoot }

function describe(result) {
  const lines = []
  if (result.layout !== undefined) {
    lines.push(`installation: ${result.layout.installRoot}`)
    lines.push(`shell:        ${result.packed === false ? result.layout.unpackedMain : result.layout.asar}`)
    if (result.layoutKind !== undefined) lines.push(`layout:       ${result.layoutKind}`)
    if (result.supported !== undefined) lines.push(`supported:    ${result.supported ? 'yes' : 'no (this build has no tray template to extend)'}`)
  }
  if (result.patched !== undefined) lines.push(`patched:      ${result.patched ? 'yes' : 'no'}`)
  if (result.enabled !== undefined) {
    lines.push(`enabled:      ${result.enabled ? 'yes' : 'no'} (marker: ${result.enableMarker})`)
  }
  if (result.changed !== undefined) lines.push(`changed:      ${result.changed ? 'yes' : 'no'}`)
  if (result.reason !== undefined) lines.push(`reason:       ${result.reason}`)
  return lines.join('\n')
}

try {
  if (command === 'apply') {
    console.log(describe(apply(options)))
    console.log('\nThe entry appears the next time DSH Desktop starts.')
  } else if (command === 'revert') {
    const marker = enableMarkerPath()
    if (existsSync(marker)) rmSync(marker, { force: true })
    console.log(describe(revert(options)))
  } else if (command === 'status') {
    console.log(describe(status(options)))
  } else {
    console.error(`unknown command: ${command} (expected status, apply or revert)`)
    process.exitCode = 2
  }
} catch (error) {
  console.error(`failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
