# ArtCraft × DeepSeek Harness（DSH）插件：可行性分析与实现路线

> 版本：v1（2026-11-08）
> 目标：先判断「ZCode 里的 ArtCraft 套件是怎么在侧边栏跑起来的」+「在 DSH 里做一个 ArtCraft 插件（左侧导航新增 ArtCraft 入口，点开是套件目录页 / 内嵌编辑器）是否可行、怎么做」。
> 结论先行：**入口 + 套件目录页（截图 2）≈ 1–3 天可落地；内嵌真实 ArtCraft 编辑器（截图 3 的效果）可行，但要自建一层 Host 桥，约 1–2 周/首个应用；Agent 与内嵌 UI 共用同一份活动文档是 2–4 周级工程**。

---

## 0. TL;DR（五条结论）

| # | 问题 | 结论 | 依据 |
|---|---|---|---|
| 1 | ZCode 的 ArtCraft 套件怎么在侧边栏跑？ | **不是「内嵌原生窗口」**。ZCode 插件 = 一个**本地 stdio MCP Server**（`dist/server.mjs`）+ 一份**编译成 WASM/Web 的应用 UI**（`dist/panel.html`）。插件清单用 `ui.surfaces` 把 Web UI 声明成 **MCP Apps UI**（`resourceUri: ui://<app>/panel.html`），ZCode 宿主把它在**插件沙箱 iframe** 里渲染；UI 通过 `postMessage` JSON-RPC 与宿主/引擎通信，资源按 2 MiB 分块 + SHA-256 校验下发。 | 见 §1，`~/.zcode/cli/plugins/cache/zcode-plugins-official/vectorcraft/0.2.4/` |
| 2 | DSH 能加「左侧导航 + 主区页面」吗？ | **原生支持，已有 3 个第三方插件在用**。导航行 = 往根级 list slot `sidebar.panellist` 注册一个图标组件；页面 = 往根级 keyed slot `main` 注册同 `key` 的 React 组件；点击由 `ctx.layout.selectPanel(id)` 选择。**不需要改 DSH 源码。** | 见 §2，`dsh-media-desk`（自媒体工作台）就是模板 |
| 3 | 能内嵌真实 ArtCraft 编辑器 UI 吗？ | **能，但要自己做 Host 桥**。DSH 没有 MCP Apps UI 宿主（`ui://`/`ext-apps` 在 DSH 里 0 命中），所以不能直接复用 ZCode 那套「宿主渲染」。替代路线：插件用 `ctx.webServer` 注册同源 HTTP 路由，把 ZCode 编译好的 `panel.html`+资产服务出去，主区面板里用 **同源 `<iframe>`** 承载，界面里补一个 **MCP Apps host shim**（在父页面回 `ui/initialize`、`resources/read`、`tools/call` 等消息）。`research/runtime/spike/serve.cjs` 已把「打补丁 + 自答协议 + 分块资产」跑通到能监听，浏览器启动验证还没做完。 | 见 §3、§4、附录 B |
| 4 | ArtCraft 应用本身有网页版可 iframe 吗？ | **安装目录里的桌面应用/CLI 没有**（只有 stdio MCP + `run/convert` + `--control` JSON 控制通道）。但 **ZCode 插件里带的就是编译好的 Web 版**（Trunk/WASM，9 个应用都有），这是可复用的关键资产；注意授权/商标与分发合规。 | 见 §1.4、§4.3 |
| 5 | 最小闭环是什么？ | **P0（1–3 天）**：`ArtCraft` 导航行 + 套件目录页（数据来自本地安装清单，可选 ArtCraft 发布 API/GitHub 检查更新），每个应用「打开」= 原生应用外窗（或内嵌页占位）。**P1（1–2 周）**：先做 VectorCraft 一个应用的完整内嵌 UI（资产服务 + host shim + 打开/保存）。之后再横向复制到其它应用。 | 见 §5、§6 |

---

## 1. ZCode 里到底是怎么跑的（机制拆解）

### 1.1 安装形态：每个 ArtCraft 应用 = 一个 ZCode 插件包

实际落盘路径（本机）：

```
C:\Users\86159\.zcode\cli\plugins\cache\zcode-plugins-official\
  vectorcraft\0.2.4\
    .zcode-plugin\plugin.json     ← 插件清单
    commands\open.md              ← /vectorcraft:open 命令
    dist\panel.html               ← 编译后的应用 UI（MCP App，~628 KB）
    dist\server.mjs               ← 打包的本地 MCP Server（~1.37 MB）
    dist\tools.json               ← 工具清单快照（vectorcraft 40+ 个）
    dist\assets.json              ← Web 资产清单（entry/wasm/chunkBytes/sha256）
    dist\assets\*.gz              ← 大资产（WASM/JS，按 sha256 命名，2 MiB 分块读取）
    dist\BUILD.json               ← 上游仓库/commit/补丁/哈希（溯源）
    README.md / README_CN.md
```

