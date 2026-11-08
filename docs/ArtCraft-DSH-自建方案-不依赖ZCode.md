# ArtCraft × DeepSeek Harness（DSH）插件：不依赖 ZCode 的自建方案（v2）

> 版本：v2（2026-11-08）
> 变更：v1 曾把 ZCode 的编译产物当作复用路径；按你的要求，**本版完全不依赖 ZCode**，只使用 ArtCraft 官方仓库/官方发布物。ZCode 仅作为「同类宿主的实现背景」在附录一句话带过，不参与任何依赖链。
> 目标：在 DSH 左侧新增 `ArtCraft` 入口，点开是套件目录页；点某个应用后，在 DSH 主区里直接使用该应用的界面（尽量贴近你给的截图 3）。

---

## 0. TL;DR

| 问题 | 结论 |
|---|---|
| 不靠 ZCode，能做出「侧边栏打开 ArtCraft 应用」吗？ | **能。** ArtCraft 每个应用都是 **Rust/egui + wgpu** 写的，官方仓库明确支持**编译成 Web（WebAssembly）**，并且部分应用（如 WordCraft）**在 GitHub Releases 里直接发布 `*-web-<ver>.zip` 静态站点**。DSH 插件把这些 Web 构建下载/缓存/用同源 HTTP 服务出来，用 `<iframe>` 放进主区即可。 |
| 入口难不难？ | 不难。DSH 原生支持：`sidebar.panellist` 加一行 + `main` 注册页面，已有第三方插件（自媒体工作台/上下文洞察）在用同一套 API，**不用改 DSH 源码**。 |
| 更新怎么办？ | **插件本体几乎不用更新**。Web 构建是「数据」：插件检查 GitHub Releases → 下载新 zip → sha256 校验 → 切换版本。ArtCraft 发版你只需在套件页点一下更新（甚至可自动）。只有 DSH API 变更或桥协议破坏时才需要发插件。 |
| 做不到/代价是什么？ | Web 版与桌面原生版有差异（打印、部分系统对话框、音频设备等原生能力受限；文件打开/保存走浏览器能力）。没有官方 Web 产物的应用，需要①用官方源码构建一次（可脚本化/CI），或②用「控制通道远程内嵌」兜底（原生窗口截屏+输入转发，画质/延迟有损耗）。 |

---

## 1. 先看清对象：ArtCraft 套件到底是什么

### 1.1 技术栈（本机实测）

- 桌面应用是**原生 Rust + egui/eframe + wgpu**（不是 Electron/Tauri）：
  `F:\ArtCraft\VectorCraft\vectorcraft.exe` 字符串命中 `egui=527、wgpu=272、winit=134、eframe=19`，`tauri/wry/WebView2` 无命中。
- 每个应用都带一个 `*-cli.exe`：
  - `vectorcraft-cli mcp`（stdio MCP）／`run`／`convert`／`commands`／`info`／`bench`；
  - `wordcraft-cli mcp` / `run` / `convert` / `inspect` 等。
- 桌面应用支持 `--control <port>` **JSON 控制通道**；CLI 可 `mcp --connect 127.0.0.1:<port>` 连上正在运行的应用，并具备 `screenshot` / `click` / `key` 等「远程操作 UI」的工具（WordCraft README 明列）。
- 官方 README 的关键句：
  - VectorCraft：「**Everywhere.** One codebase for the desktop apps and the same UI in the browser.」
  - WordCraft：「…runs natively on macOS, Windows, Linux and BSD, and **in the browser via WebAssembly**」；「Web: `cd apps/wordcraft-web && trunk serve`」；Releases 里 **`wordcraft-web-<ver>.zip`：Static site，Runs in a modern browser; host it on any static server**。
  - 本地 `F:\ArtCraft\VectorCraft\README.md` 也明确给了 `cd apps/vectorcraft-web && trunk build --release # web build → dist/web`。

**结论**：官方就提供 Web 版，这是「不依赖 ZCode、在 DSH 里内嵌真实 UI」的合法、正路来源。

### 1.2 本机工具链

- `rustc 1.97.1`、`cargo 1.97.1` 已安装；`trunk` 未装（`cargo install trunk` 即可，或走仓库自带的 `cargo xtask`）。
- 也就是：**即便某个应用没有现成 web zip，也能本机构建**（一次性或每个版本跑一次脚本）。

