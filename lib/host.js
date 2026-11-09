/**
 * dsh-web-app — Host half.
 *
 * 通用 Web 应用宿主：上传/安装 zip 静态站点 → 通过 DSH 同源路由托管 → 主区 iframe 打开。
 *
 * 设计约束（P0）：
 *  - 只接受静态文件，服务端不执行任何用户代码。
 *  - 上传/删除接口必须经过 DSH connection 鉴权（webServer 不会代劳）。
 *  - 路径全部做前缀校验，拒绝 zip-slip、绝对路径、符号链接。
 *  - 纯 JS 解压（不依赖系统 tar/unzip），在受限环境里也能工作。
 *  - Web 应用与 DSH 同源（P0 取舍）：只安装可信 Web 包；P1 会切到独立 origin。
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, writeFile, rm, rename, readdir, stat } from 'node:fs/promises'
import { join, extname, resolve, sep, isAbsolute, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { inflateRawSync, gzip, brotliCompress, constants as zlibConstants } from 'node:zlib'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const gzipAsync = promisify(gzip)
const brotliAsync = promisify(brotliCompress)

const PLUGIN = 'dsh-web-app'
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const ROOT = join(HOME, 'web-apps')
const APPS = join(ROOT, 'apps')
const SAVES = join(ROOT, 'saves')
const TMP = join(ROOT, 'tmp')
const META_FILE = '.dsh-app-meta.json'

const MAX_UPLOAD = 512 * 1024 * 1024 // 512 MiB（zip 文件）
const MAX_FILES = 20000
const MAX_TOTAL = 2 * 1024 * 1024 * 1024 // 解压后 2 GiB
const MAX_ENTRY = 512 * 1024 * 1024 // 单文件解压后上限

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

/**
 * 值得压缩的文本类扩展名。图片 / 音视频 / wasm 本身已压缩，压了反而费 CPU。
 * 压缩结果按「文件 + mtime + 大小 + 编码」缓存在内存里（上限 48 MiB，LRU）。
 */
const COMPRESSIBLE = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json', '.map', '.svg', '.txt', '.xml'])
const COMPRESS_MIN_BYTES = 1024
const COMPRESS_CACHE_MAX = 48 * 1024 * 1024
const compressCache = new Map()
let compressCacheBytes = 0

function compressCacheGet(key) {
  const hit = compressCache.get(key)
  if (!hit) return null
  compressCache.delete(key)
  compressCache.set(key, hit)
  return hit
}

function compressCacheSet(key, body) {
  compressCache.set(key, body)
  compressCacheBytes += body.length
  while (compressCacheBytes > COMPRESS_CACHE_MAX && compressCache.size > 1) {
    const oldest = compressCache.keys().next().value
    const dropped = compressCache.get(oldest)
    compressCache.delete(oldest)
    compressCacheBytes -= dropped ? dropped.length : 0
  }
}

function pickEncoding(req) {
  const accept = String(req.headers['accept-encoding'] || '').toLowerCase()
  if (accept.includes('br')) return 'br'
  if (accept.includes('gzip')) return 'gzip'
  return null
}

async function compressFile(file, info, encoding) {
  const key = `${file}:${info.mtimeMs}:${info.size}:${encoding}`
  const cached = compressCacheGet(key)
  if (cached) return cached
  const raw = await readFile(file)
  // brotli 默认质量 11 太慢；5 对静态站点已经比 gzip 小一截
  const body = encoding === 'br'
    ? await brotliAsync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
    : await gzipAsync(raw, { level: 6 })
  compressCacheSet(key, body)
  return body
}

/**
 * 内置套件目录。
 *
 * 每个应用指向一个 GitHub 仓库的 Release（不放二进制、不依赖第三方服务）：
 *  - asset：资产名模板，`{key}` 是应用 key，`{version}` 是 tag 去掉 v 后的版本号；
 *  - assetRe：资产名不规则时（例如哈希命名、版本号只写到 x.y），改用正则从发布页里挑；
 *  - entry：入口 html，缺省会依次找 index.html / 根目录唯一的 html；
 *  - shell：仓库发布里不含页面时（如 Ruffle 只发播放器库），用插件内置壳页当入口。
 */
