# 托盘重启（@local/dsh-tray-restart）

给 DSH 桌面端的系统托盘右键菜单增加一项「重启」。

## 为什么需要改桌面端文件

托盘菜单由 Electron 外壳的 `resources/app.asar` 里 `lib/main.js` 的 `DesktopTray.relabel()`
构造，模板是写死的三项：

```js
tray.setContextMenu(Menu.buildFromTemplate([
    { label: messages.openApplication,  click: () => { this.options.open() } },
    { type: "separator" },
    { label: messages.quitApplication,  click: () => { this.options.quit() } }
]));
```

Harness 插件跑在外壳的 Node 宿主子进程里，没有 Electron API；宿主向外壳发的消息受
`isDesktopHostEvent` 白名单严格校验，未知类型会让外壳以 "sent an invalid IPC event" 杀掉宿主。
所以除了改外壳自己的代码，没有别的办法往托盘里加菜单项。

## 它做了什么

激活时把 `lib/main.js` 打上补丁，插在 `退出应用` 之前：

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

`restartApplication` 单独用只有「重启」/「Restart」，少了产品名，和相邻两项不一致；
`aboutProduct`（`DeepSeek Harness`）本来就被 `relabel()` 用于托盘 tooltip，一定存在。

菜单因此变成「打开应用 / 重启 / ─── / 退出应用」。点击「重启」走的正是外壳自己
开发菜单和崩溃恢复用的那套 `app.relaunch()` + `quitWithoutConfirmation()`，即
`重启应用与 Host`，不会弹「任务仍在运行」的确认框。

## 为什么补丁不随插件禁用而撤掉

外壳只在**启动时**读一次 `main.js`。插件在运行中的会话里装上补丁，要到**下一次启动**
才看得见；而那次启动会重启宿主、销毁本插件。如果销毁时回滚，就正好在补丁要生效的那一刻把它抹掉。

所以补丁是常驻的，由**启用标记文件**控制显示：

- `%DSH_HOME%\desktop-tray-restart.enabled`（通常是 `C:\Users\<你>\.dsh\desktop-tray-restart.enabled`）
- 文件存在 → 托盘显示「重启」；文件不存在 → 菜单和原来完全一样（打开 / ─── / 退出）

启用插件 = 装补丁 + 写标记；禁用插件 = 只删标记（不动 182 MB 归档）。

## 归档是怎么改的

只改 `lib/main.js` 一个文件，把新版**追加到归档末尾**，其它文件一个字节都不动：

- 补丁前先备份原始头部（`app.asar.dsh-tray-restart.header`）和一份清单
- **只在首次打补丁时备份**：重复打补丁（比如改文案）不会覆盖这份原始基线，否则回滚会回到
  「已打补丁」的状态而不是出厂状态
- 先追加正文，再改头部 JSON 里那一条 entry 的 `size` / `offset` / `integrity`
- 头部 JSON 用空格补齐到原长度，`contentBase` 不变，所以其余 16604 个文件的偏移全部不动
- 顺序保证了中途失败时归档仍然有效（entry 还指向原来的 `main.js`）

能这么做是因为这台机器上 `EnableEmbeddedAsarIntegrityValidation` 和
`OnlyLoadAppFromAsar` 两个 fuse 都是关闭的（exe 里 fuse wire 为 `101100011`，
第 4、5 位为 `0`），exe 里也没有可校验的 asar 完整性摘要。

**没有**采用「解包到 `resources/app` + 移走 `app.asar`」的常见做法：那要 355 MB 和数秒，
还要额外给两个 CLI 文件打补丁；而且运行期间 Windows 拒绝重命名外壳正持有的归档
（实测 `EBUSY`）。

## 生效时机

补丁写入是立即的，但外壳要重启才读新代码：

1. 启用插件
2. 退出 DSH 桌面端（托盘 → 退出应用），或直接从任务管理器结束
3. 重新打开 → 托盘右键就有「重启」了

## 两个 Electron 特有的坑