### 1.3 DSH 侧要用的扩展点（有源码/文档证据）

| 需求 | 扩展点 | 证据 |
|---|---|---|
| 左侧导航行 | 注册到根级 **list** slot `sidebar.panellist`，`{id, order, label, locale}` + 图标组件 | `dsh-client-ui-sidebar/README.md`；`dsh-media-desk/dist/client.js:830` |
| 主区页面 | 注册到根级 **keyed** slot `main`，`key` 与导航行 id 相同 | `dsh-client-ui-layout/README.md`；`dsh-media-desk` |
| 切换页面 | `ctx.layout.selectPanel(id)`；`selectPanel(null)` 回会话 | `dsh-client-ui-layout/lib/client.js` |
| Host HTTP 路由 | `ctx.inject(['webServer'], s => s.webServer.register({kind:'prefix', path, handler}))` | `dsh-host-webserver/README.md`；`dsh-media-desk/src/host.js:436` |
| 内嵌 Web UI | 主区 React 组件里渲染**同源 `<iframe src="/artcraft-hub/app/...">`**；Desktop 的 `dsh-app://app` 会把非静态路径代理到 Host | DSH 桌面 `main.js` 的 `protocol.handle`/`forwardWebRequest`；页面无全局 CSP |
| 插件打包 | `package.json` 的 `dsh.bundle.patch` + `dsh.client`；Host 半身是普通 Cordis 插件；浏览器半身手写 `window.__ModuleLoader__.load` | 已安装的 `dsh-usage-hud` / `dsh-media-desk` 等 |

> DSH 没有 MCP Apps UI 宿主，但**不需要**：我们直接 iframe ArtCraft 官方 Web 构建，不涉及 MCP 资源渲染。

---

## 2. 三条自建路线（不含 ZCode）

| 路线 | 做法 | 还原度 | 工作量 | 更新成本 | 风险 |
|---|---|---|---|---|---|
| **A. 官方 Web 构建内嵌（推荐）** | 下载/构建每个应用的 `*-web-<ver>.zip` → 插件缓存 → 同源 HTTP 服务 → 主区 iframe | 高（就是官方 Web UI） | P0 后约 **3–7 天**做通一个应用；横向每应用 +0.5–1 天 | 插件内一键更新，**不发插件** | 各应用 Web 能力差异；个别应用可能没有官方 web 产物；文件保存走浏览器 |
| **B. 控制通道远程内嵌（兜底）** | 启动原生应用 `--control PORT` → 插件连 JSON 控制通道 → 把 `screenshot` 当画面、把点击/键盘/滚轮转发回去 | 中（像素流，有延迟/缩放） | **1–2 周**做通用壳 | 跟原生应用（Launcher 更新） | 帧率/延迟、坐标映射、多窗口/对话框、绘制类体验差 |
| **C. 目录页 + 打开原生窗口（P0）** | 侧边栏入口 + 套件页 + 「打开」启动 `F:\ArtCraft\X\X.exe`；Agent 用现有 MCP 工具 | 低（不在 DSH 内） | **1–3 天** | 跟原生应用 | 不满足「在 DSH 里使用」的视觉目标，但最快可用 |

**推荐组合**：先做 **C 的目录页**（1–3 天，马上有入口和套件页）→ 同时做 **A 的一个应用**（建议 WordCraft 或 VectorCraft）→ 成功后横向复制 A；B 仅用于「确实没有 Web 构建」的应用。

---

## 3. 推荐架构（路线 A）

```
┌─ DSH Renderer（Web 或 Desktop 同源）──────────────────────────────────────────┐
│  sidebar.panellist: [ArtCraft] ──click──▶ ctx.layout.selectPanel('artcraft-hub') │
│  main['artcraft-hub']                                                          │
│    └─ <GalleryPage>  目录（图标/版本/来源/更新状态）                             │
│         └─「打开」→ <EditorPage>                                                │
│              └─ <iframe src="/artcraft-hub/app/<key>/index.html">               │
│                    ▲ 同源（Web: http://127.0.0.1:port；Desktop: dsh-app://app） │
│                    │ 官方 Web 构建（静态站点，ESM + WASM）                        │
└────────────────────┼───────────────────────────────────────────────────────────┘
                     │ HTTP（同源）
┌─ DSH Host 插件（Node / Cordis）─▼───────────────────────────────────────────────┐
│  ctx.webServer.register({kind:'prefix', path:'/artcraft-hub', handler})         │
│    GET /artcraft-hub/            → 套件页静态资源（图标/样式，可选内联进 client） │
│    GET /artcraft-hub/app/<key>/* → 从缓存目录流式返回（index.html/js/wasm）      │
│    GET /artcraft-hub/api/catalog → 本地已安装 + 远端最新版本（缓存 ~5 分钟）      │
│    POST /artcraft-hub/api/install→ 下载/解压/校验/切换版本                       │
│  缓存目录：<DSH_HOME>/artcraft-hub/apps/<key>/<version>/                        │
│  可选：POST /api/run → 调 CLI `run`/MCP 工具（Agent 联动时再用）                │
└─────────────────────────────────────────────────────────────────────────────────┘
```