本机已安装/缓存的应用插件（`installed_plugins.json` + `cli/config.json`）：
`cadcraft、deckcraft、designcraft、gridcraft、pdfcraft、photocraft、soundcraft、vectorcraft、wordcraft`
（另有 `blender、pdf、documents、presentations、excalidraw…` 等非 ArtCraft 插件）。
**FigCraft / FilmCraft / EffectCraft / SolidCraft 没有 ZCode 插件缓存**，但桌面应用已装在 `F:\ArtCraft\`。

### 1.2 清单长什么样（vectorcraft 0.2.4，原样摘录）

```json
{
  "name": "vectorcraft",
  "version": "0.2.4",
  "commands": "commands",
  "mcpServers": {
    "vectorcraft": {
      "type": "stdio",
      "command": "node",
      "args": ["${ZCODE_PLUGIN_ROOT}/dist/server.mjs"],
      "cwd": "${ZCODE_PROJECT_DIR}",
      "env": { "ZCODE_WORKSPACE_ROOT": "${ZCODE_PROJECT_DIR}" }
    }
  },
  "ui": {
    "surfaces": [
      {
        "id": "editor",
        "title": { "en-US": "VectorCraft", "zh-CN": "VectorCraft" },
        "icon": "pen-tool",
        "server": "vectorcraft",
        "resourceUri": "ui://vectorcraft/panel.html",
        "availability": "session"
      }
    ]
  }
}
```

这说明了三件事：

1. **工具面**：ArtCraft 引擎（Rust）被包装成一个 **stdio MCP Server**，由 ZCode 以子进程方式拉起；工具名就是 CRAFT 的引擎命令（`command_list`/`command_run`/`open_editor`…）。
2. **界面面**：`ui.surfaces` 声明了一块 **MCP Apps UI**（SEP-1865 风格）：宿主通过 MCP 资源 `ui://vectorcraft/panel.html` 拿到一个 HTML 应用并渲染成面板。`availability:"session"` = 会话级面板。
3. **桥**：`server.mjs` 既是 MCP Server，又是「面板 ↔ 引擎」的胶水（资源分块下发、`open_editor`、保存/导出、workspace 路径校验）。

ZCode 宿主侧依赖里确实带了 `@modelcontextprotocol/ext-apps@2.0.0`（`F:\ZCode\resources\app.asar\package.json`），并且渲染进程有专门的插件沙箱页：`out/renderer/plugin-sandbox.html`，其 `#root` 里就是**一个全屏 iframe**——即「插件 UI 最终跑在沙箱 iframe 中」。

### 1.3 panel.html 里的协议细节（可复用的关键）

从 `dist/panel.html` 反查（压缩后仍可定位）：

```js
// 连接：MCP Apps 客户端把 window.parent 当宿主
tt = new App({ name, version }, {}, { autoResize:false });
await tt.connect(new Transport(window.parent, window.parent));
// 握手
await this.request({ method: 'ui/initialize', params: { appCapabilities, appInfo, protocolVersion }});
// 宿主能力要求：openLinks / downloadFile / serverTools / serverResources
// 资产：按块读 MCP 资源并做 SHA-256 校验
async function openAsset(asset, baseUri) {
  const buf = new Uint8Array(asset.bytes);
  for (let i = 0; i < asset.parts; i++) {
    const part = await tt.readServerResource({ uri: `${baseUri}/${i}` });
    ... // base64 blob → buf
  }
  await crypto.subtle.digest('SHA-256', buf) // 校验
  ... // DataTransfer + File → 拖入 canvas 打开
}
// 工具面：agent 对文档的操作用 callServerTool / 宿主下发的 tool-input/tool-result
// 文件面：全局 __craftRead/__craftWrite/__craftList/__craftMkdir/__craftScreenshot
// 内部工具：_editor_attach / _editor_poll / _editor_write / _editor_detach / _editor_reply
```

**这层桥就是 ZCode 的「秘密」**：UI 不是 Electron 原生窗口，而是一个标准 Web 应用；文件打开/保存/工具调用全部走宿主消息。ZCode 的 `server.mjs` 负责另一端（MCP Server + 资源 + 编辑器会话 token + 工作区路径校验 + 保存经由宿主 `ui/download-file`）。

### 1.4 套件目录页从哪来

- 截图 2 那种「卡片 + 版本 + GitHub + 打开」的目录页，数据形态与 **ArtCraft Launcher** 一致（`F:\ArtCraft Launcher\artcraft-launcher.exe`，egui 应用）。
- Launcher 实际使用两个数据源（二进制内字符串）：
  - `https://api.storyteller.ai/v1/craft_apps/release_info`（ArtCraft 官方发布信息）
  - `https://api.github.com/repos/...`（GitHub Releases/仓库信息）
- 本机 Launcher 配置（`%APPDATA%\ai.storyteller.artcraft-launcher\data\app.ron`）里记录的已知版本：cadcraft 0.18.0、effectcraft 0.22.0、figcraft 0.16.0、filmcraft 0.18.0、gridcraft 0.17.0、photocraft 0.21.0、soundcraft 0.18.0、vectorcraft 0.22.0、wordcraft 0.16.0 —— 与截图 2 完全一致（截图里 SolidCraft 0.30.1 是社区应用，`由 TANGENCY LABS 提供`）。
- 所以 DSH 版目录页的数据源可以直接复用这两个公开接口；首版也可以只读本地 `F:\ArtCraft\*` 的安装状态，避免网络依赖。