宿主是 `ELECTRON_RUN_AS_NODE` 模式下的 Electron，不是普通 Node，写文件时踩到两点：

**1. `node:fs` 被 asar 层接管。** Electron 会把任何路径里含 `.asar` 的访问当作「归档内部路径」，
于是 `openSync("E:\\dsh\\resources\\app.asar")` 报 `ENOENT,  not found in E:\dsh\resources\app.asar`
——它去找的是归档里的一个空文件名。备份文件 `app.asar.dsh-tray-restart.header` 同理。
所有文件操作因此包在 `withRawFs()` 里，用 `process.noAsar = true` 绕过，事后还原。

**2. `process.execPath` 是外壳 exe，但可能指向别处。** 外壳用
`desktopNodeEnvironment()` 把 `DSH_DESKTOP_NODE_EXECUTABLE` 传给宿主，那才是外壳 exe 的真实位置；
`resolveInstall()` 依次尝试 显式配置 → `DSH_DESKTOP_NODE_EXECUTABLE` → `process.execPath`
→ `process.cwd()` → `DSH_DESKTOP_INSTALL_DIR`，每个候选都向上回溯最多五层找 `resources/app.asar`。
最后那个环境变量是给**脱离桌面端**直接跑命令行的场合用的（此时没有外壳环境可读）。

## 开发

```bash
node test/patch.test.mjs        # npm test —— 纯函数单测，不碰任何安装
node test/e2e.mjs               # npm run test:e2e —— 真实安装上的回滚往返（会改写归档）
node tools/tray-restart.mjs status --install E:\dsh
```

`patch.test.mjs` 只针对 `patchSource` / `unpatchSource`，覆盖插入、幂等、旧文案升级、回滚和
「模板搬家」五种情况；不需要 DSH 桌面端，也不需要归档。

`e2e.mjs` 在真实安装上跑一整套 `apply → 幂等 → revert`，断言归档回滚后**字节完全一致**
（SHA-256 相等），跑完把安装恢复成开始时的状态。它需要桌面端安装目录，默认 `E:\dsh`，
可用 `DSH_DESKTOP_INSTALL_DIR` 覆盖。

`npm test` 用的是 `node test/patch.test.mjs` 而不是 `node --test test/`：后者会为每个测试文件
spawn 子进程，在受限沙箱下会报 `spawn EPERM`；直接执行则全在一个进程里跑完。

## 验证记录

在真实安装（`E:\dsh`）上跑过：

- 用真实外壳的 Electron Node 模式执行插件的 `apply()` → 归档被改写，`status` 变成 `patched: yes`
- 禁用再启用插件（`plugin_manager`）→ 宿主自己重新打上补丁，无需手工干预
- 从归档里取出 `lib/main.js` 交给 Node 的 ESM 解析器 → **解析通过**，外壳不会因补丁启动失败
- 求值真实托盘模板（中英两套 locale）→ 中文 `打开 / 重启 DeepSeek Harness / ─── / 退出`，
  英文 `Open / Restart DeepSeek Harness / ─── / Quit`；点击「重启」触发 `app.relaunch()` + `quitWithoutConfirmation()`；
  无标记 → `打开 / ─── / 退出`（与原版一致）
- 文案升级路径：带旧「重启」文案的归档会被就地改成带产品名，且改完与全新插入**逐字节一致**
- 归档几何检查：16605 个 packed 条目全部落在 EOF 之内，头部 JSON 长度与声明一致
- `revert` 后归档回到 182434783 B，且与原始 `app.asar` **SHA-256 完全一致**

## 卸载

```bash
node tools/tray-restart.mjs revert
```

按备份把原始头部写回并把归档截断回原大小。已在副本上验证：回滚后与原始
`app.asar` **SHA-256 完全一致**。

桌面端升级会整个替换 `app.asar`，补丁随之消失；下次启动插件会自动重新打上。

## 手动检查

```bash
node tools/tray-restart.mjs status
```

输出 `patched`（归档是否带补丁）、`enabled`（标记文件是否存在）、`supported`
（这个构建里有没有可插入的托盘模板）。

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
