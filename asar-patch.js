/**
 * Surgical patch for the installed DSH Desktop shell.
 *
 * WHY THIS EXISTS
 * The Windows system tray lives in the Electron shell (`lib/main.js` inside the
 * installed app), and the shell builds its tray menu from a literal template:
 *
 *     tray.setContextMenu(Menu.buildFromTemplate([
 *         { label: messages.openApplication, ... },
 *         { type: "separator" },
 *         { label: messages.quitApplication, ... }
 *     ]));
 *
 * A Harness plugin runs in the Node-mode Host child process, which has no
 * Electron API and no IPC channel that can reach the shell (the shell's
 * `isDesktopHostEvent` allowlist kills the Host for any unknown message type).
 * So the only way to add a tray entry is to change the shell's own code, which
 * is what this module does.
 *
 * WHY THE ARCHIVE IS PATCHED IN PLACE
 * `resources/app.asar` holds the whole shell. The obvious alternative — extract
 * it to `resources/app` and move the archive aside, the way the bundled browser
 * bridge does — costs ~355 MB and several seconds, breaks `dsh <args>` until two
 * CLI files are patched too, and cannot even run while the app is open: Windows
 * refuses to rename the archive the running shell holds (measured: EBUSY).
 *
 * Editing the archive in place is safe on this build, because the two fuses
 * that would otherwise object are both disabled in the shipped executable
 * (measured from the fuse wire `101100011` at the sentinel: index 4
 * `EnableEmbeddedAsarIntegrityValidation` and index 5 `OnlyLoadAppFromAsar`
 * are `0`), and the executable embeds no asar integrity blob to check against.
 *
 * HOW IT IS EDITED
 * Only `lib/main.js` changes, and its new bytes are appended to the end of the
 * archive instead of replacing the old ones, so no other file's offset moves.
 * The header JSON entry for `lib/main.js` is then rewritten to point at the
 * appended copy. The header's own byte length is kept identical (a shorter JSON
 * is padded with spaces, which `JSON.parse` accepts), so `contentBase` — the
 * start of the content region every offset is relative to — does not move.
 * The edit is one header write plus one ~0.5 MB append, with every other file
 * byte-for-byte untouched (verified over all 16604 packed entries).
 *
 * The append happens before the header write, so an interrupted patch leaves a
 * valid archive whose `lib/main.js` entry still points at the original bytes.
 *
 * WHY THE PATCH IS NOT UNDONE ON DISPOSE
 * The shell reads its code only at startup. A patch installed by a plugin that
 * is active during a running session therefore shows up on the NEXT launch — and
 * that launch disposes the plugin (the Host restarts), which would immediately
 * revert it. The patch is consequently permanent and gated at runtime by an
 * enable marker: the injected code only adds the tray entry while
 * `%DSH_HOME%\desktop-tray-restart.enabled` exists. Disabling the plugin
 * removes that file, so the entry disappears without touching 182 MB again.
 *
 * @module asar-patch
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  fstatSync,
  ftruncateSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

/** Marker carried by the patched shell; idempotence and revert both key off it. */
export const MARKER = '// dsh-tray-restart: restart entry in the Windows tray menu'

/**
 * Run `operation` with Electron's asar filesystem layer switched off.
 *
 * The Host runs under `ELECTRON_RUN_AS_NODE`, where Electron wraps `node:fs` so
 * that any path containing `.asar` is treated as a path INSIDE an archive. Our
 * paths are the archive itself and its sidecar backups
 * (`app.asar.dsh-tray-restart.header`), so without this every open, stat and
 * exists check resolves to a missing archive member and fails with
 * `ENOENT,  not found in <archive>`. `process.noAsar` is the documented escape
 * hatch; it is restored afterwards so unrelated file access is unaffected.
 * @param operation - Work to run against the real filesystem.
 * @returns Whatever the operation returns.
 */
function withRawFs(operation) {
  const previous = process.noAsar
  process.noAsar = true
  try {
    return operation()
  } finally {
    process.noAsar = previous
  }
}

/** Backup of the pre-patch asar header, next to the archive. */
const HEADER_BACKUP_SUFFIX = '.dsh-tray-restart.header'
/** Manifest describing that backup. */
const MANIFEST_SUFFIX = '.dsh-tray-restart.json'
/** Backup of the pre-patch `lib/main.js` for the already-unpacked layout. */
const MAIN_BACKUP_SUFFIX = '.dsh-tray-restart.main.js'