> 截图 2/3 本身是目标稿（看起来是在 FigCraft 里拼的 mockup）。ZCode 里的真实形态是「会话面板」，没有「自媒体工作台」这些 DSH 插件导航；所以本方案是把 ZCode 的**能力**（Web UI + MCP 引擎桥）搬进 DSH 的**导航/主区**。

---

## 2. DSH 的扩展点（有源码/文档证据）

### 2.1 DSH 插件包契约

第三方插件就是一个 npm 包（本机已有多个 `link:` 本地插件在跑）：

```json
{
  "name": "dsh-artcraft-hub",
  "type": "module",
  "main": "lib/host.js",
  "exports": {
    ".": "./lib/host.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-layout"] }
  },
  "engines": { "node": ">=20", "dsh": ">=0.2.2-rc.1 <0.3.0" }
}
```

- `main`：Host 半身（Node/Cordis 插件，`export function apply(ctx)` 或 `export default {apply}`）。
- `exports["./client"]`：浏览器半身（**手写即可**，格式见 §2.2）。
- `dsh.bundle.patch`：Bundle 补丁，典型内容就是一行 `insert`，把插件 id 挂进 Cordis 树。
- 装法（本机已验证的本地开发流）：profile `package.json` 里加 `"dsh-artcraft-hub": "link:F:/DSH_project/DSH_plugin/dsh-artcraft-hub"`，并在 `dsh.profile.bundles` 数组里追加包名，然后重载。

### 2.2 浏览器半身的真实格式（无需构建工具）

```js
window.__ModuleLoader__.load({
  id: 'dsh-artcraft-hub',
  factory(require) {
    const React = require('react')
    return {
      inject: ['slots'],
      apply(ctx) { /* 注册 UI */ },
    }
  },
})
```

`F:\DSH_project\default\dsh-usage-hud\client.js` 是一个 1300 行、可读的完整例子。

### 2.3 左侧导航行 + 主区页面 = 两次 slot 注册

```js
const ID = 'artcraft-hub'

ctx.slots.inject('main', () => ctx.slots.register(
  { name: 'main', key: ID },          // 主区 keyed slot：页面组件
  GalleryPage,
))

ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
  { name: 'sidebar.panellist', id: ID, order: 6, label: 'ArtCraft' },  // 左侧导航行
  Icon,                               // 收 { size, active } 的图标组件
))
```

- 点击导航行时，侧边栏内部调用 `ctx.layout.selectPanel(ID)`；`selectPanel(null)` 回到会话。
- 页面容器会带 `data-global-panel`，顶部要自己留出 `--dsh-frame-top-clearance`（48px / Windows 标题栏高度）。
- 现成的三行怎么写死的（可直接抄结构）：
  - `dsh-media-desk` → 自媒体工作台（order 5，图标 + 整页 React UI）
  - `dsh-context` → 上下文洞察（order 20，带设置开关门控）
  - `dshmarket` → 插件（含防御式注销与 `selectPanel(null)` 清理）

### 2.4 Host 半身可以注册同源 HTTP 路由

```js
export const inject = ['webServer']

export function apply(ctx) {
  ctx.inject(['webServer'], (scoped) => {
    const server = scoped.webServer
    ctx.effect(() => server.register({
      kind: 'prefix',
      path: '/artcraft-hub',
      handler: handleArtcraftRequest,   // (req, res) => void，自己做鉴权
    }), 'dsh-artcraft-hub: routes')
  })
}
```

- 同样的写法在 `dsh-media-desk/src/host.js`、`dsh-usage-hud/index.js`（`/api/dsh-better-hud/*`）里都在用。
- **路由不会自动鉴权**：handler 里要调 `ctx.connection.requestRejection` / `admit`（media-desk 有现成 helper），或者只暴露静态编辑器页面、把敏感操作走插件自己的 token。
- 插件包内只能直接分发图片类资源（`.svg/.png/.webp/.jpg`）；HTML/CSS/JS/WASM 必须由自己的路由服务。

### 2.5 内嵌 Web UI 的正确姿势：同源 iframe

| 部署形态 | 渲染页 origin | iframe 方案 |
|---|---|---|
| Web（`dsh web`） | `http://127.0.0.1:<port>` | `<iframe src="/artcraft-hub/apps/vectorcraft/panel.html">`，同源 |
| Desktop（本机 | `dsh-app://app`） | 非 `/`、`/index.html`、`/assets/*` 的路径会被**原样代理到本地 Host**；因此 `/artcraft-hub/...` 仍同源可用 |

- DSH 的页面**没有全局 CSP**，iframe 不会被拦；插件自绘 `<webview>` 会被主进程 lease 校验拦掉（`will-attach-webview` 直接 `preventDefault`），**所以只用 `<iframe>`**。
- 推荐给 iframe 加 `sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"`（按需增减；不要给 `allow-top-navigation`）。
- 不建议「另起一个 127.0.0.1 端口再跨源 iframe」：虽然大概率能跑，但要面对 Chromium 私有网络策略、cookie/CORS、桌面代理层差异，收益不大。

