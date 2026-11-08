# dsh-web-app：通用 Web 应用宿主插件（设计稿）

> 版本：v0.1 设计稿（2026-11-08）
> 背景：先做了 ArtCraft 套件内嵌的可行性，现按用户提议升级为通用插件——**用户自己上传 Web 包即可在 DSH 里打开使用**，ArtCraft 只是第一个「应用来源」，不是插件本身。
> 结论：**可行，而且推荐这么设计**；通用壳和 ArtCraft 方案约 80% 重合，先做通用壳不会浪费。

---

## 0. TL;DR

| 问题 | 结论 |
|---|---|
| 能做成通用「上传 Web 包即用」的插件吗？ | **能。** 任意静态 Web 应用（`index.html` + JS/CSS/WASM）都可以：上传 zip → 解压到缓存 → 插件起一个本地 HTTP 服务 → DSH 主区 `iframe` 打开。 |
| 和 ArtCraft 方案冲突吗？ | 不冲突。**分层**：`dsh-web-app` 是宿主/运行时；ArtCraft 是「来源适配器」（自动从官方 GitHub Releases 拉 Web 包）。以后还能加「从 URL 安装」「开发者本地目录」等来源。 |
| 最大的坑是什么？ | **安全隔离**。用户上传的是任意网页代码，绝对不能让它和 DSH 同源运行（否则可以读 DSH 的 API/存储）。必须：独立 origin + sandbox iframe + 最小权限 + 上传校验。 |
| 推荐路线 | **P0 通用壳**（上传/列表/打开/删除，独立 origin + sandbox）→ **P1 安全加固**（zip 校验、权限、CSP、大小限制）→ **P2 ArtCraft 来源适配器**（版本检查/更新）→ P3 权限桥（文件保存/剪贴板等）。 |

---

## 1. 定位：宿主 + 来源

```
dsh-web-app（插件）
├─ 运行时（核心，通用）
│   ├─ 应用库：安装/列表/删除/启用/版本
│   ├─ 静态托管：独立 origin 的 HTTP 服务（loopback）
│   ├─ 打开方式：主区 iframe（默认）/ 右侧浏览器标签（更隔离）
│   └─ 清单与权限：dsh-web-app.json
├─ 来源（可插拔）
│   ├─ local-upload：用户上传 zip / 选择本地目录
│   ├─ artcraft：从 ArtCraft 官方 GitHub Releases 拉 *-web-<ver>.zip
│   └─（以后）url / 其他应用市场 / 开发者热更目录
└─ 管理界面：侧边栏「应用」入口 → 应用库页（ArtCraft 套件 / 我的应用）
```

这样：
- 用户上传的第三方 Web 应用 → local-upload 来源；
- ArtCraft 套件 → artcraft 来源（自动下载官方 Web 构建）；
- 二者共用同一套「安装 → 托管 → 打开 → 更新」流程，不再写两套代码。

---

## 2. 应用包规范（`dsh-web-app.json`）

放在 zip 根目录（可选；缺省时用 zip 名/`index.html` 的 `<title>` 兜底）：

```json
{
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "entry": "index.html",
  "icon": "icon.svg",
  "permissions": ["downloads", "clipboard-write"],
  "network": true,
  "window": { "mode": "main" }
}
```

约束：
- `entry` 必须是包内相对路径，且解析后仍在包目录内（防 zip-slip / `..` / 绝对路径 / 符号链接）。
- 只接受静态文件（HTML/JS/CSS/WASM/图片/字体/音视频/JSON）；**不执行任何服务端代码**。
- 单包大小上限（建议默认 512 MB，可配置）；解压后总大小上限、文件数上限。
- 校验：解压后必须有 `entry` 文件；拒绝 `node_modules`/`.git` 等可选过滤。
- `permissions` 是声明式最小权限；未声明的能力一律拒绝（见 §4）。

---

## 3. 存储与托管

```
<DSH_HOME>/dsh-web-app/
  apps/<id>/<version>/          # 解压后的静态站点（不可变）
  apps/<id>/current              # 指向当前版本的指针（原子切换/回滚）
  tmp/                           # 上传中的临时 zip（完成后 rename）
  state.json                     # 应用库元数据（来源、版本、权限、安装时间）
```

托管方式（关键：**与 DSH 页面不同源**）：