/** The exact tray template fragment the restart entry is inserted in front of. */
const TRAY_ANCHOR = '\t\t\t{ type: "separator" },\n\t\t\t{\n\t\t\t\tlabel: messages.quitApplication,'

/**
 * Resolve the enable marker the injected shell code gates the tray entry on.
 * The injected code computes the same path from `DSH_HOME` (or `~/.dsh`).
 * @returns Absolute marker path.
 */
export function enableMarkerPath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
  return join(home, 'desktop-tray-restart.enabled')
}

/** Marker file written by the plugin while it is enabled. */
const ENABLE_MARKER_LITERAL = 'desktop-tray-restart.enabled'

/**
 * The block inserted in front of {@link TRAY_ANCHOR}: a `重启 DeepSeek Harness`
 * / `Restart DeepSeek Harness` item that relaunches the app the way the shell's
 * own restart entries do (`app.relaunch()` then the confirmation-free quit,
 * both in module scope).
 *
 * The label is composed from the shell's own locale table so it stays parallel
 * with its neighbours: `openApplication` is "打开 DeepSeek Harness" and
 * `quitApplication` is "退出 DeepSeek Harness", so the restart entry needs the
 * product name too — `restartApplication` alone would read as a bare "重启".
 * `aboutProduct` is guaranteed present because `relabel()` already reads it for
 * the tray tooltip.
 *
 * The item is only added while the enable marker exists, so removing the marker
 * removes the entry at the next launch without repatching the archive.
 */
const INSERTED = `\t\t\t${MARKER}
\t\t\t...(() => {
\t\t\t\ttry {
\t\t\t\t\tconst home = typeof process.env.DSH_HOME === "string" && process.env.DSH_HOME.trim() !== "" ? process.env.DSH_HOME.trim() : join(homedir(), ".dsh");
\t\t\t\t\tif (!existsSync(join(home, "${ENABLE_MARKER_LITERAL}"))) return [];
\t\t\t\t} catch {
\t\t\t\t\treturn [];
\t\t\t\t}
\t\t\t\treturn [{
\t\t\t\t\tlabel: \`\${messages.restartApplication} \${messages.aboutProduct}\`,
\t\t\t\t\tclick: () => {
\t\t\t\t\t\tapp.relaunch();
\t\t\t\t\t\tquitWithoutConfirmation();
\t\t\t\t\t}
\t\t\t\t}];
\t\t\t})(),
`

/**
 * The first shipped form of {@link INSERTED}, which labelled the entry with the
 * bare `messages.restartApplication` ("重启"). Kept only so an installation
 * patched by that version is upgraded in place instead of being reported as
 * already done.
 */
const INSERTED_V1 = `\t\t\t${MARKER}
\t\t\t...(() => {
\t\t\t\ttry {
\t\t\t\t\tconst home = typeof process.env.DSH_HOME === "string" && process.env.DSH_HOME.trim() !== "" ? process.env.DSH_HOME.trim() : join(homedir(), ".dsh");
\t\t\t\t\tif (!existsSync(join(home, "${ENABLE_MARKER_LITERAL}"))) return [];
\t\t\t\t} catch {
\t\t\t\t\treturn [];
\t\t\t\t}
\t\t\t\treturn [{
\t\t\t\t\tlabel: messages.restartApplication,
\t\t\t\t\tclick: () => {
\t\t\t\t\t\tapp.relaunch();
\t\t\t\t\t\tquitWithoutConfirmation();
\t\t\t\t\t}
\t\t\t\t}];
\t\t\t})(),
`

/**
 * Insert the restart entry into a shell `main.js` body, upgrading a body that
 * still carries the bare-label form.
 * @param text - Current body.
 * @returns The patched body, or the reason it was left alone.
 */
export function patchSource(text) {
  if (text.includes(INSERTED)) return { text, changed: false, reason: 'already patched' }
  const legacy = text.indexOf(INSERTED_V1)
  if (legacy !== -1) {
    return {
      text: `${text.slice(0, legacy)}${INSERTED}${text.slice(legacy + INSERTED_V1.length)}`,
      changed: true,
      reason: 'relabelled the restart entry with the product name',
    }
  }
  const at = text.indexOf(TRAY_ANCHOR)
  if (at === -1) return { text, changed: false, reason: 'tray menu template not found in this build' }
  return { text: `${text.slice(0, at)}${INSERTED}${text.slice(at)}`, changed: true, reason: 'inserted the restart entry' }
}