### 2.6 DSH 缺什么

- **没有 MCP Apps UI 宿主**：`ui://`、`ext-apps`、`resourceUri`、`ui/download-file` 在 `app.asar` 里 0 命中。MCP 只给 Agent 用（`mcp__<server>__<tool>`），不能把 MCP 资源渲染成面板。
- 但这**不妨碍**做 UI：DSH 的 iframe 是完整的 Chromium WebView，页面里可以实现 MCP Apps 的宿主端协议（`postMessage` JSON-RPC），把请求转给自己的 HTTP 路由 → 再代理到本地 MCP Server。见 §5 架构。

---

## 3. 可行性分级判断

| 层级 | 能力 | 可行性 | 工作量 | 主要风险 |
|---|---|---|---|---|
| **L0** | 左侧新增 `ArtCraft` 导航行 + 套件目录页（截图 2 的卡片网格、版本、GitHub、打开按钮） | ✅ **完全可行**，纯 DSH 插件，无需新协议 | **1–3 天**（含目录数据、图标、中英文、样式） | 版本检查接口可用性；打开动作先用「原生应用外窗」 |
| **L1** | 打开应用后，在 DSH 主区/标签页里**内嵌真实 ArtCraft Web UI**（截图 3 效果） | ⚠️ **可行，但要自建 Host 桥** | 首个应用 **1–2 周**；每个应用套壳 +1–2 天（取决于 quirks） | 面板启动/资源加载未最终验证；授权与体积 |
| **L2** | Agent 工具与内嵌 UI **共享同一份活动文档**（用户拖拽/编辑，Agent 同时用 `command_run` 改同一个文档） | ⚠️ **难但可做**（ZCode 的 `_editor_*` 就是这套） | **2–4 周** | 单进程会话、并发/取消/超时、DSH 工具注册与 MCP 生命周期 |
| **L3** | 多应用统一、打开/保存到 workspace、导出、版本更新、桌面/Web 双端打磨 | 🟡 持续 | 持续迭代 | 合规、包体、首启下载、错误恢复 |
| 备选 | 只做目录页 + 「打开原生应用」（`F:\ArtCraft\X\X.exe`）+ Agent 用现有 MCP 工具 | ✅ 最容易 | 0.5–1 天 | 不满足「在 DSH 里使用」的视觉目标 |

**判断依据（关键反驳/修正）**：
- 网络上常见误解「ZCode 是把 ArtCraft 桌面应用嵌进侧边栏」——**不是**。桌面应用是原生 Rust/egui，无法跨进程嵌入；ZCode 嵌的是**另编译的 Web 版**。
- 所以 DSH 想复刻，必须拿到「Web 版 UI」。好消息：**ZCode 插件缓存里就有 9 个应用的编译产物**（本地已存在），这是最快的复用路径；坏消息：它依赖 MCP Apps 宿主协议，要补一层 shim（`research/runtime/spike/serve.cjs` 已经验证了 patch 点与分块资产读取可行）。
- 不想复用 ZCode 产物的话，就需要从上游 `github.com/storytold/*` 自行 `trunk build`（Rust 工具链、体积大、CI 长），或自己写一个简化编辑 UI（与截图 3 差距会很大）。

---

## 4. 推荐架构（P1 全量形态）

```
┌─ DSH Renderer（Web 或 Desktop）──────────────────────────────────────────────┐
│  slots: sidebar.panellist[ArtCraft]  ──click──▶  ctx.layout.selectPanel('artcraft-hub') │
│  slots: main['artcraft-hub']                                                 │
│    └─ <GalleryPage>  ──「打开 VectorCraft」──▶  <EditorPage>                   │
│          │                                        └─ <iframe src="/artcraft-hub/app/vectorcraft/panel.html"> │
│          │                                              │  (同源)               │
│          │                                              ▼                      │
│          │                                   panel.html（ZCode 编译产物）      │
│          │                                     │ postMessage(JSON-RPC)        │
│          │                                     ▼                              │
│          └────────────── 父页面里的 MCP Apps Host Shim ──────────────────────┐ │
│                              ui/initialize / resources/read / tools/call     │ │
└──────────────────────────────────────────────┬───────────────────────────────┘ │
                                               │ fetch /artcraft-hub/api/*       │
┌─ DSH Host（Node / Cordis 插件 lib/host.js）──▼───────────────────────────────┐
│  ctx.webServer.route('/artcraft-hub')                                        │
│    ├─ GET  /app/<name>/*       静态：panel.html + assets(*.gz 解压/分块)      │
│    ├─ GET  /api/catalog        目录（本地清单 / ART API / GitHub，带缓存）     │
│    ├─ POST /api/rpc            把面板 JSON-RPC 转发给下面的 MCP 子进程        │
│    └─ POST /api/workspace/*    打开/保存工作区文件（路径校验、原子写）          │
│  每个应用 1 个 MCP 子进程（vectorcraft-cli.exe mcp --headless 或 ZCode server.mjs）│
└──────────────────────────────────────────────────────────────────────────────┘
```

