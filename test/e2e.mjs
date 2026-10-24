/**
 * End-to-end smoke test against the REAL installation, using the copies in this
 * project. Run explicitly (it rewrites the archive and puts it back):
 *
 *   node test/e2e.mjs
 *
 * It asserts the round trip is byte-exact, which is what makes `revert` safe.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { apply, revert, status } from '../asar-patch.js'

const INSTALL = process.env.DSH_DESKTOP_INSTALL_DIR ?? 'E:\\dsh'
const ARCHIVE = `${INSTALL}\\resources\\app.asar`

const read = () => {
  process.noAsar = true
  try {
    return readFileSync(ARCHIVE)
  } finally {
    process.noAsar = undefined
  }
}
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')

let failures = 0
const check = (label, condition) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) failures++
}

const initial = status({ installRoot: INSTALL })
if (initial.layout === undefined) {
  console.log(`skipped: no installation at ${INSTALL}`)
  process.exit(0)
}
console.log(`installation: ${INSTALL}`)
console.log(`shell:        ${initial.layout.asar}\n`)

// Start from a known state: if patched, revert first so the baseline is pristine.
if (initial.patched) {
  const undone = revert({ installRoot: INSTALL })
  check(`reverted to a pristine archive (${undone.reason})`, undone.changed)
}
const pristine = read()
const pristineSha = sha(pristine)
console.log(`pristine archive: ${pristine.length} bytes\n`)

const applied = apply({ installRoot: INSTALL })
check(`applied the patch (${applied.reason})`, applied.changed)
check('status reports patched', status({ installRoot: INSTALL }).patched === true)

const patched = read()
check('the archive grew', patched.length > pristine.length)
check('the shell carries the restart marker', patched.toString('utf8').includes('// dsh-tray-restart: restart entry'))
check('the shell labels the entry with the product name',
  patched.toString('utf8').includes('`${messages.restartApplication} ${messages.aboutProduct}`'))

const again = apply({ installRoot: INSTALL })
check(`a second apply is a no-op (${again.reason})`, again.changed === false)
check('the no-op left the archive untouched', sha(read()) === sha(patched))

const undone = revert({ installRoot: INSTALL })
check(`reverted (${undone.reason})`, undone.changed)
const restored = read()
check('the archive is back to its pristine length', restored.length === pristine.length)
check('the archive is back to its pristine bytes', sha(restored) === pristineSha)
check('status reports unpatched', status({ installRoot: INSTALL }).patched === false)

// Leave the installation exactly as we found it.
if (initial.patched) {
  apply({ installRoot: INSTALL })
  check('restored the patched state we started from', status({ installRoot: INSTALL }).patched === true)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