关键设计点：

1. **插件包不打包应用资产**。插件本身只有几百 KB；应用 Web 构建在首次打开时下载/构建到缓存目录。
2. **同源 iframe**，不另起端口：Web 是 `http://127.0.0.1:<port>`，Desktop 是 `dsh-app://app`（未知路径代理到 Host），两边都天然同源，避免 CSP/CORS/私有网络策略问题。
3. **WASM 由静态路由直接发**：官方 web 站点是普通静态站点（`host it on any static server`），不需要 ZCode 那种 MCP 资源分块桥。
4. **Agent 联动（后续）**：同一应用的 CLI MCP（`*-cli.exe mcp`）或 `--control` 连接；Web UI 与 Agent 是否共享同一文档，取决于是否要把「UI 里的编辑」和「Agent 的 command_run」绑到同一个引擎实例——这是后续阶段（见 §5 P3），不是 P0/P1 的阻塞项。

---

## 4. 更新模型（你关心的「会不会每次都要更新插件」）

**不会。** 核心：插件是「壳」，应用 Web 构建是「可独立更新的数据」。

| 层 | 内容 | 更新频率 | 谁负责 |
|---|---|---|---|
| L1 插件本体 | 导航、目录页、iframe 容器、路由、本地化、更新器 | 很低 | 只有 DSH API 变化 / 桥破坏 / 功能迭代时发版 |
| L2 应用 Web 运行时 | 官方 `*-web-<ver>.zip`（或本机构建产物） | 跟 ArtCraft 发版 | **插件内「检查更新」自动下载**；无需重装插件 |
| L3 原生应用/CLI | `F:\ArtCraft\*` | 跟 ArtCraft Launcher | 现有 Launcher 自动更新；插件只读版本号（仅 B 路线/Agent 工具需要） |

### 4.1 版本检查与更新流程

```
打开套件页 / 每 N 小时：
  1) GET https://api.github.com/repos/storytold/<app>/releases/latest（带缓存，避免 rate limit）
     或 releases.atom / 你的镜像；标记「可更新」
  2) 用户点「更新」：
       - 选资产：<app>-web-<ver>.zip（优先），否则源码构建
       - 下载 → 校验 sha256（releases 的 SHA256SUMS.txt / 元数据）
       - 解压到 <DSH_HOME>/artcraft-hub/apps/<key>/<ver>/（原子 rename）
       - 切换默认版本（保留上一版可回滚）
  3) 失败：保留旧版，显示原因，可重试
```

### 4.2 没有官方 web zip 怎么办

- **优先**：用官方源码本机构建一次（`cargo xtask` / `trunk build --release`），把产物缓存；脚本可参数化到「每个版本跑一次」。
- **或者**：插件发布你自己的「web 构建产物」到独立仓库/Release（注意 ArtCraft 品牌商标条款：fork/修改版要移除 `docs/brand/` 商标资源，代码是 MIT/Apache）。
- **兜底**：该应用走路线 B（控制通道远程内嵌）或 C（打开原生窗口）。

### 4.3 什么时候才真的需要更新插件本体

1. DSH 大版本 API/slot 变化（`engines.dsh` 不满足）。
2. iframe 内 Web 应用与 DSH 的桥（如果有自定义文件打开/保存协议）发生 breaking 变更。
3. 目录页/更新器/新应用接入等功能迭代。
4. 安全修复。

---

## 5. 实现路线（分阶段）

### P0 — 入口 + 套件目录页（1–3 天）