两个实现选择：

- **A. 复用 ZCode `server.mjs` 作为后端（最快）**：它已经实现「资源分块 + `open_editor` + `_editor_*` 会话 + 保存经由宿主」。我们只做：静态服务 + 父页面 host shim + `/api/rpc` 代理。缺点：授权/分发要注意（它是 ZCode 的集成产物，MIT OR Apache-2.0 + ArtCraft 商标条款；个人使用无碍，公开分发要保留 notices 或自行从上游构建）。
- **B. 用 ArtCraft 官方 CLI 作后端（更干净）**：`vectorcraft-cli.exe mcp --headless --automation-read-root <ws> --automation-write-root <ws>` 提供引擎工具；我们自己按 `assets.json` 服务资产、自己实现打开/保存。工作量大一些，但不依赖 ZCode 产物。

> 个人使用推荐 A 先跑通体验，再按需迁移到 B。

---

## 5. 实现路线（分阶段、可验收）

### P0 — 入口 + 目录页（1–3 天，先看到截图 2）

1. 在本仓库把插件骨架补齐：
   ```
   package.json / cordis.patch.yml
   lib/host.js          # webServer 路由：/artcraft-hub/api/catalog 等
   lib/client.js        # __ModuleLoader__.load：导航行 + GalleryPage
   web/icon.svg         # 已有 artcraft-icon.svg 可复用
   locale/{zh,en}.json
   ```
2. 目录数据：优先扫描 `F:\ArtCraft\*`（存在性 + 版本号从 exe VersionInfo 读）；可选拉 `api.storyteller.ai/v1/craft_apps/release_info` + GitHub 更新检查，落盘缓存 5 分钟。
3. GalleryPage：深色卡片网格（对齐截图 2：图标/名称/作者/一句话/版本/GitHub/打开）；`打开` 先接「原生应用外窗」。
4. 冒烟验收：导航出现 `ArtCraft` 行 → 点击进入目录页 → 点开一个应用能启动/报错有提示；禁用插件后 UI 干净卸载。

### P1 — 单应用真实内嵌（1–2 周，先 VectorCraft）

1. 选一个应用（建议 VectorCraft：有 CLI MCP、有 ZCode 编译产物、有 README）。
2. `lib/host.js` 增加：
   - `/artcraft-hub/app/vectorcraft/panel.html`：读取 ZCode `dist/panel.html`（首次运行复制到 `DSH_HOME/artcraft-hub/cache/<app>/<version>/`，避免依赖 ZCode 安装路径）。
   - `/artcraft-hub/app/vectorcraft/r?uri=...`：按 `assets.json` 从 `assets/<sha>.gz` 解压、按 2 MiB 分块返回（可直接用 spike 的 `serve.cjs` 逻辑）。
   - `/artcraft-hub/api/rpc`：把 `resources/read`/`tools/call` 转发给 MCP 子进程（JSON-RPC over stdio）。
3. 前端：`EditorPage` 渲染 iframe；父页面注册 `message` 事件实现 host 侧：
   - `ui/initialize` → 回 `{ protocolVersion, hostInfo, hostCapabilities:{openLinks,serverTools,serverResources,downloadFile}, hostContext:{theme,displayMode,locale,containerDimensions} }`
   - `resources/read` / `tools/call` → `POST /api/rpc`
   - `ui/download-file` / `ui/open-link` → DSH 侧下载或 `openExternal`
   - 面板 `ui/notifications/*`（尺寸、标题）→ 忽略或更新容器
4. 验收：
   - iframe 里出现真实 VectorCraft 编辑器（能画、能导出），错误可见（加载进度/失败原因）。
   - 关掉面板不泄漏子进程；DSH 重启后能恢复。
   - Web 与 Desktop 两套 origin 都测过（`http://127.0.0.1:*` 与 `dsh-app://app`）。

### P2 — 横向多应用（1–2 周）

- 把「app manifest 驱动」抽出来：每个应用 = `{ key, title, exe, cli, zcodeDist?, wasmSize, quirks }`。
- 处理差异：PhotoCraft 的 `max_side`、SoundCraft 音频、FilmCraft 大资产、GridCraft 表格等；每个加一次冒烟。
- 目录页「更新检查」、首次下载/复制资产的进度与失败重试；包体策略（不把 100 MB WASM 打进插件，首次运行按需复制/下载）。

### P3 — Agent 联动（2–4 周）

- 目标：内嵌 UI 与 Agent 操作**同一个文档实例**。
- 手段：每个应用**只起一个** MCP Server 进程（ZCode 的 `server.mjs` 或 CLI mcp），插件 Host 持有它：
  - 面板 → `/api/rpc` → 同一个进程；
  - Agent → 插件通过 `ctx.tools.register` 注册一组代理工具（或把 MCP 以 streamable-http 暴露给 DSH 的 `dsh-mcp-client` 行）→ 同一个进程。