- 插件 Host 用 Node 起一个**只绑定 127.0.0.1** 的 HTTP 服务（端口可配置，默认自动分配），只服务 `apps/` 目录。
- 每个应用用 **独立 origin** 隔离：
  - 首选：`http://<app-id>.localhost:<port>/`（Chromium/Electron 会把 `*.localhost` 解析到 127.0.0.1，且不同子域 = 不同 origin，单端口即可隔离存储）；
  - 兜底：每个应用一个随机 loopback 端口（`http://127.0.0.1:<appPort>/`），应用少时完全够用。
- 响应头：正确的 MIME（`.wasm` → `application/wasm`）、`Cache-Control`、`X-Content-Type-Options: nosniff`、可选 CSP；**不设置 DSH 的 cookie**。
- 同一服务 **绝不** 反向代理 DSH 的 `/api`，避免用户应用借道访问 DSH。

> 对比：DSH 自带的右侧 Browser 标签（`dsh-client-ui-sidebar-browser`）就是「loopback + iframe/webview + 拒绝下载/权限」的安全载体；我们主区内嵌时要复刻它的安全边界，而不是把用户代码塞进 DSH 同源路由。

---

## 4. 打开方式与安全模型（最重要的部分）

### 4.1 默认：主区 iframe（独立 origin + sandbox）

```html
<iframe
  src="http://<app-id>.localhost:<port>/"
  sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals"
  referrerpolicy="no-referrer"
  allow="clipboard-write; fullscreen"
/>
```

- **不同 origin**：应用拿不到 DSH 的 cookie/localStorage/DOM，也调不到 DSH 的 `/api`（跨源 + 无凭据）。
- `allow-same-origin` 保留是为了让应用自己的 localStorage/IndexedDB（部分应用需要）；因为它与 DSH 不同源，所以不破坏隔离。
- 默认拒绝：弹窗、顶层导航、摄像头/麦克风/定位等（按 manifest 与用户授权再开）。
- 显示安全提示：首次打开「第三方应用」时提示来源与权限，可勾选「以后信任」。

### 4.2 可选：右侧 Browser 标签（更强隔离）

对不信任的应用，提供「在侧边浏览器打开」：复用 DSH 的 Browser 标签（Desktop 是 Electron `<webview>` + 独立 session，Web 是 sandbox iframe），下载/权限默认拒绝。代价是它属于右栏，不是主区大页面。

### 4.3 权限桥（P3）

应用通过 `postMessage` 向宿主请求能力；宿主校验 manifest 声明 + 用户授权后执行：

| 能力 | 说明 |
|---|---|
| `downloads` | 应用内 `<a download>`/Blob 下载（默认可用，浏览器能力） |
| `files.open` | 宿主弹 DSH 文件选择器，把 `File`/句柄传给应用（需用户手势） |
| `files.save` | 宿主保存到 workspace（路径校验、原子写）或弹「另存为」 |
| `clipboard-read/write` | 剪贴板读写 |
| `workspace.read` | 读当前 workspace 文件（默认拒绝，需显式授权） |

权限桥是后续增强；P0 先依赖浏览器原生能力（下载、`<input type=file>`、File System Access API）。

---

## 5. 上传与安装流程

```
应用库页「上传 Web 应用」
  → <input type=file accept=".zip">
  → POST /web-apps/api/upload（同源、带 DSH 会话凭据、流式 multipart/octet-stream）
  → Host：大小/类型校验 → 解压到 tmp（防 zip-slip）→ 校验 manifest/entry
  → 原子 rename 到 apps/<id>/<version>/ → 写 state.json
  → 返回 { id, name, version }
  → 应用库出现新卡片，「打开」进入主区 iframe
```

- 上传接口必须鉴权（`ctx.connection.requestRejection`/admit），并限流、限大小。
- 大包（几百 MB）走流式写入，不要整包读进内存。
- 失败清理 tmp；同名同版本可「覆盖安装」；版本冲突提示。
- 设备端「从本地目录安装」（开发用）：让用户选一个含 `index.html` 的目录，直接软链/复制。

---

## 6. ArtCraft 作为第一个来源

无需为 ArtCraft 单独写一套运行时，只需要一个 **来源适配器**：

```json
{
  "source": "artcraft",
  "apps": [
    {
      "id": "wordcraft",
      "name": "WordCraft",
      "repo": "storytold/wordcraft",
      "assetPattern": "wordcraft-web-{version}.zip",
      "nativeExe": "F:\\ArtCraft\\WordCraft\\wordcraft.exe"
    }
  ]
}
```