const SUITES = [
  {
    key: 'artcraft',
    name: '创作套件',
    badge: 'ArtCraft',
    tagline: '官方 Web 版：写作、表格、演示、设计、图像、影音、CAD、3D',
    homepage: 'https://github.com/storytold',
    apps: [
      { key: 'wordcraft', name: 'WordCraft', description: '文字处理与文档设计', repo: 'storytold/wordcraft', asset: '{key}-web-{version}.zip' },
      { key: 'gridcraft', name: 'GridCraft', description: '电子表格与数据', repo: 'storytold/gridcraft', asset: '{key}-web-{version}.zip' },
      { key: 'deckcraft', name: 'DeckCraft', description: '演示文稿与幻灯片', repo: 'storytold/deckcraft', asset: '{key}-web-{version}.zip' },
      { key: 'designcraft', name: 'DesignCraft', description: '页面排版与出版', repo: 'storytold/designcraft', asset: '{key}-web-{version}.zip' },
      { key: 'figcraft', name: 'FigCraft', description: '界面设计与原型', repo: 'storytold/figcraft', asset: '{key}-web-{version}.zip' },
      { key: 'vectorcraft', name: 'VectorCraft', description: '矢量插画', repo: 'storytold/vectorcraft', asset: '{key}-web-{version}.zip' },
      { key: 'photocraft', name: 'PhotoCraft', description: '图像编辑（图层、蒙版、PSD）', repo: 'storytold/photocraft', asset: '{key}-web-{version}.zip' },
      { key: 'lightcraft', name: 'LightCraft', description: '非破坏性照片编辑', repo: 'storytold/lightcraft', asset: '{key}-web-{version}.zip' },
      { key: 'texturecraft', name: 'TextureCraft', description: '3D 材质与纹理绘制', repo: 'storytold/texturecraft', asset: '{key}-web-{version}.zip' },
      { key: 'filmcraft', name: 'FilmCraft', description: '视频剪辑、调色与声音', repo: 'storytold/filmcraft', asset: '{key}-web-{version}.zip' },
      { key: 'effectcraft', name: 'EffectCraft', description: '动态图形与视觉特效', repo: 'storytold/effectcraft', asset: '{key}-web-{version}.zip' },
      { key: 'soundcraft', name: 'SoundCraft', description: '音频录制与编辑', repo: 'storytold/soundcraft', asset: '{key}-web-{version}.zip' },
      { key: 'pdfcraft', name: 'PdfCraft', description: 'PDF 阅读、整理与保护', repo: 'storytold/pdfcraft', asset: '{key}-web-{version}.zip' },
      { key: 'cadcraft', name: 'CADCraft', description: '计算机辅助设计与制图', repo: 'storytold/cadcraft', asset: '{key}-web-{version}.zip' },
      { key: 'craft-anything', name: 'CraftAnything', description: '拆解任意软件，动手复刻一个自己的', repo: 'storytold/craft-anything', asset: '{key}-web-{version}.zip' },
    ],
  },
  {
    key: 'tools',
    name: '实用工具套件',
    badge: '实用工具',
    tagline: '数据编解码、哈希加解密、PDF 阅读，纯本地运行',
    apps: [
      {
        key: 'cyberchef',
        name: 'CyberChef',
        description: '数据编解码、加解密、哈希、解压、图片处理…… 一个页面全都有（GCHQ 官方版）',
        repo: 'gchq/CyberChef',
        assetRe: /^CyberChef_.*\.zip$/i,
        homepage: 'https://gchq.github.io/CyberChef/',
      },
      {
        key: 'pdfjs',
        name: 'PDF.js',
        description: 'Mozilla 官方 PDF 阅读器，纯前端渲染，可打开本地 PDF',
        repo: 'mozilla/pdf.js',
        asset: 'pdfjs-{version}-dist.zip',
        entry: 'web/viewer.html',
        homepage: 'https://mozilla.github.io/pdf.js/',
      },
    ],
  },
  {
    key: 'retro',
    name: '复古游戏套件',
    badge: '复古游戏',
    tagline: '浏览器里的老主机与 Flash 回忆',
    apps: [
      {
        key: 'tic80',
        name: 'TIC-80',
        description: '像素幻想主机：自带代码编辑器、精灵与音乐工具，还有示例游戏',
        repo: 'nesbox/TIC-80',
        assetRe: /^tic80-v[\d.]+-html\.zip$/i,
        homepage: 'https://tic80.com',
      },
      {
        key: 'ruffle',
        name: 'Ruffle',
        description: 'Flash 播放器：把 .swf 拖进来就能玩，本地运行不上传',
        repo: 'ruffle-rs/ruffle',
        asset: 'ruffle-{version}-web-selfhosted.zip',
        shell: 'ruffle.html',
        homepage: 'https://ruffle.rs',
      },
    ],
  },
]

/** 应用 key -> 应用定义（带上所属套件），用于安装与更新。 */
const SUITE_APPS = new Map()
for (const suite of SUITES) {
  for (const app of suite.apps) {
    if (SUITE_APPS.has(app.key)) throw new Error('套件里存在重复的应用 key：' + app.key)
    SUITE_APPS.set(app.key, { ...app, suiteKey: suite.key })
  }
}

const RELEASE_TTL = 10 * 60 * 1000
const releaseCache = new Map() // repo -> { tag, version, at }
const assetCache = new Map() // repo@tag -> { names, at }