- 防重复：profile 里已有 7 个 ArtCraft CLI 的 MCP 行（headless，各自独立文档）。要么用 `!!js` 关掉旧行，要么保留为「无 UI 的 Agent 工具」但明确两套文档不共享。
- 处理并发/取消/超时（ZCode 的 `_editor_poll/_editor_write/_editor_reply` 是现成参考）。

---

## 6. 关键代码骨架（可开工版）

### 6.1 `package.json`（略，见 §2.1）

### 6.2 `cordis.patch.yml`

```yaml
- insert:
    - id: artcraft-hub
      name: 'dsh-artcraft-hub'
```

（不要再往 profile 的 `cordis.patch.yml` 手工 insert 同 id，重复 id 会导致 Loader 启动失败。）

### 6.3 `lib/client.js`（导航 + 目录页 + 编辑器页）

```js
window.__ModuleLoader__.load({
  id: 'dsh-artcraft-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ID = 'artcraft-hub'

    function Icon({ size }) {
      return h('img', { src: '/artcraft-hub/icon.svg', width: size ?? 18, height: size ?? 18, alt: '' })
    }

    function Gallery() {
      const [apps, setApps] = React.useState([])
      const [open, setOpen] = React.useState(null)
      React.useEffect(() => {
        fetch('/artcraft-hub/api/catalog').then(r => r.json()).then(d => setApps(d.apps || []))
      }, [])
      if (open) return h(Editor, { app: open, onClose: () => setOpen(null) })
      return h('div', { className: 'ach-page', style: { padding: '48px 32px 32px' } },
        h('h1', null, 'ArtCraft 套件'),
        h('div', { className: 'ach-grid' }, apps.map(app =>
          h('div', { key: app.key, className: 'ach-card' },
            h('img', { src: app.icon, width: 40 }),
            h('b', null, app.title),
            h('span', null, app.version),
            h('button', { onClick: () => setOpen(app) }, '打开')))))
    }

    function Editor({ app, onClose }) {
      // 同源 iframe；父页面即 MCP Apps Host
      React.useEffect(() => {
        const onMsg = (e) => {
          if (e.source !== ref.current?.contentWindow) return
          const msg = e.data
          if (!msg || msg.jsonrpc !== '2.0' || !msg.method || msg.id == null) return
          if (msg.method === 'ui/initialize') {
            reply(e.source, msg.id, {
              protocolVersion: '2026-01-26',
              hostInfo: { name: 'dsh-artcraft-hub', version: '0.1.0' },
              hostCapabilities: { openLinks: {}, serverTools: {}, serverResources: {}, downloadFile: {} },
              hostContext: { theme: 'dark', displayMode: 'inline', locale: 'zh-CN',
                             containerDimensions: { width: 1200, height: 800 } },
            })
            return
          }
          fetch('/artcraft-hub/api/rpc', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ app: app.key, method: msg.method, params: msg.params }),
          }).then(r => r.json()).then(r => reply(e.source, msg.id, r.result))
            .catch(err => reply(e.source, msg.id, { isError: true, content: [{ type: 'text', text: String(err) }] }))
        }
        window.addEventListener('message', onMsg)
        return () => window.removeEventListener('message', onMsg)
      }, [app.key])
      const ref = React.useRef(null)
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        h('div', { style: { padding: '8px 12px' } },
          h('button', { onClick: onClose }, '← 返回套件')),
        h('iframe', {
          ref, src: '/artcraft-hub/app/' + app.key + '/panel.html',
          style: { flex: 1, border: 0, width: '100%' },
          sandbox: 'allow-scripts allow-same-origin allow-forms allow-downloads',
        }))
    }

    function reply(target, id, result) {
      target.postMessage({ jsonrpc: '2.0', id, result }, '*')
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const off = []
        off.push(ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ID }, Gallery)))
        off.push(ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: ID, order: 6, label: 'ArtCraft' }, Icon)))
        return () => off.forEach(fn => { try { fn() } catch {} })
      },
    }
  },
})
```

> 注意：`reply` 里的 `targetOrigin` 建议用 `location.origin`（同源），示例为简洁用了 `'*'`；真正实现时收紧。

### 6.4 `lib/host.js`（静态资产 + rpc 代理）

要点（完整实现可复用 `.research/runtime/spike/serve.cjs`）：

1. `ctx.inject(['webServer'])` → `webServer.register({ kind:'prefix', path:'/artcraft-hub', handler })`。
2. 静态：`/app/<key>/panel.html` 读缓存文件；`/app/<key>/r?uri=` 按 `assets.json` 的 `assets[].id/sha256/parts` 从 `.gz` 解压切片返回。
3. RPC：`child_process.spawn(<cli.exe>, ['mcp', '--headless', '--automation-read-root', ws, '--automation-write-root', ws])`，行协议 JSON-RPC 转发；按 app 单例复用；插件卸载时 kill。
4. 安全：handler 里做 `ctx.connection.requestRejection`（或只允许本机同源请求）；所有文件路径 `realpath` + 前缀校验；限制请求体大小。

---

## 7. 风险与未决问题