- 版本检查：GitHub Releases latest（缓存 ≥1 小时，避免限流）。
- 安装/更新：下载 `*-web-<ver>.zip` → sha256 校验（`SHA256SUMS.txt`）→ 解压到同一 `apps/<id>/<ver>/` → 切换 current。
- 没有官方 Web 包的应用：标记「需构建」，提供一键 `cargo xtask`/`trunk build` 脚本（本机 `rustc/cargo` 已具备）或退回「打开原生应用 / 控制通道远程内嵌」。
- ArtCraft 官方 Web 包的品牌/许可：代码 MIT/Apache；品牌商标归 ArtCraft，按其 NOTICE 使用（内部分发/自用保留 notices；对外分发修改版需移除品牌资源）。

---

## 7. 实现路线

| 阶段 | 内容 | 估时 | 验收 |
|---|---|---|---|
| **P0 通用壳** | 插件骨架（nav + 应用库页）、zip 上传/解压/校验、独立 origin 静态托管、主区 sandbox iframe、删除/重命名 | **3–5 天** | 上传任意静态站点 zip → 打开可用；刷新/重启后仍在；删除后不可访问 |
| **P1 安全加固** | 独立 origin（子域/端口池）、manifest 权限、CSP、大小/数量限制、上传鉴权与限流、首次信任提示、错误页 | **1 周** | 恶意 zip（zip-slip、超大、脚本读 DSH API）被拦截；DSH 会话数据不可达 |
| **P2 ArtCraft 来源** | GitHub Releases 检查/下载/校验/更新/回滚；套件页分区（ArtCraft 套件 / 我的应用） | **1 周** | ArtCraft 应用一键安装/更新；版本可回滚 |
| **P3 权限桥/增强** | files.open/save、workspace、剪贴板、下载；多窗口；应用管理（禁用、清缓存） | **1–2 周** | 应用能保存回 workspace；权限弹窗符合预期 |

**如果只想要 ArtCraft**：P0 通用壳 + P2 ArtCraft 来源即可，P1 的安全项按需裁剪（ArtCraft 官方包可视为可信，风险低于任意用户上传）。

---

## 8. 与「只做 ArtCraft」的差异

| 维度 | ArtCraft-only | 通用 dsh-web-app |
|---|---|---|
| 运行时 | iframe + 静态托管 | 相同 |
| 来源 | 写死 ArtCraft | 来源适配器（上传/ArtCraft/URL…） |
| 更新 | GitHub Releases | 相同 + 用户应用手动版本 |
| 安全 | 可信来源，风险低 | **必须做隔离/校验/权限**（主要增量） |
| 工作量 | 约 1–2 周 | +1 周安全加固，但可复用 |

---

## 9. 风险与待验证

1. **`*.localhost` 子域在 Windows Electron/Web 的具体行为**：需要 30 分钟 spike 验证（DNS 解析、origin 隔离、cookie 隔离）；不行就退回「每应用一个端口」。
2. **同源 iframe 的会话隔离**：DSH 页面是 `dsh-app://app`（Desktop）/`http://127.0.0.1:port`（Web）；对 `127.0.0.1:<appPort>` 的 iframe 加载是否被 Chromium 私有网络策略拦截，需要实测。
3. **存储配额**：浏览器对每个 origin 的 localStorage/IndexedDB 有配额；应用多时需提示/清理。
4. **大包上传**：几百 MB 的 zip 在桌面端走 DSH 代理是否稳定（`dsh-app://` 代理会剥 `content-length` 等，需要流式 + 分片或走独立 loopback 上传端口）。
5. **权限桥安全**：postMessage 必须校验 `event.origin`、加 nonce；只允许白名单方法。
6. **恶意应用**：禁网/沙箱/权限提示是策略问题，不是纯技术能完全解决；v1 明确「只安装你信任的 Web 包」。

---

## 10. 建议

- **推荐做通用 `dsh-web-app`**：ArtCraft 只是第一个来源，用户上传是第二个；代码复用度高，后续扩展（URL 安装、其他套件）零成本。
- **但不要跳过安全设计**：通用化的核心增量就是「把任意网页安全地关进独立 origin」。先做 P0 骨架 + P1 的关键隔离项，再上 ArtCraft 来源。
- 如果你更想先看到 ArtCraft 效果：用同一套壳，先只实现 artcraft 来源（无需上传/权限），把 P0 里的「上传」换成「下载官方 web 包」，其余不变——之后再加用户上传即可，**不会返工**。