/** 用 releases/latest 的 302 Location 拿最新 tag（不走 GitHub API，不消耗 60/h 限额）。 */
async function resolveLatest(repo, { force = false } = {}) {
  const cached = releaseCache.get(repo)
  if (!force && cached && Date.now() - cached.at < RELEASE_TTL) return cached
  const res = await fetch(`https://github.com/${repo}/releases/latest`, {
    redirect: 'manual',
    headers: { 'user-agent': PLUGIN },
  })
  const location = res.headers.get('location') || ''
  const match = /\/releases\/tag\/([^/?#]+)$/.exec(location)
  if (!match) throw new Error(`无法解析 ${repo} 的最新版本（HTTP ${res.status}）`)
  const tag = decodeURIComponent(match[1])
  const info = { tag, version: tag.replace(/^v/, ''), at: Date.now() }
  releaseCache.set(repo, info)
  return info
}

function assetUrl(repo, tag, name) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
}

/** 解析某个应用在当前版本下的安装包名与下载地址。 */
async function resolveAsset(app, latest) {
  if (app.asset) {
    const name = app.asset.replaceAll('{key}', app.key).replaceAll('{version}', latest.version)
    return { name, url: assetUrl(app.repo, latest.tag, name) }
  }

  const cacheKey = `${app.repo}@${latest.tag}`
  let names = assetCache.get(cacheKey)?.names
  if (!names) {
    const res = await fetch(`https://github.com/${app.repo}/releases/expanded_assets/${encodeURIComponent(latest.tag)}`, {
      headers: { 'user-agent': PLUGIN },
    })
    if (!res.ok) throw new Error(`读取 ${app.repo} 发布列表失败（HTTP ${res.status}）`)
    const html = await res.text()
    names = [...new Set([...html.matchAll(/releases\/download\/[^"]*?\/([^"?]+)"/g)].map(m => decodeURIComponent(m[1])))]
    if (names.length) assetCache.set(cacheKey, { names, at: Date.now() })
  }
  const name = (names || []).find(item => app.assetRe.test(item))
  if (!name) throw new Error(`在 ${app.repo} 的最新发布里没找到匹配的安装包`)
  return { name, url: assetUrl(app.repo, latest.tag, name) }
}

async function downloadToFile(url, dest, limit) {
  const res = await fetch(url, { headers: { 'user-agent': 'dsh-web-app' } })
  if (!res.ok) throw Object.assign(new Error(`下载失败：HTTP ${res.status}`), { status: 502 })
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared && declared > limit) throw Object.assign(new Error('应用包超过大小上限'), { status: 413 })
  if (!res.body) throw Object.assign(new Error('下载响应为空'), { status: 502 })
  const out = createWriteStream(dest)
  let size = 0
  try {
    for await (const chunk of res.body) {
      size += chunk.length
      if (size > limit) throw Object.assign(new Error('应用包超过大小上限'), { status: 413 })
      if (!out.write(chunk)) await once(out, 'drain')
    }
    await new Promise((resolvePromise, reject) => { out.end(resolvePromise); out.on('error', reject) })
  } catch (err) {
    out.destroy()
    throw err
  }
  return size
}

/* ────────────────────────────── 基础工具 ────────────────────────────── */

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function ensureDirs() {
  await mkdir(APPS, { recursive: true })
  await mkdir(SAVES, { recursive: true })
  await mkdir(TMP, { recursive: true })
}

/** 把 url 相对路径安全地拼到 base 下：拒绝越界路径（隐藏文件由调用方决定是否拒绝）。 */
function safeJoin(base, rel) {
  const cleaned = String(rel || '').split('/').filter(Boolean)
  if (cleaned.some(seg => seg === '..')) return null
  const target = resolve(base, ...cleaned)
  if (target !== base && !target.startsWith(base + sep)) return null
  return target
}

function slug(input) {
  const s = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return s || 'app-' + randomUUID().slice(0, 8)
}

/* ────────────────────────────── 纯 JS 解压 ────────────────────────────── */

function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length)
  return fd.read(buf, 0, length, offset).then(({ bytesRead }) => (bytesRead === length ? buf : buf.subarray(0, bytesRead)))
}

function findEocd(tail) {
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  let idx = tail.lastIndexOf(sig)
  while (idx >= 0) {
    if (idx + 22 <= tail.length) return idx
    idx = tail.lastIndexOf(sig, idx - 1)
  }
  return -1
}

/** 读取 zip 中央目录：返回 { name, method, flags, compSize, size, localOffset, isDirectory }。 */
async function readZipEntries(fd, fileSize) {
  const tailLen = Math.min(fileSize, 65557 + 22)
  const tail = await readAt(fd, fileSize - tailLen, tailLen)
  const eocd = findEocd(tail)
  if (eocd < 0) throw Object.assign(new Error('不是有效的 zip 文件'), { status: 400 })

  let entryCount = tail.readUInt16LE(eocd + 10)
  let cdSize = tail.readUInt32LE(eocd + 12)
  let cdOffset = tail.readUInt32LE(eocd + 16)

  // ZIP64：EOCD 字段为 0xFFFFFFFF 时，EOCD 之前 20 字节是 ZIP64 EOCD locator。
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entryCount === 0xffff) {
    const locOffset = fileSize - tailLen + eocd - 20
    if (locOffset >= 0) {
      const loc = await readAt(fd, locOffset, 20)
      if (loc.length === 20 && loc.readUInt32LE(0) === 0x07064b50) {
        const z64 = await readAt(fd, Number(loc.readBigUInt64LE(8)), 56)
        if (z64.length >= 56 && z64.readUInt32LE(0) === 0x06064b50) {
          entryCount = Number(z64.readBigUInt64LE(32))
          cdSize = Number(z64.readBigUInt64LE(40))
          cdOffset = Number(z64.readBigUInt64LE(48))
        }
      }
    }
  }

  if (cdOffset + cdSize > fileSize) throw Object.assign(new Error('zip 中央目录越界'), { status: 400 })
  const cd = await readAt(fd, cdOffset, cdSize)
  const entries = []
  let off = 0
  for (let i = 0; i < entryCount; i++) {
    if (off + 46 > cd.length) break
    if (cd.readUInt32LE(off) !== 0x02014b50) throw Object.assign(new Error('zip 中央目录损坏'), { status: 400 })
    const flags = cd.readUInt16LE(off + 8)
    const method = cd.readUInt16LE(off + 10)
    let compSize = cd.readUInt32LE(off + 20)
    let size = cd.readUInt32LE(off + 24)
    const nameLen = cd.readUInt16LE(off + 28)
    const extraLen = cd.readUInt16LE(off + 30)
    const commentLen = cd.readUInt16LE(off + 32)
    let localOffset = cd.readUInt32LE(off + 42)
    const nameBuf = cd.subarray(off + 46, off + 46 + nameLen)
    const name = (flags & 0x800 ? nameBuf.toString('utf8') : nameBuf.toString('latin1')).replace(/\\/g, '/')

    // ZIP64 扩展：跳过固定字段，按顺序读 8 字节字段。
    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      let p = off + 46 + nameLen
      const end = p + extraLen
      while (p + 4 <= end) {
        const id = cd.readUInt16LE(p)
        const len = cd.readUInt16LE(p + 2)
        let q = p + 4
        if (id === 0x0001) {
          if (size === 0xffffffff && q + 8 <= p + 4 + len) { size = Number(cd.readBigUInt64LE(q)); q += 8 }
          if (compSize === 0xffffffff && q + 8 <= p + 4 + len) { compSize = Number(cd.readBigUInt64LE(q)); q += 8 }
          if (localOffset === 0xffffffff && q + 8 <= p + 4 + len) { localOffset = Number(cd.readBigUInt64LE(q)); q += 8 }
        }
        p += 4 + len
      }
    }

    entries.push({ name, method, flags, compSize, size, localOffset, isDirectory: name.endsWith('/') })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function assertSafeEntries(entries) {
  for (const entry of entries) {
    const name = entry.name
    if (!name) throw Object.assign(new Error('zip 包含空文件名'), { status: 400 })
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw Object.assign(new Error('zip 包含绝对路径'), { status: 400 })
    if (name.split('/').some(seg => seg === '..')) throw Object.assign(new Error('zip 包含越界路径'), { status: 400 })
    if (entry.flags & 0x1) throw Object.assign(new Error('不支持加密 zip'), { status: 400 })
    if (entry.method !== 0 && entry.method !== 8) throw Object.assign(new Error('不支持的压缩算法'), { status: 400 })
    if (entry.size > MAX_ENTRY) throw Object.assign(new Error('单文件解压后超过大小上限'), { status: 400 })
  }
}

function normalizeEntryName(name) {
  return name.split('/').filter(Boolean).join('/')
}

/** 解压到 destDir；逐条读取，避免整包进内存。 */
async function unzipToDir(zipPath, destDir) {
  const handle = await open(zipPath, 'r')
  try {
    const info = await handle.stat()
    const entries = await readZipEntries(handle, info.size)
    assertSafeEntries(entries)

    let files = 0
    let bytes = 0
    for (const entry of entries) {
      if (entry.isDirectory) {
        await mkdir(join(destDir, normalizeEntryName(entry.name)), { recursive: true })
        continue
      }
      const relative = normalizeEntryName(entry.name)
      if (!relative) continue
      const target = safeJoin(destDir, relative)
      if (!target) throw Object.assign(new Error('zip 路径非法：' + entry.name), { status: 400 })

      const local = await readAt(handle, entry.localOffset, 30)
      if (local.length < 30 || local.readUInt32LE(0) !== 0x04034b50) throw Object.assign(new Error('zip 数据损坏：' + entry.name), { status: 400 })
      const nameLen = local.readUInt16LE(26)
      const extraLen = local.readUInt16LE(28)
      const dataStart = entry.localOffset + 30 + nameLen + extraLen
      let raw
      try {
        raw = await readAt(handle, dataStart, entry.compSize)
      } catch {
        throw Object.assign(new Error('读取 zip 数据失败：' + entry.name), { status: 400 })
      }
      let data
      if (entry.method === 0) {
        data = raw
      } else {
        try {
          data = inflateRawSync(raw)
        } catch {
          throw Object.assign(new Error('解压失败：' + entry.name), { status: 400 })
        }
      }
      if (data.length !== entry.size) throw Object.assign(new Error('解压大小不一致：' + entry.name), { status: 400 })

      files += 1
      bytes += data.length
      if (files > MAX_FILES) throw Object.assign(new Error('文件数量过多'), { status: 400 })
      if (bytes > MAX_TOTAL) throw Object.assign(new Error('解压后体积过大'), { status: 400 })

      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, data)
    }
    return { files, bytes }
  } finally {
    await handle.close().catch(() => {})
  }
}

