# dsh-web-app

[![npm version](https://img.shields.io/npm/v/dsh-web-app.svg)](https://www.npmjs.com/package/dsh-web-app)
[![license](https://img.shields.io/npm/l/dsh-web-app.svg)](./LICENSE)

在 DeepSeek Harness（DSH）里**安装并运行静态 Web 应用**的插件：

- 左侧导航新增「**应用**」入口；
- 应用库页：已安装应用（打开 / 打开安装目录 / 更新 / 删除）+ 内置套件 + 上传自己的 zip；
- 「打开」在主区用同源 `iframe` 承载 Web 应用（P0 取舍，见下）；
- 静态托管、解压、路径校验都在 Host 半身完成，浏览器半身只负责 UI。

> 当前版本 **0.3.3**：可在 DSH「插件 → 添加插件」里直接输入包名 `dsh-web-app` 安装；包含 3 个内置套件（共 19 个应用）、「打开安装目录」、浅色/深色主题适配；文档里的路径已改成通用写法（`<DSH_HOME>` / `<本仓库>`）。安全隔离（独立 origin、权限、CSP）仍在 P1。

---

## 界面

应用库：已安装应用 + 套件入口（卡片上有应用数 / 已安装数 / 可更新数）：

![应用库：已安装应用与套件卡片](https://raw.githubusercontent.com/BAISD007/dsh-web-app/main/docs/screenshots/apps.png)

套件子页：点「查看套件」进入，只列这个套件里还没安装的应用，一键安装：

![创作套件子页](https://raw.githubusercontent.com/BAISD007/dsh-web-app/main/docs/screenshots/suite-artcraft.png)

---

## 安装

### 在 DSH 里一键安装（推荐）

DSH → 左侧「**插件**」→「**添加插件**」→ 输入包名 **`dsh-web-app`** → 安装源选「默认」或「npm 官方源」/「中国大陆镜像源」→ 安装。

- 输入框接受这些形式：npm 包名（`dsh-web-app`，需要锁版本就写 `dsh-web-app@0.3.x`）、GitHub 仓库地址（`https://github.com/BAISD007/dsh-web-app` 或 `github:BAISD007/dsh-web-app`）、`.tgz` 地址，或本机插件的绝对路径。
- 安装前会先查注册表，校验 `engines.dsh` 与 peer 依赖；装好后默认启用，没有 HMR 时会提示重启一次 DSH。
- 已经用下面的「本地 link 安装」装过的，先在插件页「卸载」再按上面安装，否则会提示「该插件已安装」。

> **路径占位符**（下文用它们代替具体路径，换台机器也能照着做）：
> - `<DSH_HOME>`：DSH 的用户目录。默认 `~/.dsh`，Windows 上是 `%USERPROFILE%\.dsh`；如果设了 `DSH_HOME` 环境变量，就用它的值（插件自己的数据也在它下面）。
> - `profiles/desktop`：desktop 这个 profile 的目录；用别的 profile 名时换成对应目录。
> - `<本仓库>`：你 clone 或解压这个项目的绝对路径，放在哪里都可以。

### 手动从 npm 安装（等价，适合锁版本 / 离线）

```powershell
# 1) 进入 DSH 的 desktop profile 目录
cd <DSH_HOME>/profiles/desktop        # 例如 ~/.dsh/profiles/desktop
npm i dsh-web-app

# 2) 把 "dsh-web-app" 加进同目录 package.json 的 dsh.profile.bundles
#    形如："dsh": { "profile": { "bundles": ["dsh-web-app"] } }

# 3) 重启 DSH，左侧出现「应用」
```

### 本地开发（link 安装）

在仓库根目录运行（脚本会自动找 `<DSH_HOME>/profiles/desktop`，并备份 profile 的 `package.json`）：

```powershell
node scripts/install-profile.mjs
# 重启 DSH 后生效；卸载用：
# node scripts/install-profile.mjs --uninstall
```

要装到别的 profile，用环境变量指定（PowerShell 示例）：

```powershell
$env:DSH_PROFILE_DIR = "<DSH_HOME>\profiles\<profile 名>"   # 或设 DSH_PROFILE_NAME=<profile 名>
node scripts/install-profile.mjs
```

<details>
<summary>手动安装（等价步骤）</summary>

1. 在 DSH 的 desktop profile 里登记依赖与 bundle。
   编辑 `<DSH_HOME>/profiles/desktop/package.json`：

   ```json
   "dependencies": {
     "dsh-web-app": "link:<本仓库的绝对路径，用 / 分隔>"
   },
   "dsh": {
     "profile": {
       "bundles": [ "...", "dsh-web-app" ]
     }
   }
   ```

2. 让 profile 的 `node_modules` 能解析到本包（Windows 用 junction；或用 `pnpm add link:`）：

   ```powershell
   cmd /c mklink /J "<DSH_HOME>\profiles\desktop\node_modules\dsh-web-app" "<本仓库的绝对路径>"
   ```

3. **重启 DSH**（插件图在启动时读取）。左侧应出现「应用」入口。

</details>

### 回滚

删除 profile `package.json` 里的 `dsh-web-app` 两项 + 删除 junction，重启即可：

```powershell
cmd /c rmdir "<DSH_HOME>\profiles\desktop\node_modules\dsh-web-app"
```

若启动异常，也可先在 `package.json` 的 `dsh.profile.bundles` 里去掉 `dsh-web-app`，再重启。

---

## 使用

**从套件安装**

1. 左侧点「应用」，往下找到「套件」分区（每个套件一张卡片，卡片上显示应用数 / 已安装数 / 可更新数）；
2. 点进套件 → 对还没安装的应用点「安装」；
3. 回到「已安装」，点「打开」在主区 iframe 里运行；「打开目录」直接在文件管理器里定位它的安装文件夹。

**上传自己的应用**

1. 右上角「上传应用」；
2. 选择一个包含 `index.html` 的 **zip**（静态站点，最大 512 MiB）；
3. 卡片出现后点「打开」，应用在主区 iframe 中运行；
4. 「删除」移除应用目录。

### 可选的 `dsh-web-app.json`（放在 zip 根目录）

```json
{
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "entry": "index.html",
  "icon": "icon.svg",
  "description": "一句话介绍",
  "permissions": ["downloads"]
}
```

没有清单时：`id` 取 zip 文件名，`name` 同 id，`version` 默认 `1.0.0`，入口默认根目录 `index.html`。

### 数据位置

```
<DSH_HOME>/web-apps/
  apps/<id>/      # 解压后的静态站点 + .dsh-app-meta.json
  tmp/            # 上传临时文件
```

`DSH_HOME` 默认是 `~/.dsh`：Windows 上即 `%USERPROFILE%\.dsh`；可以用环境变量 `DSH_HOME` 指到别的盘或目录。界面上的「打开目录」就是在系统文件管理器里打开 `apps/<id>/`。应用自己的 localStorage / IndexedDB 存在 DSH 渲染进程里，不在该目录；迁移时拷走整个 `web-apps` 目录即可。

---

## 图标规格（侧边栏导航行）

当前侧边栏图标使用仓库根目录的 `Package.svg`（已转成内联组件，`stroke="currentColor"`）：

- 画布：`viewBox="0 0 24 24"`；
- 线宽：`stroke-width="1.5"`，圆角端点/拐角 `stroke-linecap/linejoin="round"`；
- 填充：`fill="none"`，`stroke="currentColor"`（跟随主题明暗，**不要用固定黑色**，深色主题会看不见）；
- 显示尺寸：侧边栏展开 **16px**、收起 **18px**（组件收到 `{ size, active }`）；
- 视觉线宽 ≈ 1.5 × 16/24 = **1.0px**。

`web/icon.svg` 是**插件列表用**的彩色应用图标（64×64，渐变底 + 白色 Package 线条），与侧边栏线条图标分开。

> 配色坑：深色主题里 `--dsw-alias-brand-primary` 解析为中性近白色（`--dsw-static-neutral-bluish-1000`），**不是品牌蓝**。填充按钮请直接用 `#4d6bfe`，否则会出现「白底白字」。

---

## 安全说明（P0）

- 应用与 DSH **同源**托管（`/web-apps/app/<id>/`），iframe 的 sandbox 保留了 `allow-same-origin`（否则应用存储会坏）。
- 这意味着：**只安装你信任的 Web 包**。同源应用理论上可以访问 DSH 页面与接口。
- P1 计划：应用改由独立 loopback origin 托管（`*.localhost` 子域或独立端口），iframe 去掉 `allow-same-origin`，补权限声明与 CSP；届时 ArtCraft 等可信来源可保持内嵌，未签名来源默认更强隔离。

## 内置套件（3 个 / 19 个应用）

「应用」页下方是套件卡片，点进去只列**还没安装**的应用。版本检查读 `https://github.com/<owner>/<repo>/releases/latest` 的 302 跳转拿 tag（**不调用 GitHub API，不消耗 60 次/小时限额**，Host 侧缓存 10 分钟）。

| 套件 | 应用 | 来源 |
| --- | --- | --- |
| 创作套件（15） | WordCraft、GridCraft、DeckCraft、DesignCraft、FigCraft、VectorCraft、PhotoCraft、LightCraft、TextureCraft、FilmCraft、EffectCraft、SoundCraft、PdfCraft、CADCraft、CraftAnything | [storytold](https://github.com/storytold) 官方 Web 构建 `<app>-web-<ver>.zip` |
| 实用工具套件（2） | CyberChef（数据编解码 / 加解密 / 哈希）、PDF.js（Mozilla PDF 阅读器） | gchq/CyberChef、mozilla/pdf.js 的 Releases |
| 复古游戏套件（2） | TIC-80（像素幻想主机）、Ruffle（Flash 播放器，把 `.swf` 拖进去） | nesbox/TIC-80、ruffle-rs/ruffle 的 Releases |

- 安装：下载 Release 里的静态包（3–80 MB）→ 纯 JS 解压 → 拍平单层目录 → 自动识别入口（`index.html`，或根目录里唯一的 html；PDF.js 显式用 `web/viewer.html`）。
- 更新：上游发新版后，卡片上出现「可更新 vX.Y.Z」和「更新到 vX.Y.Z」，点一下就换版本，**不需要重装 DSH 插件**。
- Ruffle 官方只发播放器库、不发页面，插件用内置壳页 `web/shells/ruffle.html` 当入口，拖入 `.swf` 即播。
- ArtCraft Web 包自带 `HOSTING.md`：`.wasm` 用 `application/wasm`、`.js` 用 `text/javascript`、index.html `no-cache`、不需要 COOP/COEP——本插件已按此服务，并给 iframe 加了 `fullscreen/autoplay/clipboard` 权限。
- 新增套件只需要改 `lib/host.js` 里的 `SUITES`：填仓库、资产名模板（`{key}` / `{version}`）或资产名正则、入口、可选壳页即可。

## 已实现 / 未实现

- ✅ 上传 zip、解压、路径穿越/符号链接/大小校验、列表、打开、删除、静态托管（含 Range/MIME）
- ✅ 侧边栏「应用」入口 + 主区应用库页
- ✅ 3 个内置套件：版本检查 + 一键安装/更新（GitHub Releases 静态包，自动识别入口，支持内置壳页）
- ✅ 「打开目录」：调用系统文件管理器定位 `apps/<id>/`
- ✅ 浅色 / 深色主题适配：卡片边框走 DSH 主题 token（`border-l2` + 轻阴影），两种主题下都清晰
- ⏳ 独立 origin 隔离、权限桥（文件打开/保存）、上传分包、压缩传输（gzip/brotli）

---

## 发布（维护者）

- npm：<https://www.npmjs.com/package/dsh-web-app>
- GitHub：<https://github.com/BAISD007/dsh-web-app>

以下都在仓库根目录操作。首次推到 GitHub（需要一次 `gh auth login`；仓库已存在就跳过 create）：

```powershell
gh auth login
gh repo create <你的用户名>/dsh-web-app --public --source . --remote origin --push
```

之后日常：

```powershell
git add -A
git commit -m "..."
git push && git push --tags      # 发版后记得把 tag 也推上去
```

发版到 npm：

```powershell
npm version patch        # 或 minor / major
npm publish
```

> `package.json` 里用 `publishConfig.registry = https://registry.npmjs.org/` 固定了发布地址，
> 所以即使你的 `~/.npmrc` 默认 registry 是 npmmirror 这类只读镜像，`npm publish` 也会发到官方源；
> 也可以显式写 `npm publish --registry=https://registry.npmjs.org`。
> npm 11.15+ 对新包有「processing / staged」阶段：`npm publish` 返回成功后再等 1–2 分钟，
> `npm view dsh-web-app version` 才会看到新版本。