/**
 * Remove the restart entry from a shell `main.js` body, whichever form it is in.
 * @param text - Current body.
 * @returns The unpatched body, or undefined when the inserted block is absent.
 */
export function unpatchSource(text) {
  for (const block of [INSERTED, INSERTED_V1]) {
    const at = text.indexOf(block)
    if (at !== -1) return text.slice(0, at) + text.slice(at + block.length)
  }
  return undefined
}

/** SHA-256 of a buffer, as asar spells it. */
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** asar's per-file integrity block. */
function integrityFor(content) {
  const blockSize = 4 * 1024 * 1024
  const blocks = []
  for (let offset = 0; offset < content.length; offset += blockSize) {
    blocks.push(sha256(content.subarray(offset, Math.min(offset + blockSize, content.length))))
  }
  if (blocks.length === 0) blocks.push(sha256(content))
  return { algorithm: 'SHA256', hash: blocks.length === 1 ? blocks[0] : sha256(content), blockSize, blocks }
}

/**
 * Read an asar header.
 * @param fd - Open descriptor for the archive.
 * @returns Parsed header plus the geometry the content region depends on.
 */
function readHeader(fd) {
  const outer = Buffer.alloc(8)
  readSync(fd, outer, 0, 8, 0)
  const headerSize = outer.readUInt32LE(4)
  const headerBuf = Buffer.alloc(headerSize)
  readSync(fd, headerBuf, 0, headerSize, 8)
  const jsonLen = headerBuf.readUInt32LE(4)
  const json = headerBuf.toString('utf8', 8, 8 + jsonLen)
  return { headerSize, jsonLen, headerBuf, json, header: JSON.parse(json), contentBase: 8 + headerSize }
}

/** Read the bytes an asar entry points at. */
function readEntry(fd, contentBase, entry) {
  const content = Buffer.alloc(entry.size)
  if (entry.size > 0) readSync(fd, content, 0, entry.size, contentBase + Number(entry.offset))
  return content
}

/** Paths derived from a desktop install root. */
function layoutOf(installRoot) {
  const resources = join(installRoot, 'resources')
  return {
    installRoot,
    resources,
    asar: join(resources, 'app.asar'),
    unpackedMain: join(resources, 'app', 'lib', 'main.js'),
  }
}

/**
 * Locate the installed DSH Desktop this Host is a child of.
 * @param explicit - Install root from config, when the caller supplied one.
 * @returns The layout, or the reason no install could be found.
 */
export function resolveInstall(explicit) {
  const candidates = []
  if (explicit !== undefined && explicit !== '') candidates.push(explicit)
  // The shell hands the Host the executable that launched it. Inside the Host
  // `process.execPath` is the runtime's own node binary, not the shell, so this
  // variable is the reliable way back to the installation directory.
  const fromShell = process.env.DSH_DESKTOP_NODE_EXECUTABLE
  if (typeof fromShell === 'string' && fromShell.trim() !== '') candidates.push(dirname(fromShell.trim()))
  if (process.execPath !== undefined) candidates.push(dirname(process.execPath))
  // The Host also runs as `<install>/resources/runtime/node/bin/node.exe`, and is
  // started with the project directory as its cwd; walk up from both.
  if (typeof process.cwd === 'function') candidates.push(process.cwd())
  // Running the CLI outside the desktop (plain `node tools/tray-restart.mjs`) has
  // no shell environment to read, so accept an explicit pointer instead.
  const fromEnv = process.env.DSH_DESKTOP_INSTALL_DIR
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') candidates.push(fromEnv.trim())
  for (const candidate of candidates) {
    for (const root of ancestors(candidate)) {
      const layout = layoutOf(root)
      if (existsSync(layout.asar) || existsSync(layout.unpackedMain)) return { layout }
    }
  }
  return {
    error: `no DSH Desktop installation found (looked for resources/app.asar under ${candidates.join(', ') || 'no candidate'}); pass --install <dir> or set DSH_DESKTOP_INSTALL_DIR`,
  }
}

/**
 * A directory and its ancestors, nearest first.
 * @param start - Directory to begin at.
 * @returns Up to five ancestors, including `start`.
 */
