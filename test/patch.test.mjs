/**
 * Unit tests for the shell patcher. These never touch an installation: they run
 * `patchSource` / `unpatchSource` against a stand-in shell body, which is enough
 * to pin the insert, the relabel upgrade and the revert.
 *
 * Run with: node --test test/
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { MARKER, patchSource, unpatchSource } from '../asar-patch.js'

/** The tray template fragment the patch keys off, with tab indentation. */
const ANCHOR = '\t\t\t{ type: "separator" },\n\t\t\t{\n\t\t\t\tlabel: messages.quitApplication,'

/** A minimal shell body containing that fragment. */
const SHELL = [
  'var DesktopTray = class {',
  '\trelabel() {',
  '\t\ttray.setContextMenu(Menu.buildFromTemplate([',
  '\t\t\t{ label: messages.openApplication, click: () => { this.options.open(); } },',
  ANCHOR,
  '\t\t\t\tclick: () => { this.options.quit(); }',
  '\t\t\t}',
  '\t\t]));',
  '\t}',
  '};',
  'export {};',
  '',
].join('\n')

/** The label expression the patched shell uses, composed from the locale table. */
const LABEL = '`${messages.restartApplication} ${messages.aboutProduct}`'

test('inserts the restart entry in front of the separator', () => {
  const result = patchSource(SHELL)
  assert.equal(result.changed, true)
  assert.equal(result.reason, 'inserted the restart entry')
  assert.ok(result.text.includes(MARKER))
  assert.ok(result.text.includes(LABEL))
  // The entry sits between "open" and the separator.
  const open = result.text.indexOf('messages.openApplication')
  const marker = result.text.indexOf(MARKER)
  const separator = result.text.indexOf('{ type: "separator" }')
  assert.ok(open < marker && marker < separator)
})

test('labels the entry with the product name, not a bare 重启', () => {
  const { text } = patchSource(SHELL)
  assert.ok(!text.includes('label: messages.restartApplication,'))
  assert.ok(text.includes(LABEL))
})

test('relaunches through the shell own restart primitive', () => {
  const { text } = patchSource(SHELL)
  assert.ok(text.includes('app.relaunch();'))
  assert.ok(text.includes('quitWithoutConfirmation();'))
})

test('is idempotent', () => {
  const once = patchSource(SHELL)
  const twice = patchSource(once.text)
  assert.equal(twice.changed, false)
  assert.equal(twice.reason, 'already patched')
  assert.equal(twice.text, once.text)
})

test('upgrades a body carrying the original bare label', () => {
  const { text } = patchSource(SHELL)
  const legacy = text.replace(LABEL, 'messages.restartApplication')
  assert.notEqual(legacy, text)

  const upgraded = patchSource(legacy)
  assert.equal(upgraded.changed, true)
  assert.equal(upgraded.reason, 'relabelled the restart entry with the product name')
  // The upgrade must land on exactly the bytes a fresh insert produces.
  assert.equal(upgraded.text, text)
})

test('gates the entry on the enable marker', () => {
  const { text } = patchSource(SHELL)
  assert.ok(text.includes('desktop-tray-restart.enabled'))
  assert.ok(text.includes('if (!existsSync(join(home, "desktop-tray-restart.enabled"))) return [];'))
})

test('reverts to the original bytes', () => {
  const { text } = patchSource(SHELL)
  assert.equal(unpatchSource(text), SHELL)
})

test('reverts the bare-label form too', () => {
  const { text } = patchSource(SHELL)
  const legacy = text.replace(LABEL, 'messages.restartApplication')
  assert.equal(unpatchSource(legacy), SHELL)
})

test('reports a build whose tray template moved', () => {
  const result = patchSource('export {};\n')
  assert.equal(result.changed, false)
  assert.equal(result.reason, 'tray menu template not found in this build')
  assert.equal(unpatchSource('export {};\n'), undefined)
})