- 插件骨架：`package.json`（`dsh.bundle.patch` / `dsh.client`）、`cordis.patch.yml`、`lib/host.js`、`lib/client.js`、`locale/*`、`web/icon.svg`（已有 `artcraft-icon.svg`）。
- `lib/client.js`：`sidebar.panellist` 注册 `ArtCraft` 行（建议 `order: 6`，紧跟自媒体工作台）+ `main` 页面 `GalleryPage`。
- 目录数据：扫描 `F:\ArtCraft\*`（存在性、exe 版本信息）+ 可选 GitHub latest 检查（带缓存）。
- 「打开」先接：原生应用外窗（`spawn` exe）或 iframe 占位页（提示「该应用内嵌模块安装中」）。
- 验收：重载 DSH → 左侧出现 `ArtCraft` → 点开目录页（截图 2 的卡片网格）→ 打开应用有反馈；禁用插件后入口消失、无残留。

### P1 — 一个应用的完整内嵌（3–7 天，建议 WordCraft 或 VectorCraft）

1. 选应用，确认官方 Web 产物：
   - WordCraft：Release 里有 `wordcraft-web-<ver>.zip`，直接下载解压即可。
   - VectorCraft：本地 README 有 `apps/vectorcraft-web` + trunk；若 Release 无 web zip，本机 `trunk build --release` 生成一次。
2. `lib/host.js`：
   - `/artcraft-hub/app/<key>/*` 静态流式返回（正确 MIME：`.wasm` → `application/wasm`，支持 Range/缓存头）。
   - `/api/catalog`、`/api/install`（下载/解压/校验/切换）。
3. 前端 `EditorPage`：同源 iframe，占满主区（注意顶部 `--dsh-frame-top-clearance`）；加载中/失败重试 UI；关闭时卸载 iframe 释放 WASM 内存。
4. 验收：在 DSH 里打开 WordCraft Web，能新建/编辑/导出；Web 与 Desktop 两种 origin 都测；打开 2 个应用不串状态；关闭后内存回落。

### P2 — 横向多应用 + 更新器（1–2 周）

- 应用清单抽象：`{key, title, repo, assetPattern, exe, cli, quirks}`。
- 每个应用补一次冒烟；处理差异（PhotoCraft 图像格式、SoundCraft 音频、FilmCraft 大资产、GridCraft 表格…）。
- 更新器：检查/下载/校验/回滚/离线缓存；套件页显示「上次检查 X 分钟前 · 来源 GitHub Releases」。
- 可选：把 web zip 缓存目录做成可配置（默认 `<DSH_HOME>/artcraft-hub/apps`）。

### P3 — Agent 联动（2–4 周，可后置）

- 现状：Agent 已可通过 DSH 的 MCP 行使用 `*-cli.exe mcp`（headless 文档）。
- 若要「UI 里编辑 + Agent 同时改同一个文档」：插件 Host 持有一个引擎实例（CLI mcp 或 `--control` 连接），把 Agent 工具与 UI 都接到它；需要处理并发、取消、保存与文件锁。先做只读预览/命令驱动，再逐步开放。

---

## 6. 代码骨架

### 6.1 `package.json`

```json
{
  "name": "dsh-artcraft-hub",
  "version": "0.1.0",
  "description": "ArtCraft 套件中心：目录 + 内嵌官方 Web 版",
  "type": "module",
  "main": "lib/host.js",
  "icon": "web/icon.svg",
  "exports": {
    ".": "./lib/host.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  "files": ["lib", "web", "locale", "cordis.patch.yml", "README.md"],
  "sideEffects": ["./lib/client.js"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-locale"]
    },
    "compatibility": { "dshReleases": { "0.2.2-rc.1+": "compatible" } }
  },
  "engines": { "node": ">=20", "dsh": ">=0.2.2-rc.1 <0.3.0" },
  "peerDependencies": { "@deepseek-ai/cordis": ">=4.0.1 <5", "react": "^18.2.0" },
  "peerDependenciesMeta": { "@deepseek-ai/cordis": { "optional": true }, "react": { "optional": true } }
}
```

### 6.2 `cordis.patch.yml`

```yaml
- insert:
    - id: artcraft-hub
      name: 'dsh-artcraft-hub'
```

### 6.3 `lib/client.js`（导航 + 目录页 + iframe）