| # | 风险 | 说明 / 对策 |
|---|---|---|
| 1 | **授权与商标** | ZCode 编译产物是 `MIT OR Apache-2.0` 集成，含 ArtCraft 商标条款；个人本机复用没问题，**对外分发**要保留 NOTICE/ATTRIBUTION 或改为自己从上游构建 |
| 2 | **体积/内存** | 单应用 WASM 可达 ~108 MB（VectorCraft）；不要把资产打进插件包，按需复制/下载 + 缓存；Electron 页面内存占用要实测 |
| 3 | 协议未最终验证 | `panel.html` 是否能在「父页面 host shim」下完整启动，还没有跑完整浏览器验证（spike 只到 HTTP 监听；headless Chrome 环境报错）。**这是 P1 第一步要做的 spike** |
| 4 | MCP 重名 | profile 已有 7 个 ArtCraft CLI 的 MCP 行；同 `serverName` 第二条会失败。用 `!!js` 检测/关旧行，或改为不注册新 MCP、只走插件自有的/流式 HTTP |
| 5 | 路由鉴权 | DSH 的 webServer 路由不会自动鉴权；必须复用 `ctx.connection.requestRejection` 或加随机 token |
| 6 | 桌面代理限制 | `dsh-app://app` 代理会剥掉 `set-cookie`/`content-length` 等；只走 GET 静态 + JSON POST，别依赖 cookie/流式特殊头 |
| 7 | 保存/工作区 | 面板保存目前走 `ui/download-file`（浏览器下载）；要做「保存回 workspace」需自己在 shim 里实现（`File System Access` 或 POST 到插件路由原子写） |
| 8 | 双实例文档 | 不实现 P3 前，Agent 的 MCP 工具操作的是 headless 文档，与内嵌 UI **不是同一份**；UI 里需明确提示，或先只读 |
| 9 | 更新机制 | 应用版本/插件自身更新；目录页可做检查，但自动更新涉及签名与安装，首版建议只提示 |
| 10 | 桌面/Web 差异 | 两套 origin 与 carrier 不同，P1 必须双端冒烟；本机是 Desktop 形态（截图） |
| 11 | HMR/回滚 | 开发用 `link:` + 重载；HMR 无回滚，保留「禁用插件」的恢复路径 |

---

## 8. 建议的下一步（三选一）

- **A（推荐先做）**：我直接把 **P0 骨架**建好（可装载、能看到 `ArtCraft` 导航 + 目录页），你打完游戏重载 DSH 就能看到效果；约 1–3 天工作量。
- **B（技术验证优先）**：我先做 **P1 的可运行 spike**：只做 VectorCraft 一个应用，验证「ZCode 编译 UI + host shim + CLI MCP」能真正在 DSH iframe 里启动、编辑、导出；成功后再决定全量。
- **C（降级方案）**：只做目录页 + 打开原生应用（0.5–1 天），以后有需要再升级到内嵌。

---

## 9. 更新模型：ArtCraft 发版时要更新 DSH 插件吗？

**结论：不需要。** 关键设计是**把「插件本体」和「应用运行时」拆开**：插件是稳定的壳，ArtCraft 应用的 UI/引擎是可独立热更新的数据（和 ArtCraft Launcher 更新应用是一个思路，而不是每次重装 Launcher）。

### 9.1 三层更新，各走各的

| 层 | 内容 | 更新频率 | 更新方式 |
|---|---|---|---|
| **L1 插件本体** | DSH 集成层：导航行、套件目录页、MCP Apps host shim、静态路由、本地化 | 很低（只在 DSH API 变化 / 桥协议 breaking / 功能迭代时） | 正常 npm / 插件市场更新；包体控制在几百 KB，**不打包应用资产** |
| **L2 应用 Web 运行时** | 每个应用的 `panel.html` + `assets`（ZCode 编译快照，或自行从上游构建的 Web 版） | 跟 ArtCraft 发版（数周~数月） | 插件内「检查更新」一键下载/复制 → sha256 校验 → 写入版本目录；旧版本保留可回滚 |
| **L3 引擎 / CLI** | `F:\ArtCraft\*` 的原生应用与 `*-cli.exe`（只有 B 路线依赖） | 跟 ArtCraft Launcher 自动更新 | 用户已有的 Launcher 负责；插件只检测版本、不用管升级 |

### 9.2 运行时资产解析：按优先级自动找，找不到才提示

```
resolve(appKey):
  1) <DSH_HOME>/artcraft-hub/apps/<app>/<version>/      ← 插件自己的缓存（已安装/已更新）
  2) C:\Users\<user>\.zcode\cli\plugins\cache\zcode-plugins-official\<app>\*\dist
        → 取最高版本。ZCode 插件更新后，DSH 侧下次打开自动用新版，**无需发 DSH 插件**
  3) ZCode 官方 CDN：marketplace.json → 对应版本 plugin.zip（带 sha256）
        → 下载、校验、解压到 1)，离线可用
  4) 都没有 → 目录页显示「安装/更新」按钮 + 明确的错误原因
```