async function isFile(path) {
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

/**
 * 确定入口 html。
 * 显式入口（应用定义 / manifest）优先；没有时退回到 index.html，
 * 再退回到根目录里唯一的 html（CyberChef 这类把版本号写进文件名的包）。
 */
async function resolveEntry(payloadDir, raw) {
  if (raw) {
    const entry = String(raw).replace(/^\/+/, '')
    const target = safeJoin(payloadDir, entry)
    if (!target) throw Object.assign(new Error('入口路径非法'), { status: 400 })
    if (!(await isFile(target))) throw Object.assign(new Error(`找不到入口文件：${entry}`), { status: 400 })
    return entry
  }

  for (const name of ['index.html', 'index.htm']) {
    if (await isFile(join(payloadDir, name))) return name
  }

  const candidates = (await readdir(payloadDir).catch(() => []))
    .filter(name => !name.startsWith('.') && /\.html?$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    throw Object.assign(new Error('应用包含多个 html，请在 dsh-web-app.json 里指定 entry'), { status: 400 })
  }
  throw Object.assign(new Error('找不到入口文件：index.html'), { status: 400 })
}

/** 用插件内置的壳页当作入口（发布包里只有库、没有页面时）。 */
async function writeShell(payloadDir, shellName) {
  const source = fileURLToPath(new URL('../web/shells/' + shellName, import.meta.url))
  const content = await readFile(source).catch(() => null)
  if (!content) throw Object.assign(new Error('缺少内置壳页：' + shellName), { status: 500 })
  await writeFile(join(payloadDir, 'index.html'), content)
}

async function readManifest(payloadDir, explicitEntry) {
  let manifest = null
  try {
    manifest = JSON.parse(await readFile(join(payloadDir, 'dsh-web-app.json'), 'utf8'))
  } catch {
    manifest = null
  }
  const declared = manifest && typeof manifest.entry === 'string' ? manifest.entry : null
  const entry = await resolveEntry(payloadDir, explicitEntry || declared)
  return {

    id: manifest && typeof manifest.id === 'string' && manifest.id ? slug(manifest.id) : null,
    name: manifest && typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : null,
    version: manifest && typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version.trim() : '1.0.0',
    entry,
    icon: manifest && typeof manifest.icon === 'string' ? manifest.icon.replace(/^\/+/, '') : null,
    description: manifest && typeof manifest.description === 'string' ? manifest.description : null,
    permissions: Array.isArray(manifest?.permissions) ? manifest.permissions.filter(x => typeof x === 'string') : [],
  }
}

const ROOTS_FILE = join(ROOT, 'roots.json')

/** 自定义安装根目录列表（上传时用户选择的位置；默认目录始终可用）。 */
async function readRoots() {
  try {
    const parsed = JSON.parse(await readFile(ROOTS_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && isAbsolute(item)) : []
  } catch {
    return []
  }
}

async function registerRoot(dir) {
  const absolute = resolve(dir)
  const roots = await readRoots()
  if (roots.some(item => resolve(item).toLowerCase() === absolute.toLowerCase())) return
  roots.push(absolute)
  await writeFile(ROOTS_FILE, JSON.stringify(roots, null, 2), 'utf8')
}

async function appRoots() {
  return [APPS, ...(await readRoots())]
}

async function metaAt(dir) {
  try {
    return JSON.parse(await readFile(join(dir, META_FILE), 'utf8'))
  } catch {
    return null
  }
}

/** 在默认目录和所有自定义根目录里找应用；返回目录和 meta。 */
async function findApp(id) {
  for (const root of await appRoots()) {
    const dir = join(root, id)
    const meta = await metaAt(dir)
    if (meta) return { dir, meta }
  }
  return null
}

async function readMeta(id) {
  const found = await findApp(id)
  return found ? found.meta : null
}

export async function listApps() {
  await ensureDirs()
  const apps = []
  const seen = new Set()
  for (const root of await appRoots()) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue
      const meta = await metaAt(join(root, entry.name))
      if (!meta) continue
      seen.add(entry.name)
      apps.push({
        id: meta.id,
        name: meta.name,
        version: meta.version,
        description: meta.description || '',
        icon: meta.icon ? `/web-apps/app/${meta.id}/${meta.icon}` : null,
        entry: meta.entry,
        installedAt: meta.installedAt,
        files: meta.files,
        bytes: meta.bytes,
        location: root === APPS ? null : root,
        url: `/web-apps/app/${meta.id}/`,
      })
    }
  }
  apps.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
  return { apps }
}