```js
window.__ModuleLoader__.load({
  id: 'dsh-artcraft-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ID = 'artcraft-hub'

    const Icon = ({ size }) =>
      h('img', { src: '/artcraft-hub/icon.svg', width: size ?? 18, height: size ?? 18, alt: '' })

    function Gallery() {
      const [apps, setApps] = React.useState([])
      const [open, setOpen] = React.useState(null)
      React.useEffect(() => {
        fetch('/artcraft-hub/api/catalog').then(r => r.json())
          .then(d => setApps(d.apps || [])).catch(() => {})
      }, [])
      if (open) return h(Editor, { app: open, onClose: () => setOpen(null) })
      return h('div', { style: { padding: 'var(--dsh-frame-top-clearance,48px) 32px 32px', overflow: 'auto', height: '100%' } },
        h('h1', null, 'ArtCraft 套件'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 16 } },
          apps.map(app => h('div', { key: app.key, style: { border: '1px solid #333', borderRadius: 14, padding: 16 } },
            h('b', null, app.title), h('span', null, ' v' + app.version),
            h('p', null, app.description || ''),
            h('button', { onClick: () => setOpen(app) }, app.installed ? '打开' : '安装并打开')))))
    }

    function Editor({ app, onClose }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        h('div', { style: { padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center' } },
          h('button', { onClick: onClose }, '← 套件'),
          h('span', null, app.title + ' ' + app.version)),
        h('iframe', {
          src: '/artcraft-hub/app/' + app.key + '/index.html',
          style: { flex: 1, border: 0, width: '100%', background: '#1e1e1e' },
          sandbox: 'allow-scripts allow-same-origin allow-forms allow-downloads allow-modals',
        }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const off = []
        off.push(ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ID }, Gallery)))
        off.push(ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: ID, order: 6, label: 'ArtCraft' }, Icon)))
        return () => off.forEach(f => { try { f() } catch {} })
      },
    }
  },
})
```

### 6.4 `lib/host.js`（静态服务 + 目录 + 安装）

```js
import { createReadStream } from 'node:fs'
import { stat, mkdir, writeFile, rename, readFile } from 'node:fs/promises'
import { join, extname, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

const ID = 'artcraft-hub'
const HOME = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'artcraft-hub')
const APPS = join(HOME, 'apps')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
}

function safeJoin(base, rel) {
  const p = resolve(base, '.' + (rel.startsWith('/') ? rel : '/' + rel))
  return p === base || p.startsWith(base + sep) ? p : null
}

async function serveFile(res, path) {
  try {
    const s = await stat(path)
    if (!s.isFile()) throw new Error('not a file')
    res.writeHead(200, {
      'content-type': MIME[extname(path)] || 'application/octet-stream',
      'content-length': s.size,
      'cache-control': 'public, max-age=3600',
    })
    createReadStream(path).pipe(res)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found')
  }
}

export const inject = ['webServer']

export function apply(ctx) {
  ctx.inject(['webServer'], (scoped) => {
    const server = scoped.webServer
    ctx.effect(() => server.register({
      kind: 'prefix',
      path: '/artcraft-hub',
      handler: async (req, res) => {
        // 鉴权：按 DSH 的方式拒绝非本机会话（参考 dsh-media-desk 的 helper）
        const url = new URL(req.url, 'http://localhost')
        const p = url.pathname
        if (p === '/artcraft-hub/api/catalog') {
          const body = await buildCatalog(ctx)          // 见下
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          return res.end(JSON.stringify(body))
        }
        if (p.startsWith('/artcraft-hub/app/')) {
          const rest = p.slice('/artcraft-hub/app/'.length)
          const [key, ...tail] = rest.split('/')
          const file = safeJoin(join(APPS, key), tail.join('/')) || safeJoin(join(APPS, key), 'index.html')
          return serveFile(res, file)
        }
        res.writeHead(404); res.end()
      },
    }), `${ID}: routes`)
  })
}

async function buildCatalog(ctx) {
  // 1) 扫描 F:\ArtCraft\* 的本机安装（可配置根目录）
  // 2) 读取 APPS 下已安装版本
  // 3) 可选：拉 GitHub latest（带缓存），标记可更新
  return { apps: [/* { key, title, version, installed, description } */] }
}
```

> 详细实现（下载 zip、sha256、解压、原子切换、GitHub 缓存）建议单独放 `lib/installer.js`；不要把 `F:\ArtCraft` 路径写死，做成插件设置项（默认 `F:\ArtCraft`）。

