<div align="center">

<img src="https://raw.githubusercontent.com/lyy-hast/dsh-tray-restart/master/icon.svg" width="76" height="76" alt="dsh-tray-restart">

# Tray Restart · dsh-tray-restart

**Adds a "Restart DeepSeek Harness" entry to the DSH Desktop system-tray menu.**

[简体中文](README.md) | English

[![GitHub stars](https://img.shields.io/github/stars/lyy-hast/dsh-tray-restart?style=flat-square&logo=github&label=stars)](https://github.com/lyy-hast/dsh-tray-restart/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/lyy-hast/dsh-tray-restart?style=flat-square)](https://github.com/lyy-hast/dsh-tray-restart/issues)
[![Last commit](https://img.shields.io/github/last-commit/lyy-hast/dsh-tray-restart?style=flat-square)](https://github.com/lyy-hast/dsh-tray-restart/commits/master)
[![License](https://img.shields.io/github/license/lyy-hast/dsh-tray-restart?style=flat-square)](LICENSE)
[![DSH Desktop only](https://img.shields.io/badge/DSH-Desktop%20only-6366f1?style=flat-square)](#compatibility)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D4?style=flat-square)](#compatibility)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-339933?style=flat-square)](https://github.com/lyy-hast/dsh-tray-restart/blob/master/package.json)
[![Tested on](https://img.shields.io/badge/tested%20on-0.2.1--rc.3-1F883D?style=flat-square)](#verification)

</div>

[Preview](#preview) · [Installation](#installation) · [When it appears](#when-it-appears) · [Why the shell must change](#why-the-shell-must-change) · [How the patch works](#how-the-patch-works) · [Enable marker](#enable-marker) · [Compatibility](#compatibility) · [Known limitations](#known-limitations) · [Uninstall and rollback](#uninstall-and-rollback) · [Development](#development) · [Verification](#verification) · [Layout](#layout) · [License](#license)

On Windows, the DSH Desktop tray menu has exactly three items: open the app, a separator, and quit. Changing a plugin setting, reloading the Host, or making a freshly installed plugin take effect all require quitting and reopening the app by hand — and the tray's "Quit" only quits, it does not come back.

This plugin adds a **Restart DeepSeek Harness** item: one click relaunches the app together with its Host, right back to where you were. It does **not** extend the plugin API; it patches the installed Electron shell in a fully reversible way.

- **One-click restart**: the tray entry uses the shell's own `app.relaunch()` plus its confirmation-free quit — the same primitives the shell's crash recovery uses, so no "tasks still running" prompt.
- **Wording matches its neighbours**: `重启 DeepSeek Harness` / `Restart DeepSeek Harness`, composed from the shell's own locale table rather than hard-coded.
- **Reversible**: the patch touches a single `lib/main.js` entry; after `revert` the archive is **byte-for-byte identical** to the original `app.asar` (SHA-256 equal).
- **Easy to switch off**: disabling the plugin removes one marker file, the menu goes back to normal, and the 182 MB archive is left alone.

> Windows desktop only. DSH Web and the CLI have no system tray, so this plugin does nothing for them.

## Preview

The tray menu before the patch:

```
Open DeepSeek Harness
──────────────────────
Quit DeepSeek Harness
```

After the patch (the Chinese locale works the same way, reading `打开 DeepSeek Harness / 重启 DeepSeek Harness / ─── / 退出 DeepSeek Harness`):

```
Open DeepSeek Harness
Restart DeepSeek Harness   ← new
──────────────────────
Quit DeepSeek Harness
```

Clicking "Restart" is equivalent to `app.relaunch()` followed by `quitWithoutConfirmation()`, with the new process bringing the Host back up. That is exactly the semantics the shell itself uses in its developer menu and crash-recovery dialog: "restart the application and the Host".

## Installation

Two paths — pick one.

### Option 1: install as a plugin (recommended)

The plugin re-checks and maintains the patch on every launch, so a desktop upgrade that replaces `app.asar` is repaired automatically.

1. Clone the repository and note where it lands (referred to below as `<plugin dir>`):

   ```powershell
   git clone https://github.com/lyy-hast/dsh-tray-restart.git D:\plugins\dsh-tray-restart
   ```

2. Open the desktop profile's `package.json`: `%DSH_HOME%\profiles\desktop\package.json` (usually `C:\Users\<you>\.dsh\profiles\desktop\package.json`).
3. Add a dependency line pointing at `<plugin dir>` (use forward slashes):

   ```json
   "@local/dsh-tray-restart": "link:D:/plugins/dsh-tray-restart"
   ```

4. Add the package name to the `dsh.profile.bundles` array:

   ```json
   "@local/dsh-tray-restart"
   ```

5. Run one install from `%DSH_HOME%\profiles\desktop`, using the pnpm that ships with DSH:

   ```powershell
   cd "$env:USERPROFILE\.dsh\profiles\desktop"
   node "<install root>\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs" install
   ```

   `<install root>` is the DSH Desktop installation root, i.e. the directory that contains `resources\app.asar`; the file is at `<install root>\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs`.

6. Fully quit DSH Desktop and start it again.

> **Do not** use `dsh plugin --profile desktop add ...`. The `desktop` profile is managed exclusively by the Electron application, and the CLI rejects it with `profile "desktop" is managed exclusively by the Electron application`.

Once installed, the plugin does two things on activation: patch the shell (if not already patched) and write the enable marker file. The log shows `added the Restart entry to the desktop tray menu (inserted the restart entry); it appears the next time DSH Desktop starts`.

> To update to the latest commit, run `git pull` in `<plugin dir>` and restart the desktop app; because the dependency uses `link:`, no second `pnpm install` is needed.

### Option 2: patch only, without the plugin

For a one-off edit that should not live in your profile:

```powershell
git clone https://github.com/lyy-hast/dsh-tray-restart.git
cd dsh-tray-restart
node tools/tray-restart.mjs apply --install "<install root>"
```

> ⚠️ `apply` **installs the patch but does not write the enable marker**. With the patch in place and no marker, the "Restart" item does not appear. Create the marker yourself to show it:
>
> ```powershell
> '{"enabledAt":"manual","by":"dsh-tray-restart"}' | Out-File -Encoding utf8 "$env:USERPROFILE\.dsh\desktop-tray-restart.enabled"
> ```
>
> The contents are irrelevant; the shell only checks whether the file exists. Delete it to hide the item, or run `revert` to restore the installation.

The patch is permanent and the shell picks it up on its next launch; see [When it appears](#when-it-appears).

## When it appears

The patch is written immediately, but the shell reads `lib/main.js` **only at startup**:

1. Enable the plugin (or run `apply` and write the marker by hand)
2. Quit DSH Desktop (tray → Quit), or end it from Task Manager
3. Start it again → the tray menu now has "Restart"

A desktop upgrade replaces `app.asar` wholesale, so the patch disappears with it; the next launch re-applies it automatically (and rebuilds the backup baseline).

## Why the shell must change

The tray menu is built by `DesktopTray.relabel()` in the Electron shell's `lib/main.js`, from a hard-coded template:

```js
tray.setContextMenu(Menu.buildFromTemplate([
    { label: messages.openApplication, click: () => { this.options.open() } },
    { type: "separator" },
    { label: messages.quitApplication, click: () => { this.options.quit() } }
]));
```

A Harness plugin runs in the shell's Node-mode Host child process, which has no Electron API. Messages the Host sends to the shell are strictly validated against an `isDesktopHostEvent` allowlist, and an unknown type makes the shell kill the Host with `sent an invalid IPC event`. So changing the shell's own code is the only way to add a tray item.

## How the patch works

On activation it patches `lib/main.js`, inserting this block in front of the quit item:

```js
// dsh-tray-restart: restart entry in the Windows tray menu
...(() => {
    try {
        const home = typeof process.env.DSH_HOME === "string" && process.env.DSH_HOME.trim() !== ""
            ? process.env.DSH_HOME.trim()
            : join(homedir(), ".dsh");
        if (!existsSync(join(home, "desktop-tray-restart.enabled"))) return [];
    } catch {
        return [];
    }
    return [{
        label: `${messages.restartApplication} ${messages.aboutProduct}`,
        click: () => {
            app.relaunch();
            quitWithoutConfirmation();
        }
    }];
})(),
```

The label comes from the shell's own locale table so it stays parallel with its neighbours:

| Locale | Menu |
| --- | --- |
| Chinese | 打开 DeepSeek Harness / **重启 DeepSeek Harness** / ─── / 退出 DeepSeek Harness |
| English | Open DeepSeek Harness / **Restart DeepSeek Harness** / ─── / Quit DeepSeek Harness |

`restartApplication` on its own is a bare "重启" / "Restart", which would look inconsistent next to its neighbours; `aboutProduct` (`DeepSeek Harness`) is guaranteed to exist because `relabel()` already reads it for the tray tooltip.

### How the archive is edited

Only `lib/main.js` changes, and its new bytes are **appended to the end of the archive**; every other file stays byte-for-byte untouched:

- Before patching, the original header is backed up (`app.asar.dsh-tray-restart.header`) along with a manifest (`.dsh-tray-restart.json` recording the original size and the SHA-256 of the original `main.js`)
- **The backup is written only on the first patch**: re-patching (to change wording, say) must not overwrite that pristine baseline, or a revert would land on the "already patched" state instead of the factory one
- The body is appended first, then that one entry's `size` / `offset` / `integrity` is rewritten in the header JSON
- The header JSON is padded with spaces to its original length, so `contentBase` does not move and the offsets of the other 16,604 packed entries are untouched
- The ordering guarantees that an interrupted patch leaves a valid archive (the entry still points at the original `main.js`)
- After writing, the archive is read back through a fresh descriptor to prove the app will see exactly the bytes just written

This is safe on the tested build because the `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` fuses are both disabled (the fuse wire in the executable is `101100011`, with positions 4 and 5 set to `0`), and the executable embeds no asar integrity blob to check against.

The common alternative — extracting to `resources/app` and moving `app.asar` aside — was **not** used: it costs ~355 MB and several seconds, requires patching two extra CLI files, and cannot even run while the app is open because Windows refuses to rename the archive the running shell holds (measured: `EBUSY`).

If the installation uses the already-unpacked `resources/app/lib/main.js` layout, the plugin edits the file directly and backs it up as `main.js.dsh-tray-restart.main.js`. Whenever the archive exists, it always wins.

### Locating the installation

`resolveInstall()` tries, in order: explicit config → the directory of `DSH_DESKTOP_NODE_EXECUTABLE` → the directory of `process.execPath` → `process.cwd()` → `DSH_DESKTOP_INSTALL_DIR`, walking up to five ancestors from each candidate looking for `resources/app.asar` (or `resources/app/lib/main.js`).

You can pin it in the plugin config instead of relying on discovery:

```yaml
- id: dsh-tray-restart
  config:
    installRoot: <install root>
```

From the command line, use `--install <install root>` or the `DSH_DESKTOP_INSTALL_DIR` environment variable. When nothing is found it reports: `no DSH Desktop installation found (...); pass --install <dir> or set DSH_DESKTOP_INSTALL_DIR`.

## Enable marker

The patch is permanent; whether the item shows is controlled by an **enable marker file**:

- `%DSH_HOME%\desktop-tray-restart.enabled` (usually `C:\Users\<you>\.dsh\desktop-tray-restart.enabled`)
- File exists → the tray shows "Restart"; file missing → the menu is exactly as before (open / ─── / quit)

Enabling the plugin = install the patch + write the marker; disabling it = remove the marker only (the 182 MB archive is not touched again).

### Why the patch is not undone on disable

The shell reads `main.js` **only at startup**. A patch installed by a plugin during a running session therefore only becomes visible on the **next launch** — and that launch restarts the Host and disposes this plugin. Reverting on dispose would erase the patch exactly when it is about to matter.

So the patch is permanent and the marker decides whether the item shows. The trade-off: after disabling the plugin the archive still carries the patch (inert, showing nothing); run `revert` to restore it completely.

## Compatibility

| Item | Requirement / measured |
| --- | --- |
| Platform | Windows 10 / 11 (the tray exists only in the desktop app) |
| Carrier | DSH Desktop (Electron shell); Web and CLI are not applicable |
| Shell version | Measured on `@deepseek-ai/dsh-desktop` `0.2.1-rc.3` |
| Archive layout | `resources/app.asar` (packed) or `resources/app/lib/main.js` (unpacked) |
| Electron fuses | `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` must be off |
| Node | ≥ 22 (the plugin and its tools are ESM) |

If a shell upgrade changes the tray template, the patch gives up with `tray menu template not found in this build` and `status` reports `supported: no`; the plugin does not crash, it simply adds no menu item.

## Known limitations

- **Windows desktop only.** The macOS tray and the DSH Web UI are unaffected and get no such entry.
- **Requires the fuses to be off.** If a shell build enables asar integrity validation, editing the archive in place would make the shell fail to start; that case needs the "unpack to `resources/app`" route, which this plugin does not do.
- **Modifies files inside the installation.** The patch writes `app.asar` (or `resources/app/lib/main.js`) and leaves backup files beside it; write permission on that directory is required. A desktop upgrade overwrites it.
- **Manual `apply` does not write the enable marker**, so the new item does not appear until you create the marker too (see [Option 2](#option-2-patch-only-without-the-plugin)).
- **Disabling the plugin does not remove the patch from the archive**, only the marker; use `revert` for a full restore.
- **`revert` depends on the backup taken at first patch.** Once those files are gone (or the installation was replaced), rollback is impossible and `revert` returns `no saved header for this installation`.

## Uninstall and rollback

Remove the plugin from the profile: delete `"@local/dsh-tray-restart"` from `dsh.profile.bundles` and the matching line from `dependencies`, run `pnpm install`, then restart the desktop app. The patch stays in the archive but the marker is gone, so the tray menu is back to normal.

To restore the installation itself to factory state:

```powershell
node tools/tray-restart.mjs revert --install "<install root>"
```

It writes the original header back, truncates the archive to its original size, and removes the marker and the backups. Verified on a copy: after rollback the archive is **byte-for-byte identical** to the original `app.asar` (SHA-256 equal).

### Manual check

```powershell
node tools/tray-restart.mjs status --install "<install root>"
```

Example output (paths vary by machine):

```
installation: <install root>
shell:        <install root>\resources\app.asar
layout:       app.asar
supported:    yes
patched:      yes
enabled:      yes (marker: C:\Users\<you>\.dsh\desktop-tray-restart.enabled)
```

- `patched`: whether the archive carries the patch
- `enabled`: whether the marker exists (this decides whether the item shows)
- `supported`: whether this build has a tray template to insert into
- `layout` / `shell`: whether the archive or the unpacked directory is edited, and which file

## Development

Clone the repository and enter it first:

```powershell
git clone https://github.com/lyy-hast/dsh-tray-restart.git
cd dsh-tray-restart
```

```powershell
node test/patch.test.mjs        # npm test — pure-function unit tests, no installation touched
node test/e2e.mjs               # npm run test:e2e — revert round trip on a real installation (rewrites the archive)
node tools/tray-restart.mjs status --install "<install root>"
```

`patch.test.mjs` targets `patchSource` / `unpatchSource` only and covers insertion, idempotence, legacy-wording upgrade, revert, and "template moved"; it needs neither DSH Desktop nor the archive.

`e2e.mjs` runs a full `apply → idempotent → revert` on a real installation and asserts the archive is **byte-identical** after rollback (equal length and SHA-256), restoring the installation to its starting state. It needs a desktop install directory, which you supply with `DSH_DESKTOP_INSTALL_DIR`; without it the script tries `E:\dsh` and exits with `skipped: no installation at ...` when that directory does not exist.

`npm test` runs `node test/patch.test.mjs` rather than `node --test test/`: the latter spawns a child process per test file, which fails with `spawn EPERM` under a restricted sandbox, while direct execution keeps everything in one process.

### Two Electron-specific traps

The Host is Electron in `ELECTRON_RUN_AS_NODE` mode, not plain Node, which caused two issues when writing files:

**1. `node:fs` is intercepted by the asar layer.** Electron treats any path containing `.asar` as a path *inside* an archive, so `openSync("<install root>\\resources\\app.asar")` fails with `ENOENT,  not found in <install root>\resources\app.asar` — it is looking for an empty filename inside the archive. The same applies to the backup `app.asar.dsh-tray-restart.header`. Every file operation is therefore wrapped in `withRawFs()`, which sets `process.noAsar = true` and restores it afterwards.

**2. `process.execPath` is the shell executable, but it may point elsewhere.** The shell passes `DSH_DESKTOP_NODE_EXECUTABLE` to the Host through `desktopNodeEnvironment()`, and that is the reliable location of the shell executable; `resolveInstall()` tries explicit config → `DSH_DESKTOP_NODE_EXECUTABLE` → `process.execPath` → `process.cwd()` → `DSH_DESKTOP_INSTALL_DIR`. The last variable is for running the tools **outside** the desktop app, where no shell environment is available.

## Verification

Run against a real installation (shell `@deepseek-ai/dsh-desktop` `0.2.1-rc.3`, Windows):

- Running the plugin's `apply()` under the real shell's Electron Node mode → the archive is rewritten and `status` becomes `patched: yes`
- Disabling then re-enabling the plugin (`plugin_manager`) → the Host re-applies the patch on its own, no manual step
- Extracting `lib/main.js` from the archive and handing it to Node's ESM parser → **parses cleanly**, so the patch cannot break shell startup
- Evaluating the real tray template under both locales → Chinese `打开 DeepSeek Harness / 重启 DeepSeek Harness / ─── / 退出 DeepSeek Harness`, English `Open DeepSeek Harness / Restart DeepSeek Harness / ─── / Quit DeepSeek Harness`; clicking "Restart" triggers `app.relaunch()` + `quitWithoutConfirmation()`; with no marker → `打开 DeepSeek Harness / ─── / 退出 DeepSeek Harness` (identical to stock)
- Wording upgrade path: an archive carrying the old bare "重启" label is relabelled in place, and the result is **byte-identical** to a fresh insertion
- Archive geometry check: all 16,605 packed entries fall inside EOF and the header JSON length matches its declaration (21,261 files / 16,605 packed / 1,583 unpacked)
- After `revert` the archive returns to 182,434,783 B and is **byte-for-byte identical** to the original `app.asar` (SHA-256 equal; original `main.js` hash `f05dd366…e3ba93`, patched archive 182,952,038 B with a 517,255 B `main.js`)

## Layout

| File | Purpose |
| --- | --- |
| `index.js` | Host-side plugin: patches + writes the marker on activation, removes the marker on dispose |
| `asar-patch.js` | The asar surgery engine: locate the install, patch, revert, report status |
| `cordis.patch.yml` | Bundle patch row, `id: dsh-tray-restart` |
| `tools/tray-restart.mjs` | Command line: `status` / `apply` / `revert` |
| `test/patch.test.mjs` | Pure-function unit tests, no installation touched |
| `test/e2e.mjs` | Revert round-trip verification on a real installation |
| `locale/*.json` | Title and description shown in the plugin manager |
| `icon.svg` | Icon shown in the plugin manager |
| `LICENSE` | Full MIT license text |

## License

[MIT](LICENSE) © 2026 lyy ([lyy-hast](https://github.com/lyy-hast))

In short: use, modify, redistribute and sell it freely, and embed it in your own projects; the only requirement is to keep the copyright notice and the license text, and the author provides no warranty. The plugin rewrites `app.asar` inside your DSH Desktop installation — that happens **on your machine, with your authorization**, so make sure it is acceptable in your environment.

---

Repository: [github.com/lyy-hast/dsh-tray-restart](https://github.com/lyy-hast/dsh-tray-restart) · Issues: [Issues](https://github.com/lyy-hast/dsh-tray-restart/issues) · History: [Commits](https://github.com/lyy-hast/dsh-tray-restart/commits/master) · Chinese docs: [README.md](README.md)
