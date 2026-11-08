/**
 * 把 dsh-web-app 登记进 DSH desktop profile（本地 link 安装）。
 *
 *   node scripts/install-profile.mjs            # 安装
 *   node scripts/install-profile.mjs --uninstall # 卸载
 *
 * 做的事：
 *  1) profile package.json：dependencies["dsh-web-app"] = link:<本仓库>，dsh.profile.bundles 追加；
 *  2) profile node_modules 下建 junction（Windows）或 symlink，让 Node 能解析包名。
 * 需要重启 DSH 生效。
 */
import { readFile, writeFile, copyFile, lstat, unlink, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROFILE = process.env.DSH_PROFILE_DIR || 'F:/.dsh/profiles/desktop'
const SELF = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PKG = join(PROFILE, 'package.json')
const LINK = join(PROFILE, 'node_modules', 'dsh-web-app')
const NAME = 'dsh-web-app'
const LINK_SPEC = 'link:' + SELF.replace(/\\/g, '/')
const uninstall = process.argv.includes('--uninstall')

async function exists(path) {
  try { await lstat(path); return true } catch { return false }
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
  if (await exists(LINK)) await unlink(LINK)
  await writeFile(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log('已卸载：重启 DSH 后生效。profile package.json 备份在', PKG + '.dsh-web-app.bak')
  process.exit(0)
}

pkg.dependencies[NAME] = LINK_SPEC
if (!pkg.dsh.profile.bundles.includes(NAME)) pkg.dsh.profile.bundles.push(NAME)

await writeFile(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

if (!(await exists(LINK))) {
  await symlink(SELF, LINK, 'junction')
}
console.log('已安装：', NAME)
console.log('  profile :', PROFILE)
console.log('  link    :', LINK, '->', SELF)
console.log('  bundles :', pkg.dsh.profile.bundles.join(', '))
console.log('重启 DSH 后，左侧应出现「应用」入口。')
console.log('卸载：node scripts/install-profile.mjs --uninstall')