function ancestors(start) {
  const roots = []
  let current = start
  for (let depth = 0; depth < 5; depth++) {
    roots.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return roots
}

/**
 * Patch a packed installation by rewriting the archive in place.
 * @param layout - Resolved install layout.
 * @returns What happened.
 */
function patchPacked(layout) {
  const headerBackup = `${layout.asar}${HEADER_BACKUP_SUFFIX}`
  const manifestPath = `${layout.asar}${MANIFEST_SUFFIX}`
  const fd = openSync(layout.asar, 'r+')
  try {
    const { jsonLen, headerBuf, json, header, contentBase } = readHeader(fd)
    const entry = header.files?.lib?.files?.['main.js']
    if (entry === undefined) throw new Error('app.asar has no lib/main.js entry')
    const original = readEntry(fd, contentBase, entry)
    const patched = patchSource(original.toString('utf8'))
    if (!patched.changed) return { changed: false, reason: patched.reason, layout }

    const content = Buffer.from(patched.text, 'utf8')
    const archiveSize = fstatSync(fd).size
    // asar offsets are relative to the start of the content region, not the file.
    const appendedOffset = archiveSize - contentBase
    const appendedPosition = archiveSize

    // A pre-existing manifest describes the pristine archive this patch was
    // first applied to; re-patching (a relabel, say) must keep that baseline
    // instead of recording the already-patched state as "original".
    const previous = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, 'utf8'))
      : undefined

    const entryText = JSON.stringify(entry)
    if (json.split(entryText).length - 1 !== 1) {
      throw new Error('lib/main.js entry is not uniquely identifiable in the archive header')
    }
    const nextJson = json.replace(entryText, JSON.stringify({
      size: content.length,
      offset: String(appendedOffset),
      integrity: integrityFor(content),
    }))
    if (nextJson.length > jsonLen) {
      throw new Error(`patched header would grow from ${jsonLen} to ${nextJson.length} bytes, which would move every other file in the archive`)
    }

    // Back up only on the FIRST patch: the header and manifest are the revert
    // baseline, and the bytes they describe are the shipped ones.
    if (!existsSync(headerBackup) || previous === undefined) {
      writeFileSync(headerBackup, headerBuf)
      writeFileSync(manifestPath, `${JSON.stringify({
        archive: layout.asar,
        originalSize: archiveSize,
        headerSize: headerBuf.length,
        jsonLen,
        originalMainHash: sha256(original),
        patchedAt: new Date().toISOString(),
      }, null, 2)}\n`)
    }

    // Append first, so a failure before the header write leaves the archive
    // fully valid and still pointing at the original main.js.
    writeSync(fd, content, 0, content.length, appendedPosition)
    fsyncSync(fd)
    writeSync(fd, Buffer.from(nextJson + ' '.repeat(jsonLen - nextJson.length), 'utf8'), 0, jsonLen, 16)
    fsyncSync(fd)

    // Read back through a fresh descriptor: prove the app will find exactly the
    // bytes just written, not merely a body that happens to carry the marker.
    const verify = openSync(layout.asar, 'r')
    try {
      const again = readHeader(verify)
      const check = readEntry(verify, again.contentBase, again.header.files.lib.files['main.js'])
      if (!check.equals(content)) throw new Error('patched archive does not read back with the restart entry')
    } finally {
      closeSync(verify)
    }
    return { changed: true, reason: patched.reason, layout, appendedBytes: content.length }
  } finally {
    closeSync(fd)
  }
}

/**
 * Patch an already-unpacked installation (`resources/app/lib/main.js`).
 * @param layout - Resolved install layout.
 * @returns What happened.
 */
function patchUnpacked(layout) {
  const backup = `${layout.unpackedMain}${MAIN_BACKUP_SUFFIX}`
  const current = readFileSync(layout.unpackedMain, 'utf8')
  const patched = patchSource(current)
  if (!patched.changed) return { changed: false, reason: patched.reason, layout }
  if (!existsSync(backup)) writeFileSync(backup, current)
  writeFileSync(layout.unpackedMain, patched.text)
  return { changed: true, reason: patched.reason, layout }
}

/**
 * Ensure the tray restart entry is present in the installed shell.
 * @param options - Optional explicit install root.
 * @returns Whether anything changed, and why.
 */