---

## 7. 风险与未决问题

| # | 风险 | 说明 / 对策 |
|---|---|---|
| 1 | **各应用 Web 构建的官方发布状态不一致** | WordCraft 已确认 Release 有 `wordcraft-web-<ver>.zip`；VectorCraft 本地 README 支持源码构建；其余应用需逐个确认（检查 Releases 或 `apps/*-web`）。缺产物的走「本机构建」或路线 B |
| 2 | **Web 版能力 < 原生版** | 打印、部分系统对话框、音频设备、字体等可能受限；在套件页标注「Web 内嵌版」并保留「用原生应用打开」按钮 |
| 3 | **WASM 体积/内存** | 单个应用 Web 包可达数十~上百 MB；用流式/缓存/关闭即卸载；打开多个应用注意内存 |
| 4 | **文件保存** | 浏览器内保存走下载/File System Access API；「保存回 workspace」需要额外做（文件选择器 + 插件路由原子写），P1 可先导出到下载目录 |
| 5 | **GitHub API 限流** | 匿名 60 次/小时；缓存 latest 结果（≥1 小时），失败时用本地版本；可选 GitHub Token 配置 |
| 6 | **routes 未鉴权** | DSH 的 webServer 路由要自己做 `ctx.connection.requestRejection`/admit（参考 dsh-media-desk host.js） |
| 7 | **桌面 origin 差异** | Desktop 是 `dsh-app://app`、Web 是 `http://127.0.0.1:port`，P1 必须双端冒烟；不要依赖 cookie/特殊响应头 |
| 8 | **品牌商标** | 代码 MIT/Apache，但 ArtCraft 品牌名/图标是商标；若分发修改版需移除 `docs/brand/` 资产。内部分发/自用按官方 NOTICE 保留 |
| 9 | **首次构建耗时** | Rust/Trunk 构建单个应用可能 10–30 分钟（首次依赖编译更久）；建议优先用官方 web zip，构建只作为兜底 |
| 10 | **iframe 内键盘/剪贴板** | 同源 iframe 一般可用；但快捷键可能被 DSH 捕获，需要时给 iframe 加 `allow` 或 `focus()` 逻辑 |

---

## 8. 证据索引

- ArtCraft 官方能力（本机与官方仓库）：
  - `F:\ArtCraft\VectorCraft\README.md`：`cargo run --release -p vectorcraft -- --control 7979`、`vectorcraft-cli mcp`、`cd apps/vectorcraft-web && trunk build --release`、`Everywhere … same UI in the browser`。
  - `https://github.com/storytold/wordcraft`（README）：`in the browser via WebAssembly`；`apps/wordcraft-web`；Releases 表格 **`wordcraft-web-<ver>.zip`：Static site，host it on any static server**；`wordcraft --control 7981`、`wordcraft-cli mcp --connect 127.0.0.1:7981`；`screenshot/click/key` 工具。
  - 本机 `rustc 1.97.1` / `cargo 1.97.1`；`trunk` 可用 `cargo install trunk` 安装。
- DSH 扩展点（只读 asar 文档）：
  - `dsh-client-ui-sidebar/README.md`（`sidebar.panellist`）
  - `dsh-client-ui-layout/README.md`（`main` keyed slot / `ctx.layout.selectPanel`）
  - `dsh-host-webserver/README.md`（`register({kind:'exact'|'prefix'})` / 鉴权）
  - `dsh-client-ui-sidebar-browser/README.md`（同源 iframe / loopback 策略）
  - 本机真实插件：`dsh-media-desk`（导航行+页面）、`dsh-context`（order/门控）、`dsh-usage-hud`（手写 client bundle + Host 路由）
- 本工作区：`artcraft-icon.svg`（可复用为图标）；`docs/`（本文）。

---

## 附录：背景（不参与实现）

同类宿主软件曾用「把应用编译成 Web 版 + 宿主面板渲染」的方式实现侧边栏内嵌；本方案不需要了解或依赖它的任何产物——我们直接用 ArtCraft 官方 Web 构建 + DSH 自己的 slot/iframe 能力。若某应用没有官方 Web 产物，也不会去「借」别人的编译结果，而是本机构建或退回「控制通道远程内嵌/原生窗口」。
