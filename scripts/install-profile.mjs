/**
 * 把 dsh-web-app 登记进 DSH profile（本地 link 安装，适合开发）。
 *
 *   node scripts/install-profile.mjs             # 安装
 *   node scripts/install-profile.mjs --uninstall  # 卸载
 *
 * 目标 profile 的解析顺序：
 *   DSH_PROFILE_DIR 环境变量（profile 目录绝对路径）
 *   > <DSH_HOME>/profiles/<DSH_PROFILE_NAME 或 DSH_PROFILE 或 desktop>
 *   > ~/.dsh/profiles/desktop
 * 其中 DSH_HOME 默认是 ~/.dsh（Windows 上是 %USERPROFILE%\.dsh），和 DSH 自身一致。
 *
 * 做的事：
 *  1) profile package.json：dependencies["dsh-web-app"] = link:<本仓库>，dsh.profile.bundles 追加；
 *  2) profile node_modules 下建 junction（Windows）或 symlink，让 Node 能解析包名。
 * 需要重启 DSH 生效。
 */
import { readFile, writeFile, copyFile, lstat, unlink, rmdir, symlink, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILE_NAME = process.env.DSH_PROFILE_NAME || process.env.DSH_PROFILE || 'desktop'
const PROFILE = process.env.DSH_PROFILE_DIR || join(DSH_HOME, 'profiles', PROFILE_NAME)
const SELF = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PKG = join(PROFILE, 'package.json')
const LINK = join(PROFILE, 'node_modules', 'dsh-web-app')
const NAME = 'dsh-web-app'
const LINK_SPEC = 'link:' + SELF.replace(/\\/g, '/')
const uninstall = process.argv.includes('--uninstall')

async function exists(path) {
  try { await lstat(path); return true } catch { return false }
}

/** 删除链接本身：POSIX 符号链接用 unlink；Windows 的 junction 在 Node 里表现得像目录，
 *  unlink 会 EPERM，只能用非递归 rmdir（它只移除链接本身，不会跟进目标目录）。 */
async function removeLink(path) {
  try {
    await unlink(path)
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'EISDIR') {
      await rmdir(path)
      return
    }
    throw err
  }
}

const pkg = JSON.parse(await readFile(PKG, 'utf8'))
pkg.dependencies ||= {}
pkg.dsh ||= {}
pkg.dsh.profile ||= {}
pkg.dsh.profile.bundles ||= []

await copyFile(PKG, PKG + '.dsh-web-app.bak')

if (uninstall) {
  delete pkg.dependencies[NAME]
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter(x => x !== NAME)
  if (await exists(LINK)) await removeLink(LINK)
  await writeFile(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log('已卸载：重启 DSH 后生效。profile package.json 备份在', PKG + '.dsh-web-app.bak')
  process.exit(0)
}

pkg.dependencies[NAME] = LINK_SPEC
if (!pkg.dsh.profile.bundles.includes(NAME)) pkg.dsh.profile.bundles.push(NAME)

await writeFile(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

if (!(await exists(LINK))) {
  await mkdir(join(PROFILE, 'node_modules'), { recursive: true })
  await symlink(SELF, LINK, 'junction')
}
console.log('已安装：', NAME)
console.log('  profile :', PROFILE)
console.log('  link    :', LINK, '->', SELF)
console.log('  bundles :', pkg.dsh.profile.bundles.join(', '))
console.log('重启 DSH 后，左侧应出现「应用」入口。')
console.log('卸载：node scripts/install-profile.mjs --uninstall')
console.log('指定其他 profile：设置 DSH_PROFILE_DIR（profile 目录）或 DSH_PROFILE_NAME 后再运行。')