export function apply(options = {}) {
  return withRawFs(() => {
    const resolved = resolveInstall(options.installRoot)
    if (resolved.error !== undefined) return { changed: false, reason: resolved.error }
    const { layout } = resolved
    // The archive wins over the directory whenever it exists, so it decides the layout.
    return existsSync(layout.asar) ? patchPacked(layout) : patchUnpacked(layout)
  })
}

/**
 * Remove the tray restart entry from the installed shell.
 * @param options - Optional explicit install root.
 * @returns Whether anything changed, and why.
 */
export function revert(options = {}) {
  return withRawFs(() => {
    const resolved = resolveInstall(options.installRoot)
    if (resolved.error !== undefined) return { changed: false, reason: resolved.error }
    const { layout } = resolved

    if (existsSync(layout.asar)) {
      const headerBackup = `${layout.asar}${HEADER_BACKUP_SUFFIX}`
      const manifestPath = `${layout.asar}${MANIFEST_SUFFIX}`
      if (!existsSync(headerBackup) || !existsSync(manifestPath)) {
        return { changed: false, reason: 'no saved header for this installation; nothing to revert' }
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const headerBuf = readFileSync(headerBackup)
      const fd = openSync(layout.asar, 'r+')
      try {
        const { contentBase, header } = readHeader(fd)
        const entry = header.files?.lib?.files?.['main.js']
        const current = entry === undefined ? undefined : readEntry(fd, contentBase, entry).toString('utf8')
        if (current === undefined || !current.includes(MARKER)) {
          return { changed: false, reason: 'the installed shell does not carry this patch (a desktop upgrade probably replaced it); nothing to revert' }
        }
        writeSync(fd, headerBuf, 0, headerBuf.length, 8)
        ftruncateSync(fd, manifest.originalSize)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      for (const path of [headerBackup, manifestPath]) {
        try {
          unlinkSync(path)
        } catch {
          // Leftover backups are inert; failed cleanup must not fail the revert.
        }
      }
      return { changed: true, reason: 'restored the original shell and truncated the appended body', layout }
    }

    const backup = `${layout.unpackedMain}${MAIN_BACKUP_SUFFIX}`
    if (!existsSync(layout.unpackedMain) || !existsSync(backup)) {
      return { changed: false, reason: 'no saved shell for this installation; nothing to revert' }
    }
    const current = readFileSync(layout.unpackedMain, 'utf8')
    const restored = unpatchSource(current)
    if (restored === undefined) return { changed: false, reason: 'the installed shell does not carry this patch' }
    writeFileSync(layout.unpackedMain, restored)
    try {
      unlinkSync(backup)
    } catch {
      // See above.
    }
    return { changed: true, reason: 'removed the restart entry', layout }
  })
}

/**
 * Report whether the installed shell carries the restart entry.
 * @param options - Optional explicit install root.
 * @returns Layout facts and the current patch state.
 */
export function status(options = {}) {
  return withRawFs(() => {
    const resolved = resolveInstall(options.installRoot)
    if (resolved.error !== undefined) return { patched: false, reason: resolved.error }
    const { layout } = resolved

    if (existsSync(layout.asar)) {
      const fd = openSync(layout.asar, 'r')
      try {
        const { contentBase, header } = readHeader(fd)
        const entry = header.files?.lib?.files?.['main.js']
        if (entry === undefined) return { patched: false, layout, reason: 'app.asar has no lib/main.js entry' }
        const body = readEntry(fd, contentBase, entry).toString('utf8')
        return {
          patched: body.includes(MARKER),
          layout,
          packed: true,
          layoutKind: 'app.asar',
          shellBytes: entry.size,
          supported: body.includes(TRAY_ANCHOR) || body.includes(MARKER),
          enabled: existsSync(enableMarkerPath()),
          enableMarker: enableMarkerPath(),
        }
      } finally {
        closeSync(fd)
      }
    }
    if (!existsSync(layout.unpackedMain)) return { patched: false, layout, reason: 'no shell found' }
    const body = readFileSync(layout.unpackedMain, 'utf8')
    return {
      patched: body.includes(MARKER),
      layout,
      packed: false,
      layoutKind: 'app/',
      supported: body.includes(TRAY_ANCHOR) || body.includes(MARKER),
      enabled: existsSync(enableMarkerPath()),
      enableMarker: enableMarkerPath(),
    }
  })
}

export { statSync }