这样最常见的场景是：**你更新 ZCode 的 ArtCraft 插件（或 ArtCraft Launcher），DSH 里下次打开就是新版本**，不存在「ArtCraft 发版 → 我得重新装一次 DSH 插件」。

### 9.3 版本检查与一键更新（就是截图 2 那页的「上次检查 5 分钟前 · 来源 ARTCRAFT API 和 GITHUB」）

- 数据源与 ArtCraft Launcher 完全一致：`https://api.storyteller.ai/v1/craft_apps/release_info` + GitHub（Releases/仓库）。本机 Launcher 的 `app.ron` 里也能读到同样的版本表。
- 打开套件页时检查（可节流，例如每小时一次）；有新版本的卡片显示「可更新」徽标。
- 点「更新」：下载/复制 → 解压 → `sha256` 校验（ZCode 的 `assets.json`/`BUILD.json` 自带哈希）→ 写入版本目录 → 切换默认版本；任一步失败都保留旧版并提示。
- 两种模式可选：**跟随 ZCode 插件缓存**（默认，离线可用）或 **固定版本**（企业/稳定优先）。

### 9.4 什么时候才真的需要更新插件本体

1. DSH 大版本升级导致 slot/API 变化（`engines.dsh` 不满足）——这种无论如何要更新。
2. **MCP Apps 桥协议 breaking**：新 `panel.html` 改了 `ui/initialize` 版本或消息集。对策：快照清单里带 `compat.bridge = 2` 这类字段，shim 向后兼容多版本；实在不支持就回退旧快照并提示「需更新 ArtCraft Hub」。
3. 功能/视觉迭代（目录页、新应用接入、保存流程）。
4. 安全修复。

### 9.5 两条技术路线的更新语义差异

- **A：复用 ZCode 编译快照 + `server.mjs`（先跑体验）**
  更新 = 换快照。与 `F:\ArtCraft` 原生应用**完全解耦**（引擎在浏览器 WASM 里跑，快照自带版本一致性）。ZCode 更新后自动跟随，不发插件。注意授权/商标与分发合规。
- **B：官方 CLI MCP + 自研 UI（长期合规）**
  更新 = ArtCraft Launcher 更新原生应用，我们只检测版本；UI 通过 `commands` 动态拉取命令目录，基本不随版本改；只有命令约定变化时才需要适配。

**一句话**：按这个设计，ArtCraft 发版你只需要在「套件页」点一次更新（甚至什么都不用做，因为默认跟随 ZCode 缓存/ArtCraft Launcher），DSH 插件本身几个月都不一定需要发一次版。

---

## 附录 A：证据索引

- ZCode 插件缓存：`C:\Users\86159\.zcode\cli\plugins\cache\zcode-plugins-official\<app>\<ver>\`
  - 清单：`.zcode-plugin/plugin.json`
  - UI：`dist/panel.html`（MCP App，`ui/initialize`、`resources/read`、`_editor_*`）
  - 后端：`dist/server.mjs`；资产：`dist/assets.json` + `dist/assets/*.gz`
- ZCode 宿主：`F:\ZCode\resources\app.asar\out\renderer\plugin-sandbox.html`（`#root iframe`）；`package.json` 含 `@modelcontextprotocol/ext-apps@2.0.0`
- DSH 宿主/插件文档（只读 asar）：`F:\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\`
  - `dsh-client-ui-sidebar/README.md`（`sidebar.panellist`）
  - `dsh-client-ui-layout/README.md`（`main` keyed slot / `ctx.layout.selectPanel`）
  - `dsh-host-webserver/README.md`（`register` / `kind: exact|prefix` / 鉴权）
  - `dsh-client-ui-sidebar-browser/README.md`（loopback / iframe / webview）
  - `dsh-mcp-client/README.md`（MCP 行与命名）
- 本机真实插件模板：
  - `F:\.dsh\profiles\desktop\node_modules\dsh-media-desk\dist\client.js`（导航行+页面）
  - `...\dsh-context\lib\client.js`（order 20 + 设置门控）
  - `...\dsh-mcp-studio\lib\client.js`（`definePanel`）
  - `F:\DSH_project\default\dsh-usage-hud\`（手写 client bundle + Host 路由）
- 调研脚本/证据：`.research/`（`dsh-scout` 报告 `research/dsh/REPORT.md` 已完整；ZCode/runtime 两份因「保持安静」被提前停止，原始脚本与数据留在 `.research/zcode/`、`.research/runtime/`，其中 `research/runtime/spike/serve.cjs` 是 P1 的直接起点）

## 附录 B：已完成的 spike（可继续）

- `research/runtime/spike/serve.cjs`：把 ZCode `dist/panel.html` 的 transport 从 `window.parent` 改成自身，注入 in-page shim 自答 `ui/initialize`/`resources/read`/`tools/call`，并从 `assets.json` 的 `assets/<sha>.gz` 解压分块提供资源；已成功监听 `http://127.0.0.1:8123/`。
- 尚未完成：用真实浏览器打开确认 UI 渲染；把它改造成「父页面 host shim + 同源 iframe」形态（即 P1 正式方案）。