/** 如果 zip 里套了一层目录（xxx/index.html），把内容拍平到根。 */
async function flattenPayload(payloadDir) {
  const roots = await readdir(payloadDir, { withFileTypes: true })
  const files = roots.filter(entry => entry.isFile()).map(entry => entry.name)
  const dirs = roots.filter(entry => entry.isDirectory()).map(entry => entry.name)
  if (files.includes('index.html') || files.includes('dsh-web-app.json')) return
  if (dirs.length !== 1) return
  const inner = join(payloadDir, dirs[0])
  const innerEntries = await readdir(inner).catch(() => [])
  if (!innerEntries.includes('index.html') && !innerEntries.includes('dsh-web-app.json')) return
  for (const name of innerEntries) await rename(join(inner, name), join(payloadDir, name))
  await rm(inner, { recursive: true, force: true })
}

/** 从一个 zip 安装/覆盖应用；返回新 meta。 */
export async function installZip(zipPath, originalName, source = 'upload', overrides = {}) {
  await ensureDirs()
  const work = join(TMP, randomUUID())
  const payload = join(work, 'payload')
  try {
    await mkdir(payload, { recursive: true })
    const stats = await unzipToDir(zipPath, payload)
    await flattenPayload(payload)
    if (overrides.shell) await writeShell(payload, overrides.shell)
    const manifest = await readManifest(payload, overrides.entry)
    const id = overrides.id || manifest.id || slug(String(originalName || 'app').replace(/\.zip$/i, ''))
    const meta = {
      id,
      name: overrides.name || manifest.name || id,
      version: overrides.version || manifest.version,
      entry: manifest.entry,
      icon: overrides.icon || manifest.icon,
      description: overrides.description || manifest.description,
      permissions: manifest.permissions,
      files: stats.files,
      bytes: stats.bytes,
      installedAt: new Date().toISOString(),
      source,
    }
    await writeFile(join(payload, META_FILE), JSON.stringify(meta, null, 2), 'utf8')

    const existing = await findApp(id)
    const root = overrides.installRoot
      ? resolve(String(overrides.installRoot))
      : existing ? dirname(existing.dir) : APPS
    if (overrides.installRoot) {
      await mkdir(root, { recursive: true })
      await registerRoot(root)
    }
    const target = join(root, id)
    if (existing && resolve(existing.dir).toLowerCase() !== resolve(target).toLowerCase()) {
      throw Object.assign(new Error(`已经有同名应用「${id}」装在 ${existing.dir}，换个应用名或目录名再试`), { status: 409 })
    }
    await rm(target, { recursive: true, force: true })
    await rename(payload, target)
    return meta
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

export async function deleteApp(id) {
  if (!/^[a-z0-9._-]{1,64}$/i.test(String(id))) throw Object.assign(new Error('应用 id 非法'), { status: 400 })
  const found = await findApp(id)
  if (found) await rm(found.dir, { recursive: true, force: true })
  return { ok: true }
}

/* ────────────────────────────── 套件目录 / 安装 ────────────────────────────── */

export async function catalog({ refresh = false } = {}) {
  await ensureDirs()
  const suites = await Promise.all(SUITES.map(async suite => {
    const apps = await Promise.all(suite.apps.map(async app => {
      const installed = await readMeta(app.key)
      let latest = null
      let error = null
      try {
        latest = await resolveLatest(app.repo, { force: refresh })
      } catch (err) {
        error = err?.message || String(err)
      }
      return {
        key: app.key,
        name: app.name,
        description: app.description,
        homepage: app.homepage || null,
        latest: latest ? { version: latest.version } : null,
        error,
        installed: installed ? { version: installed.version, installedAt: installed.installedAt } : null,
        updateAvailable: Boolean(installed && latest && installed.version !== latest.version),
      }
    }))
    return {
      key: suite.key,
      name: suite.name,
      badge: suite.badge || suite.name,
      tagline: suite.tagline,
      homepage: suite.homepage || null,
      apps,
    }
  }))
  return { suites, total: SUITE_APPS.size }
}

export async function installApp(key) {
  const app = SUITE_APPS.get(String(key || ''))
  if (!app) throw Object.assign(new Error('未知的套件应用：' + key), { status: 404 })
  const latest = await resolveLatest(app.repo, { force: true })
  const asset = await resolveAsset(app, latest)
  await ensureDirs()
  const tmp = join(TMP, randomUUID() + '.zip')
  try {
    await downloadToFile(asset.url, tmp, MAX_UPLOAD)
    return await installZip(tmp, asset.name, 'suite:' + app.suiteKey, {
      id: app.key,
      name: app.name,
      version: latest.version,
      description: app.description,
      entry: app.entry,
      shell: app.shell,
    })
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

/** 用系统文件管理器打开一个目录。 */
function openDirectory(dir) {
  const [command, args] = process.platform === 'win32'
    ? ['explorer.exe', [dir]]
    : process.platform === 'darwin'
      ? ['open', [dir]]
      : ['xdg-open', [dir]]
  try {
    // explorer.exe 打开目录后总是返回 1，不能等它退出，detach 掉即可。
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch (err) {
    throw Object.assign(new Error('无法打开文件管理器：' + (err?.message || err)), { status: 500 })
  }
}

/** 在系统文件管理器里打开某个应用的安装目录。 */
export async function revealApp(id) {
  const appId = String(id || '')
  if (!/^[a-z0-9._-]{1,64}$/i.test(appId)) throw Object.assign(new Error('应用 id 非法'), { status: 400 })
  const found = await findApp(appId)
  if (!found) throw Object.assign(new Error('应用不存在'), { status: 404 })
  openDirectory(found.dir)
  return { ok: true, path: found.dir }
}

/** 打开某个应用的保存目录（文件桥写入的位置）。 */
export async function revealSaves(id) {
  const appId = slug(String(id || 'unknown'))
  await ensureDirs()
  const dir = join(SAVES, appId)
  await mkdir(dir, { recursive: true })
  openDirectory(dir)
  return { ok: true, path: dir }
}

/* ────────────────────────────── 文件桥（保存） ────────────────────────────── */

/** 保存文件名：只留最后一段，去掉控制字符和 Windows 非法字符。 */
function safeFileName(input) {
  const last = String(input || '').split(/[\\/]/).pop() || 'file'
  const cleaned = last
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return cleaned || 'file'
}

/** 同名文件不覆盖：foo.png → foo (2).png */
async function uniqueTarget(dir, name) {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let candidate = join(dir, name)
  for (let n = 2; n < 500; n++) {
    try {
      await stat(candidate)
      candidate = join(dir, `${base} (${n})${ext}`)
    } catch {
      return candidate
    }
  }
  return join(dir, `${base}-${Date.now()}${ext}`)
}

/** 把文件桥注入到托管的 HTML 页面（每个页面只注入一次）。 */
async function injectBridge(file) {
  const html = await readFile(file, 'utf8')
  if (html.includes('/web-apps/bridge.js')) return null
  const tag = '<script src="/web-apps/bridge.js" defer></script>'
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, tag + '</head>')
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, match => match + tag)
  return tag + html
}

/* ────────────────────────────── 静态文件 ────────────────────────────── */

async function sendAppFile(req, res, id, rest) {
  const found = await findApp(id)
  if (!found) return json(res, 404, { error: '应用不存在' })
  const appDir = found.dir
  const meta = found.meta

  let rel = rest || ''
  if (!rel || rel.endsWith('/')) rel += meta.entry
  // 静态服务不暴露隐藏文件（.htaccess、.dsh-app-meta.json 等）
  if (rel.split('/').some(seg => seg.startsWith('.'))) return json(res, 403, { error: '路径非法' })
  const file = safeJoin(appDir, rel)
  if (!file) return json(res, 403, { error: '路径非法' })

  let info
  try {
    info = await stat(file)
  } catch {
    return json(res, 404, { error: '文件不存在' })
  }
  if (!info.isFile()) return json(res, 404, { error: '文件不存在' })

  const ext = extname(file).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  res.setHeader('content-type', type)
  res.setHeader('accept-ranges', 'bytes')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('cache-control', ext === '.html' ? 'no-cache' : 'private, max-age=3600')

  // HTML 注入文件桥（接管「保存 / 导出」的下载）；Range 请求保持原样
  if (type.startsWith('text/html') && !req.headers.range) {
    try {
      const injected = await injectBridge(file)
      if (injected !== null) {
        res.setHeader('content-length', Buffer.byteLength(injected))
        res.statusCode = 200
        if (req.method === 'HEAD') return res.end()
        return res.end(injected)
      }
    } catch {
      // 注入失败就照常返回原文件
    }
  }

  // 文本类资源按 Accept-Encoding 压缩；Range 请求保持原样（浏览器通常只对媒体发 Range）
  const encoding = COMPRESSIBLE.has(ext) && info.size >= COMPRESS_MIN_BYTES && !req.headers.range ? pickEncoding(req) : null
  if (encoding) {
    try {
      const body = await compressFile(file, info, encoding)
      if (body.length < info.size) {
        res.setHeader('content-encoding', encoding)
        res.setHeader('vary', 'accept-encoding')
        res.setHeader('content-length', body.length)
        res.statusCode = 200
        if (req.method === 'HEAD') return res.end()
        return res.end(body)
      }
    } catch {
      // 压缩失败就退回原始文件，不影响可用性
    }
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
    if (start >= info.size || start > end) {
      res.statusCode = 416
      res.setHeader('content-range', `bytes */${info.size}`)
      return res.end()
    }
    res.statusCode = 206
    res.setHeader('content-range', `bytes ${start}-${end}/${info.size}`)
    res.setHeader('content-length', end - start + 1)
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.statusCode = 200
  res.setHeader('content-length', info.size)
  if (req.method === 'HEAD') return res.end()
  return createReadStream(file).pipe(res)
}

/** 下载请求体到临时文件，边读边限大小。 */
async function receiveToFile(req, dest) {
  let size = 0
  await new Promise((resolvePromise, reject) => {
    const out = createWriteStream(dest)
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_UPLOAD) {
        req.destroy()
        out.destroy()
        reject(Object.assign(new Error('压缩包超过大小上限'), { status: 413 }))
      }
    })
    req.on('error', reject)
    out.on('error', reject)
    out.on('finish', resolvePromise)
    req.pipe(out)
  })
  return size
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('请求体过大'), { status: 413 })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/* ────────────────────────────── 路由 ────────────────────────────── */

function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return 403
  return connection.requestRejection({ headers: req.headers })
}

