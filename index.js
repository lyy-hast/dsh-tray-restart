/**
 * Host half of the tray-restart bundle.
 *
 * The shell that owns the Windows tray reads its code only at startup, so the
 * patch this plugin installs takes effect on the NEXT launch of DSH Desktop —
 * and that launch restarts the Host, disposing this plugin. Undoing the patch
 * on disposal would therefore erase it exactly when it is about to matter.
 *
 * The patch is consequently permanent and gated at runtime by an enable marker
 * file: the injected shell code adds the tray entry only while that marker
 * exists. Activating the plugin writes the marker and installs the patch;
 * disposing it removes the marker, so the entry disappears at the next launch
 * without touching the 182 MB archive again. Uninstalling the bundle and
 * running `tools/tray-restart.mjs revert` restores the shell byte-for-byte.
 *
 * @module @local/dsh-tray-restart
 */

import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { apply as applyShellPatch, enableMarkerPath, status } from './asar-patch.js'

/** Loader identity. */
export const name = 'dsh-tray-restart'

/**
 * Enable the tray entry: install the shell patch if needed, then write the marker.
 * @param ctx - Profile scope owning this plugin's lifetime.
 * @param config - Optional install root override.
 */
export function apply(ctx, config) {
  const logger = ctx.logger('dsh-tray-restart')
  const options = config?.installRoot === undefined ? {} : { installRoot: config.installRoot }
  const marker = enableMarkerPath()

  try {
    const result = applyShellPatch(options)
    if (result.changed) {
      logger.info(`added the Restart entry to the desktop tray menu (${result.reason}); it appears the next time DSH Desktop starts`)
    } else if (result.reason === 'already patched') {
      logger.info('the desktop tray menu already carries the Restart entry')
    } else {
      logger.warn(`desktop tray menu unchanged: ${result.reason}`)
    }
  } catch (error) {
    // A failed patch must not take the profile down with it: the desktop still
    // runs, just without the extra entry.
    logger.warn(`could not patch the desktop tray menu: ${error instanceof Error ? error.message : String(error)}`)
  }

  // The marker is what the patched shell checks, so it is written even when the
  // patch was already in place.
  try {
    writeFileSync(marker, `${JSON.stringify({ enabledAt: new Date().toISOString(), by: 'dsh-tray-restart' }, null, 2)}\n`)
  } catch (error) {
    logger.warn(`could not write the tray enable marker (${marker}): ${error instanceof Error ? error.message : String(error)}`)
  }

  // Disabling the plugin removes the marker only: the shell patch stays, inert,
  // so re-enabling needs no second archive rewrite.
  ctx.effect(() => () => {
    try {
      if (existsSync(marker)) {
        rmSync(marker, { force: true })
        logger.info('disabled the desktop tray Restart entry; it disappears the next time DSH Desktop starts')
      }
    } catch (error) {
      logger.warn(`could not remove the tray enable marker (${marker}): ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

/**
 * Current patch state, for diagnostics.
 * @param installRoot - Optional install root override.
 * @returns Layout facts and the current patch state.
 */
export function inspect(installRoot) {
  return status(installRoot === undefined ? {} : { installRoot })
}
