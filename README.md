<div align="center">

<img src="https://raw.githubusercontent.com/lyy-hast/dsh-tray-restart/master/icon.svg" width="76" height="76" alt="dsh-tray-restart">

# 托盘重启 · dsh-tray-restart

**给 DSH 桌面端的系统托盘菜单加一项「重启 DeepSeek Harness」。**

简体中文 | [English](README.en.md)

[![GitHub stars](https://img.shields.io/github/stars/lyy-hast/dsh-tray-restart?style=flat-square&logo=github&label=stars)](https://github.com/lyy-hast/dsh-tray-restart/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/lyy-hast/dsh-tray-restart?style=flat-square)](https://github.com/lyy-hast/dsh-tray-restart/issues)
[![Last commit](https://img.shields.io/github/last-commit/lyy-hast/dsh-tray-restart?style=flat-square)](https://github.com/lyy-hast/dsh-tray-restart/commits/master)
[![License](https://img.shields.io/github/license/lyy-hast/dsh-tray-restart?style=flat-square)](LICENSE)
[![DSH Desktop only](https://img.shields.io/badge/DSH-Desktop%20only-6366f1?style=flat-square)](#兼容性)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D4?style=flat-square)](#兼容性)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-339933?style=flat-square)](https://github.com/lyy-hast/dsh-tray-restart/blob/master/package.json)
[![Tested on](https://img.shields.io/badge/tested%20on-0.2.1--rc.3-1F883D?style=flat-square)](#验证记录)

</div>

[效果预览](#效果预览) · [安装](#安装) · [生效时机](#生效时机) · [为什么必须改桌面端](#为什么必须改桌面端) · [它是怎么改的](#它是怎么改的) · [启用标记](#启用标记) · [兼容性](#兼容性) · [已知限制](#已知限制) · [卸载与回滚](#卸载与回滚) · [开发](#开发) · [验证记录](#验证记录) · [结构](#结构) · [许可证](#许可证)

DSH 桌面端（Windows）的托盘右键菜单只有「打开应用 / ─── / 退出应用」三项。想换个插件配置、重载 Host、让新装的插件生效，都得退出再手动打开一次——托盘里的「退出应用」只退出，不回来。

这个插件在托盘里补一项「重启 DeepSeek Harness」：点一下，应用连同 Host 一起重启，回到你刚才的状态。它**不改插件 API**，而是给已安装的 Electron 外壳打一个可完整回滚的补丁。

- **一键重启**：托盘右键 → 重启，走外壳自己崩溃恢复用的 `app.relaunch()` + 无确认退出，不会弹「任务仍在运行」的确认框。
- **文案与相邻项一致**：`重启 DeepSeek Harness` / `Restart DeepSeek Harness`，由外壳自己的 locale 表拼出，不写死语言。
- **可逆**：补丁只动 `lib/main.js` 一个条目，`revert` 后归档与原始 `app.asar` **SHA-256 完全一致**。
- **可随时关掉**：禁用插件只删一个标记文件，菜单立刻回到原样，不用再碰 182 MB 的归档。

> 仅 Windows 桌面端。DSH Web、CLI 没有系统托盘，这个插件对它们没有任何作用。

## 效果预览

托盘右键菜单，打补丁前：

```
打开 DeepSeek Harness
──────────────────────
退出 DeepSeek Harness
```

打补丁后（英文界面同理，换成 `Open DeepSeek Harness / Restart DeepSeek Harness / ─── / Quit DeepSeek Harness`）：

```
打开 DeepSeek Harness
重启 DeepSeek Harness      ← 新增
──────────────────────
退出 DeepSeek Harness
```

点击「重启」的效果等于：外壳调用 `app.relaunch()`，然后 `quitWithoutConfirmation()` 退出，新进程重新拉起 Host。这正是外壳自己在开发菜单和崩溃恢复对话框里用的那套语义，即「重启应用与 Host」。

## 安装

两条路，按需要选一条。

### 方式一：装成插件（推荐）

插件会在每次启动时自动检查并维护补丁，桌面端升级把 `app.asar` 换掉之后也会自动重新打上。

1. 把仓库克隆到本地，记住克隆后的目录（下称 `<插件目录>`）：

   ```powershell
   git clone https://github.com/lyy-hast/dsh-tray-restart.git D:\plugins\dsh-tray-restart
   ```

2. 打开桌面端 profile 的 `package.json`：`%DSH_HOME%\profiles\desktop\package.json`（通常是 `C:\Users\<你>\.dsh\profiles\desktop\package.json`）。
3. 在 `dependencies` 里加一行，指向 `<插件目录>`（JSON 里用正斜杠）：

   ```json
   "@local/dsh-tray-restart": "link:D:/plugins/dsh-tray-restart"
   ```

4. 在 `dsh.profile.bundles` 数组里加上包名：

   ```json
   "@local/dsh-tray-restart"
   ```

5. 在 `%DSH_HOME%\profiles\desktop` 目录跑一次安装，用 DSH 自带的 pnpm：

   ```powershell
   cd "$env:USERPROFILE\.dsh\profiles\desktop"
   node "<安装目录>\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs" install
   ```

   `<安装目录>` 指 DSH 桌面端的安装根目录，即含 `resources\app.asar` 的那一层（`<安装目录>\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs`）。

6. 完全退出 DSH 桌面端，再重新打开。

> **不要**用 `dsh plugin --profile desktop add ...`。`desktop` profile 由 Electron 应用独占管理，CLI 会以 `profile "desktop" is managed exclusively by the Electron application` 直接拒绝。

装好之后，插件在激活时做两件事：给外壳打补丁（若尚未打过），并写下启用标记文件。日志里能看到 `added the Restart entry to the desktop tray menu (inserted the restart entry); it appears the next time DSH Desktop starts`。

> 想更新到仓库最新版本，在 `<插件目录>` 里 `git pull` 后重启桌面端即可；因为依赖用的是 `link:`，不需要重新 `pnpm install`。

### 方式二：不装插件，只打补丁

只想手动改一次、不想让它常驻 profile：

```powershell
git clone https://github.com/lyy-hast/dsh-tray-restart.git
cd dsh-tray-restart
node tools/tray-restart.mjs apply --install "<安装目录>"
```

> ⚠️ `apply` **只打补丁，不写启用标记**。补丁装上了但标记不存在时，菜单里不会出现「重启」。要让它出现，还得手动创建标记文件：
>
> ```powershell
> '{"enabledAt":"manual","by":"dsh-tray-restart"}' | Out-File -Encoding utf8 "$env:USERPROFILE\.dsh\desktop-tray-restart.enabled"
> ```
>
> 内容是什么都无所谓，外壳只判断文件在不在。要关掉就删掉这个文件，要彻底还原就再跑 `revert`。

补丁是常驻的，桌面端下次启动才读新代码；见[生效时机](#生效时机)。

## 生效时机

补丁写入是立即的，但外壳**只在启动时**读一次 `lib/main.js`：

1. 启用插件（或手动 `apply` + 写标记）
2. 退出 DSH 桌面端（托盘 → 退出应用），或从任务管理器结束
3. 重新打开 → 托盘右键里就有「重启」了

桌面端升级会整个替换 `app.asar`，补丁随之消失；下次启动插件会自动重新打上（备份基线也会重建）。

## 为什么必须改桌面端

托盘菜单由 Electron 外壳里 `lib/main.js` 的 `DesktopTray.relabel()` 构造，模板是写死的三项：

```js
tray.setContextMenu(Menu.buildFromTemplate([
    { label: messages.openApplication, click: () => { this.options.open() } },
    { type: "separator" },
    { label: messages.quitApplication, click: () => { this.options.quit() } }
]));
```

Harness 插件跑在外壳的 Node 宿主子进程里，没有 Electron API；宿主向外壳发的消息又受 `isDesktopHostEvent` 白名单严格校验，未知类型会让外壳以 `sent an invalid IPC event` 杀掉宿主。所以除了改外壳自己的代码，没有别的办法往托盘里加菜单项。

## 它是怎么改的

激活时把 `lib/main.js` 打上补丁，插在「退出应用」之前：

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

文案由外壳自己的 locale 表拼出，和左右两项保持同一格式：

| 语言 | 菜单 |
| --- | --- |
| 中文 | 打开 DeepSeek Harness / **重启 DeepSeek Harness** / ─── / 退出 DeepSeek Harness |
| 英文 | Open DeepSeek Harness / **Restart DeepSeek Harness** / ─── / Quit DeepSeek Harness |

`restartApplication` 单独用只有「重启」/「Restart」，少了产品名，和相邻两项不一致；`aboutProduct`（`DeepSeek Harness`）本来就被 `relabel()` 用于托盘 tooltip，一定存在。

### 归档是怎么改的

只改 `lib/main.js` 一个文件，把新版**追加到归档末尾**，其它文件一个字节都不动：

- 补丁前先备份原始头部（`app.asar.dsh-tray-restart.header`）和一份清单（`.dsh-tray-restart.json`，记录原始大小、原始 `main.js` 的 SHA-256）
- **只在首次打补丁时备份**：重复打补丁（比如改文案）不会覆盖这份原始基线，否则回滚会回到「已打补丁」的状态而不是出厂状态
- 先追加正文，再改头部 JSON 里那一条 entry 的 `size` / `offset` / `integrity`
- 头部 JSON 用空格补齐到原长度，`contentBase` 不变，所以其余 16604 个 packed 条目的偏移全部不动
- 顺序保证了中途失败时归档仍然有效（entry 还指向原来的 `main.js`）
- 写完用新的文件描述符回读校验：确认应用读到的正是刚写入的字节

能这么做，是因为实测构建里 `EnableEmbeddedAsarIntegrityValidation` 和 `OnlyLoadAppFromAsar` 两个 fuse 都是关闭的（exe 里 fuse wire 为 `101100011`，第 4、5 位为 `0`），exe 里也没有可校验的 asar 完整性摘要。

**没有**采用「解包到 `resources/app` + 移走 `app.asar`」的常见做法：那要 355 MB 和数秒，还要额外给两个 CLI 文件打补丁；而且运行期间 Windows 拒绝重命名外壳正持有的归档（实测 `EBUSY`）。

若安装是已解包的 `resources/app/lib/main.js` 布局，插件改走文件直改，备份为 `main.js.dsh-tray-restart.main.js`；归档存在时始终优先改归档。

### 定位安装目录

`resolveInstall()` 依次尝试：显式配置 → `DSH_DESKTOP_NODE_EXECUTABLE` 的目录 → `process.execPath` 的目录 → `process.cwd()` → `DSH_DESKTOP_INSTALL_DIR`，每个候选都向上回溯最多五层找 `resources/app.asar`（或 `resources/app/lib/main.js`）。

插件配置里可以显式指定，免得靠猜：

```yaml
- id: dsh-tray-restart
  config:
    installRoot: <安装目录>
```

手动命令行则用 `--install <安装目录>` 或环境变量 `DSH_DESKTOP_INSTALL_DIR`。都找不到时报：`no DSH Desktop installation found (...); pass --install <dir> or set DSH_DESKTOP_INSTALL_DIR`。

## 启用标记

补丁是常驻的，由**启用标记文件**控制显示：

- `%DSH_HOME%\desktop-tray-restart.enabled`（通常是 `C:\Users\<你>\.dsh\desktop-tray-restart.enabled`）
- 文件存在 → 托盘显示「重启」；文件不存在 → 菜单和原来完全一样（打开 / ─── / 退出）

启用插件 = 装补丁 + 写标记；禁用插件 = 只删标记（不动 182 MB 归档）。

### 为什么补丁不随插件禁用而撤掉

外壳只在**启动时**读一次 `main.js`。插件在运行中的会话里装上补丁，要到**下一次启动**才看得见；而那次启动会重启宿主、销毁本插件。如果销毁时回滚，就正好在补丁要生效的那一刻把它抹掉。

所以补丁常驻、显示由标记决定。代价是：禁用插件后归档仍带补丁（惰性，不显示菜单项），想彻底还原要跑 `revert`。

## 兼容性

| 项目 | 要求 / 实测 |
| --- | --- |
| 平台 | Windows 10 / 11（系统托盘只在桌面端存在） |
| 载体 | DSH 桌面端（Electron 外壳），Web 与 CLI 不适用 |
| 外壳版本 | 实测 `@deepseek-ai/dsh-desktop` `0.2.1-rc.3` |
| 归档布局 | `resources/app.asar`（packed）或 `resources/app/lib/main.js`（unpacked） |
| Electron fuse | `EnableEmbeddedAsarIntegrityValidation`、`OnlyLoadAppFromAsar` 需关闭 |
| Node | ≥ 22（插件与工具脚本都按 ESM 写） |

外壳升级后托盘模板若变了，补丁会以 `tray menu template not found in this build` 放弃，`status` 报 `supported: no`；插件本身不会因此崩掉，只是没有新增菜单项。

## 已知限制

- **只对 Windows 桌面端有效**。macOS 的托盘菜单、DSH Web 的界面都不受影响，也不会有这个入口。
- **依赖 fuse 关闭**。若某个外壳构建打开了 asar 完整性校验，原地改归档会导致外壳启动失败——这时只能用「解包成 `resources/app`」的路线，本插件不做这件事。
- **会改动安装目录里的文件**。补丁写入 `app.asar`（或 `resources/app/lib/main.js`），并在旁边留下备份文件；需要对该目录有写权限。升级桌面端会覆盖它。
- **手动 `apply` 不写启用标记**，菜单里不会出现新项；必须同时创建标记文件（见[方式二](#方式二不装插件只打补丁)）。
- **禁用插件不会移除归档里的补丁**，只移除标记；彻底还原需 `revert`。
- **`revert` 依赖首次打补丁时留下的备份**。备份被删（或换了新安装）后无法回滚，`revert` 会返回 `no saved header for this installation`。

## 卸载与回滚

从 profile 移除插件：删掉 `dsh.profile.bundles` 里的 `"@local/dsh-tray-restart"` 和 `dependencies` 里的那一行，再 `pnpm install`，然后重启桌面端。此时补丁还在归档里但已无标记，托盘菜单恢复原样。

想把安装目录也还原到出厂状态：

```powershell
node tools/tray-restart.mjs revert --install "<安装目录>"
```

它按备份把原始头部写回、把归档截断回原大小、删掉标记与备份文件。已在副本上验证：回滚后与原始 `app.asar` **SHA-256 完全一致**。

### 手动检查

```powershell
node tools/tray-restart.mjs status --install "<安装目录>"
```

输出示例（路径随你的机器不同）：

```
installation: <安装目录>
shell:        <安装目录>\resources\app.asar
layout:       app.asar
supported:    yes
patched:      yes
enabled:      yes (marker: C:\Users\<你>\.dsh\desktop-tray-restart.enabled)
```

- `patched`：归档是否带补丁
- `enabled`：标记文件是否存在（决定菜单里是否显示）
- `supported`：这个构建里有没有可插入的托盘模板
- `layout` / `shell`：改的是归档还是已解包目录，以及具体文件

## 开发

先克隆仓库并进入目录：

```powershell
git clone https://github.com/lyy-hast/dsh-tray-restart.git
cd dsh-tray-restart
```

```powershell
node test/patch.test.mjs        # npm test —— 纯函数单测，不碰任何安装
node test/e2e.mjs               # npm run test:e2e —— 真实安装上的回滚往返（会改写归档）
node tools/tray-restart.mjs status --install "<安装目录>"
```

`patch.test.mjs` 只针对 `patchSource` / `unpatchSource`，覆盖插入、幂等、旧文案升级、回滚和「模板搬家」五种情况；不需要 DSH 桌面端，也不需要归档。

`e2e.mjs` 在真实安装上跑一整套 `apply → 幂等 → revert`，断言归档回滚后**字节完全一致**（长度与 SHA-256 相等），跑完把安装恢复成开始时的状态。它需要桌面端安装目录，可用 `DSH_DESKTOP_INSTALL_DIR` 指定；没设时会试 `E:\dsh`，该目录不存在则直接跳过（`skipped: no installation at ...`）。

`npm test` 用的是 `node test/patch.test.mjs` 而不是 `node --test test/`：后者会为每个测试文件 spawn 子进程，在受限沙箱下会报 `spawn EPERM`；直接执行则全在一个进程里跑完。

### 两个 Electron 特有的坑

宿主是 `ELECTRON_RUN_AS_NODE` 模式下的 Electron，不是普通 Node，写文件时踩到两点：

**1. `node:fs` 被 asar 层接管。** Electron 会把任何路径里含 `.asar` 的访问当作「归档内部路径」，于是 `openSync("<安装目录>\\resources\\app.asar")` 报 `ENOENT,  not found in <安装目录>\resources\app.asar`——它去找的是归档里的一个空文件名。备份文件 `app.asar.dsh-tray-restart.header` 同理。所有文件操作因此包在 `withRawFs()` 里，用 `process.noAsar = true` 绕过，事后还原。

**2. `process.execPath` 是外壳 exe，但可能指向别处。** 外壳用 `desktopNodeEnvironment()` 把 `DSH_DESKTOP_NODE_EXECUTABLE` 传给宿主，那才是外壳 exe 的真实位置；`resolveInstall()` 依次尝试 显式配置 → `DSH_DESKTOP_NODE_EXECUTABLE` → `process.execPath` → `process.cwd()` → `DSH_DESKTOP_INSTALL_DIR`。最后那个环境变量是给**脱离桌面端**直接跑命令行的场合用的（此时没有外壳环境可读）。

## 验证记录

在一台真实安装（外壳 `@deepseek-ai/dsh-desktop` `0.2.1-rc.3`，Windows）上跑过：

- 用真实外壳的 Electron Node 模式执行插件的 `apply()` → 归档被改写，`status` 变成 `patched: yes`
- 禁用再启用插件（`plugin_manager`）→ 宿主自己重新打上补丁，无需手工干预
- 从归档里取出 `lib/main.js` 交给 Node 的 ESM 解析器 → **解析通过**，外壳不会因补丁启动失败
- 求值真实托盘模板（中英两套 locale）→ 中文 `打开 DeepSeek Harness / 重启 DeepSeek Harness / ─── / 退出 DeepSeek Harness`，英文 `Open DeepSeek Harness / Restart DeepSeek Harness / ─── / Quit DeepSeek Harness`；点击「重启」触发 `app.relaunch()` + `quitWithoutConfirmation()`；无标记 → `打开 DeepSeek Harness / ─── / 退出 DeepSeek Harness`（与原版一致）
- 文案升级路径：带旧「重启」文案的归档会被就地改成带产品名，且改完与全新插入**逐字节一致**
- 归档几何检查：16605 个 packed 条目全部落在 EOF 之内，头部 JSON 长度与声明一致（21261 个文件 / 16605 packed / 1583 unpacked）
- `revert` 后归档回到 182434783 B，且与原始 `app.asar` **SHA-256 完全一致**（原始 `main.js` 哈希 `f05dd366…e3ba93`，补丁后归档 182952038 B、`main.js` 517255 B）

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | 宿主侧插件：激活时打补丁 + 写标记，销毁时删标记 |
| `asar-patch.js` | asar 手术引擎：定位安装、打补丁、回滚、状态查询 |
| `cordis.patch.yml` | bundle 补丁行，`id: dsh-tray-restart` |
| `tools/tray-restart.mjs` | 命令行：`status` / `apply` / `revert` |
| `test/patch.test.mjs` | 纯函数单测，不碰安装 |
| `test/e2e.mjs` | 真实安装上的回滚往返验证 |
| `locale/*.json` | 插件管理器里的标题与描述 |
| `icon.svg` | 插件管理器里的图标 |
| `LICENSE` | MIT 许可证全文 |

## 许可证

[MIT](LICENSE) © 2026 lyy（[lyy-hast](https://github.com/lyy-hast)）

简单说：可以自由使用、修改、分发、商用，也可以放进自己的项目里；唯一的要求是保留版权声明与许可证全文，且作者不为此提供任何担保。插件会改写 DSH 桌面端安装目录里的 `app.asar`——这个动作**在你的机器上、由你授权**，请自行确认符合你所在环境的使用规定。

---

仓库：[github.com/lyy-hast/dsh-tray-restart](https://github.com/lyy-hast/dsh-tray-restart) · 问题反馈：[Issues](https://github.com/lyy-hast/dsh-tray-restart/issues) · 更新记录：[Commits](https://github.com/lyy-hast/dsh-tray-restart/commits/master) · 英文文档：[README.en.md](README.en.md)