async function route(ctx, req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/'
  const method = req.method || 'GET'

  // 跨站写保护：浏览器会带 sec-fetch-site；来自其他站点的写请求一律拒绝
  const site = req.headers['sec-fetch-site']
  if (method !== 'GET' && method !== 'HEAD' && site && site !== 'same-origin' && site !== 'none') {
    return json(res, 403, { error: '拒绝跨站请求' })
  }

  if (p === '/web-apps/api/list') return json(res, 200, await listApps())

  // 套件目录（旧路径 /api/artcraft/catalog 保留兼容）
  if (p === '/web-apps/api/catalog' || p === '/web-apps/api/artcraft/catalog') {
    return json(res, 200, await catalog({ refresh: url.searchParams.get('refresh') === '1' }))
  }

  if ((p === '/web-apps/api/install' || p === '/web-apps/api/artcraft/install') && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body || typeof body.key !== 'string') return json(res, 400, { error: '缺少 key' })
    return json(res, 200, { app: await installApp(body.key) })
  }

  if (p === '/web-apps/api/reveal' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body || typeof body.id !== 'string') return json(res, 400, { error: '缺少 id' })
    if (body.dir === 'saves') return json(res, 200, await revealSaves(body.id))
    return json(res, 200, await revealApp(body.id))
  }

  // 文件桥：把托管应用里的下载保存到 DSH 保存目录
  if (p === '/web-apps/api/save' && method === 'POST') {
    await ensureDirs()
    const appId = slug(String(req.headers['x-app-id'] || 'unknown'))
    const name = safeFileName(decodeURIComponent(String(req.headers['x-save-name'] || 'file')))
    const dir = join(SAVES, appId)
    await mkdir(dir, { recursive: true })
    const target = await uniqueTarget(dir, name)
    await receiveToFile(req, target)
    return json(res, 200, { path: target, dir, name: target.split(/[\\/]/).pop() })
  }

  if (p === '/web-apps/api/upload' && req.method === 'POST') {
    await ensureDirs()
    const originalName = decodeURIComponent(req.headers['x-file-name'] || 'app.zip')
    if (!/\.zip$/i.test(originalName)) return json(res, 400, { error: '请上传 .zip 压缩包' })
    const rawName = decodeURIComponent(req.headers['x-app-name'] || '').trim()
    const rawId = decodeURIComponent(req.headers['x-app-id'] || '').trim()
    const rawDir = decodeURIComponent(req.headers['x-install-dir'] || '').trim()
    if (rawDir && !isAbsolute(rawDir)) return json(res, 400, { error: '安装位置必须是绝对路径' })
    const tmp = join(TMP, randomUUID() + '.zip')
    try {
      await receiveToFile(req, tmp)
      const meta = await installZip(tmp, originalName, 'upload', {
        id: rawId ? slug(rawId) : undefined,
        name: rawName ? rawName.slice(0, 80) : undefined,
        installRoot: rawDir ? resolve(rawDir) : undefined,
      })
      return json(res, 200, { app: meta })
    } finally {
      await rm(tmp, { force: true }).catch(() => {})
    }
  }

  if (p === '/web-apps/api/delete' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body || typeof body.id !== 'string') return json(res, 400, { error: '缺少 id' })
    return json(res, 200, await deleteApp(body.id))
  }

  if (p.startsWith('/web-apps/app/')) {
    const rest = url.pathname.slice('/web-apps/app/'.length)
    const [id, ...tail] = rest.split('/')
    return sendAppFile(req, res, id, tail.join('/'))
  }

  if (p === '/web-apps/bridge.js' && (method === 'GET' || method === 'HEAD')) {
    try {
      const buf = await readFile(fileURLToPath(new URL('../web/bridge.js', import.meta.url)))
      res.setHeader('content-type', 'text/javascript; charset=utf-8')
      res.setHeader('cache-control', 'no-cache')
      res.statusCode = 200
      if (method === 'HEAD') return res.end()
      return res.end(buf)
    } catch {
      return json(res, 404, { error: 'not found' })
    }
  }

  if (p === '/web-apps/icon.svg') {
    try {
      const buf = await readFile(fileURLToPath(new URL('../web/icon.svg', import.meta.url)))
      res.setHeader('content-type', 'image/svg+xml')
      res.setHeader('cache-control', 'public, max-age=86400')
      return res.end(buf)
    } catch {
      return json(res, 404, { error: 'no icon' })
    }
  }

  return json(res, 404, { error: '接口不存在' })
}

/* ────────────────────────────── 插件入口 ────────────────────────────── */

export const name = PLUGIN

export default {
  inject: ['webServer', 'connection'],
  apply(ctx) {
    try {
      ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/web-apps',
        handler: async (req, res) => {
          try {
            const rejection = requestRejection(ctx, req)
            if (rejection) return json(res, rejection, { error: '未授权' })
            const url = new URL(req.url, 'http://127.0.0.1')
            await route(ctx, req, res, url)
          } catch (err) {
            if (res.headersSent) {
              try { res.end() } catch {}
              return
            }
            json(res, err?.status || 500, { error: err?.message || String(err) })
          }
        },
      }), `${PLUGIN}: /web-apps routes`)
    } catch (err) {
      ctx.logger?.error?.(`${PLUGIN}: 初始化失败：${err?.message || err}`)
    }
  },
}
