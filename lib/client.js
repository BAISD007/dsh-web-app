/**
 * dsh-web-app — 浏览器半身（手写 client bundle）。
 *
 * 左侧导航「应用」+ 主区应用库页面：
 *  - 已安装应用（打开 / 打开安装目录 / 更新 / 删除）
 *  - 内置套件卡片（创作套件 ArtCraft、实用工具、复古游戏）→ 点进去安装未安装的应用
 *  - 上传自己的静态 Web 应用（zip）
 *
 * P0：应用与 DSH 同源托管（sandbox 带 allow-same-origin）；只安装可信 Web 包。
 * P1 计划：切到独立 loopback origin，去掉 allow-same-origin。
 */
window.__ModuleLoader__.load({
  id: 'dsh-web-app',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ID = 'dsh-web-app'
    const API = '/web-apps'
    const STYLE_ID = 'dsh-web-app/styles'

    /* ── 图标：Package.svg（24×24，stroke 1.5，圆角端点，跟随 currentColor）── */
    function Icon({ size }) {
      const s = typeof size === 'number' ? size : 16
      return h('svg', {
        width: s, height: s, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', {
          d: 'M20.9298 8C20.9298 7.29 20.5498 6.63 19.9298 6.27L12.9998 2.27C12.3798 1.91 11.6198 1.91 10.9998 2.27L4.06982 6.27C3.44982 6.63 3.06982 7.29 3.06982 8L3.06982 16C3.06982 16.71 3.44982 17.37 4.06982 17.73L10.9998 21.73C11.6198 22.09 12.3798 22.09 12.9998 21.73L19.9298 17.73C20.5398 17.37 20.9298 16.71 20.9298 16L20.9298 8Z',
        }),
        h('path', { d: 'M11.9999 21.96L11.9999 12L3.42993 7.04999' }),
        h('path', {
          d: 'M0 0L9.74926 0',
          transform: 'matrix(-0.865707,0.500552,-0.500552,-0.865707,20.4398,7.12)',
        }),
        h('path', {
          d: 'M0 0L4.92796 0',
          transform: 'matrix(-0.866488,-0.499197,0.499197,-0.866488,16.3398,9.41995)',
        }),
      )
    }

    const CSS = `
.wa-root { height: 100%; overflow: auto; padding: var(--dsh-frame-top-clearance, 48px) clamp(20px, 3.2vw, 48px) 40px; box-sizing: border-box; color: var(--dsw-alias-label-primary, #e8e8e8); }
.wa-head { display: flex; align-items: flex-end; gap: 12px; margin: 8px 0 20px; }
.wa-title { margin: 0; font-size: 22px; line-height: 30px; font-weight: 600; }
.wa-sub { margin: 2px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #9aa0a6); }
.wa-grow { flex: 1; }
.wa-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l2, #3a3a3a); background: var(--dsw-alias-bg-layer-1, #262626); color: var(--dsw-alias-label-primary, #e8e8e8); border-radius: 8px; padding: 7px 14px; font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.wa-btn:hover { border-color: var(--dsw-alias-border-l3, #4a4a4a); }
/* 注意：深色主题下 --dsw-alias-brand-primary 是中性近白色（bluish-1000），不能当“品牌蓝”用；
   填充主按钮固定用 DSH 自身 CSS 里的 accent 蓝 #4d6bfe，避免白底白字。 */
.wa-btn.is-primary { background: #4d6bfe; border-color: transparent; color: #fff; }
.wa-btn.is-primary:hover { background: #3f5cf0; }
.wa-btn:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 2px; }
.wa-btn[disabled] { opacity: .5; cursor: default; }
.wa-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.wa-card { border: 1px solid var(--dsw-alias-border-l2, #3a3a3a); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #232323); padding: 16px; display: flex; flex-direction: column; gap: 10px; min-height: 132px; box-shadow: 0 1px 2px rgba(0, 0, 0, .04), 0 6px 16px rgba(0, 0, 0, .045); }
.wa-card.is-link { cursor: pointer; }
.wa-card.is-link:hover { border-color: var(--dsw-alias-border-l3, #4a4a4a); box-shadow: 0 2px 4px rgba(0, 0, 0, .05), 0 10px 24px rgba(0, 0, 0, .07); }
.wa-card.is-link:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 2px; }
.wa-suite-arrow { font-size: 20px; line-height: 1; color: var(--dsw-alias-label-secondary, #9aa0a6); }
.wa-badge { font-size: 11px; line-height: 16px; padding: 1px 7px; border-radius: 999px; background: rgba(77, 107, 254, .16); color: #8fa8ff; white-space: nowrap; }
.wa-card-top { display: flex; align-items: center; gap: 12px; }
.wa-avatar { width: 40px; height: 40px; border-radius: 10px; flex: none; display: flex; align-items: center; justify-content: center; background: var(--dsw-alias-bg-skeleton, #2e2e2e); overflow: hidden; }
.wa-avatar img { width: 100%; height: 100%; object-fit: contain; }
.wa-name { font-size: 14px; font-weight: 600; }
.wa-meta { font-size: 12px; color: var(--dsw-alias-label-secondary, #9aa0a6); }
.wa-desc { font-size: 12px; color: var(--dsw-alias-label-secondary, #9aa0a6); line-height: 18px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.wa-actions { display: flex; gap: 8px; margin-top: auto; flex-wrap: wrap; align-items: center; }
.wa-actions .wa-btn { padding: 6px 12px; font-size: 12.5px; }
.wa-empty { border: 1px dashed var(--dsw-alias-border-l2, #3a3a3a); border-radius: 14px; padding: 48px 24px; text-align: center; color: var(--dsw-alias-label-secondary, #9aa0a6); font-size: 13px; line-height: 22px; }
.wa-section { margin-top: 26px; }
.wa-section-head { display: flex; align-items: baseline; gap: 10px; margin: 0 0 12px; }
.wa-section-title { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; }
.wa-section-hint { font-size: 12px; color: var(--dsw-alias-label-secondary, #9aa0a6); }
.wa-loading { color: var(--dsw-alias-label-secondary, #9aa0a6); font-size: 13px; padding: 12px 0; }
.wa-err-inline { color: #ff9a9a; font-size: 12px; line-height: 18px; }
.wa-err { margin: 12px 0; padding: 10px 12px; border-radius: 8px; background: rgba(229, 72, 77, .12); color: #ff9a9a; font-size: 12px; }
.wa-ok { margin: 12px 0 0; padding: 8px 12px; border-radius: 8px; background: rgba(77, 107, 254, .1); color: #a9bbff; font-size: 12px; }
.wa-progress { height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l1, #333); overflow: hidden; margin-top: 8px; }
.wa-progress > i { display: block; height: 100%; width: 0; background: #4d6bfe; transition: width .15s ease; }
.wa-editor { height: 100%; display: flex; flex-direction: column; }
.wa-editor-bar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1, #333); }
.wa-editor-name { font-size: 13px; font-weight: 600; }
.wa-frame { flex: 1; width: 100%; border: 0; background: #1e1e1e; }
`

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return () => {}
      const el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = CSS
      document.head.appendChild(el)
      return () => { try { el.remove() } catch {} }
    }

    function formatBytes(n) {
      if (!n && n !== 0) return ''
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
      if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
      return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    }

    function api(path, options) {
      return fetch(API + path, { credentials: 'same-origin', ...options }).then(async r => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status))
        return body
      })
    }

    function postJson(path, body) {
      return api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
    }

    function Gallery() {
      const [apps, setApps] = React.useState([])
      const [suites, setSuites] = React.useState(null)
      const [catalogError, setCatalogError] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [busyKey, setBusyKey] = React.useState(null)
      const [progress, setProgress] = React.useState(null)
      const [opened, setOpened] = React.useState(null)
      const [suiteKey, setSuiteKey] = React.useState(null)
      const [lastChecked, setLastChecked] = React.useState(0)
      const [, setClock] = React.useState(0)
      const fileRef = React.useRef(null)

      const loadApps = React.useCallback(() => {
        api('/api/list').then(d => setApps(d.apps || [])).catch(err => setError(err.message))
      }, [])
      const loadCatalog = React.useCallback((force) => {
        setCatalogError(null)
        api('/api/catalog' + (force ? '?refresh=1' : ''))
          .then(d => { setSuites(d.suites || []); setLastChecked(Date.now()) })
          .catch(err => { setSuites([]); setCatalogError(err.message) })
      }, [])
      const refresh = React.useCallback(() => {
        setError(null)
        setNotice(null)
        loadApps()
        loadCatalog(true)
      }, [loadApps, loadCatalog])

      React.useEffect(() => {
        loadApps()
        loadCatalog(false)
      }, [loadApps, loadCatalog])

      // 页面开着时自动复查：窗口重新聚焦/可见，或每 15 分钟（Host 侧缓存 10 分钟，代价很小）
      React.useEffect(() => {
        const tick = () => {
          loadApps()
          loadCatalog(false)
        }
        const timer = setInterval(tick, 15 * 60 * 1000)
        const onVisible = () => { if (document.visibilityState === 'visible') tick() }
        window.addEventListener('focus', tick)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          clearInterval(timer)
          window.removeEventListener('focus', tick)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [loadApps, loadCatalog])

      // 让「上次检查 X 分钟前」每分钟刷新一次
      React.useEffect(() => {
        const timer = setInterval(() => setClock(Date.now()), 60 * 1000)
        return () => clearInterval(timer)
      }, [])

      const onPick = () => fileRef.current && fileRef.current.click()

      const onFile = (event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file) return
        setBusy(true); setError(null); setNotice(null); setProgress(0)
        const xhr = new XMLHttpRequest()
        xhr.open('POST', API + '/api/upload')
        xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
        xhr.setRequestHeader('content-type', 'application/zip')
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100)) }
        xhr.onload = () => {
          setBusy(false); setProgress(null)
          try {
            const body = JSON.parse(xhr.responseText || '{}')
            if (xhr.status >= 200 && xhr.status < 300) loadApps()
            else setError(body.error || ('HTTP ' + xhr.status))
          } catch { setError('HTTP ' + xhr.status) }
        }
        xhr.onerror = () => { setBusy(false); setProgress(null); setError('上传失败') }
        xhr.send(file)
      }

      const install = (key) => {
        setBusyKey(key); setError(null); setNotice(null)
        postJson('/api/install', { key })
          .then((body) => {
            loadApps()
            loadCatalog()
            setNotice('已安装「' + (body.app && body.app.name ? body.app.name : key) + '」')
          })
          .catch(err => setError(err.message))
          .finally(() => setBusyKey(null))
      }

      const remove = (app) => {
        if (!window.confirm('删除应用「' + app.name + '」？应用数据目录会一起删除。')) return
        postJson('/api/delete', { id: app.id }).then(loadApps).catch(err => setError(err.message))
      }

      const openFolder = (app) => {
        setError(null)
        postJson('/api/reveal', { id: app.id })
          .then(() => setNotice('已在文件管理器中打开「' + app.name + '」的安装目录'))
          .catch(err => setError(err.message))
      }

      const suiteList = suites || []
      const suiteApps = suiteList.flatMap(suite => (suite.apps || []).map(app => ({
        ...app,
        suiteKey: suite.key,
        suiteName: suite.name,
        suiteBadge: suite.badge || suite.name,
      })))
      const appByKey = new Map(suiteApps.map(app => [app.key, app]))
      const installedKeys = new Set(apps.map(app => app.id))
      const installedSuiteApps = suiteApps.filter(app => installedKeys.has(app.key))
      const updateCount = suiteApps.filter(app => app.updateAvailable).length
      const suiteAppCount = suiteApps.length
      const checkedLabel = lastChecked
        ? '上次检查 ' + Math.max(0, Math.round((Date.now() - lastChecked) / 60000)) + ' 分钟前'
        : '正在检查…'

      if (opened) return h(Editor, { app: opened, onBack: () => setOpened(null), onReveal: openFolder })

      /* ── 套件子页：只列该套件里还没安装的应用 ── */
      const activeSuite = suiteKey ? suiteList.find(item => item.key === suiteKey) : null
      if (activeSuite) {
        const pending = (activeSuite.apps || []).filter(app => !installedKeys.has(app.key))
        const installedCount = (activeSuite.apps || []).length - pending.length
        return h('div', { className: 'wa-root' },
          h('div', { className: 'wa-head' },
            h('button', { className: 'wa-btn', onClick: () => setSuiteKey(null) }, '← 应用'),
            h('div', null,
              h('h1', { className: 'wa-title' }, activeSuite.name),
              h('p', { className: 'wa-sub' },
                activeSuite.tagline || '',
                ' · ',
                (activeSuite.homepage || 'GitHub Releases'),
                installedCount ? ' · 已安装 ' + installedCount + ' 个' : ''),
            ),
            h('div', { className: 'wa-grow' }),
            h('button', { className: 'wa-btn', onClick: refresh, disabled: busy }, '刷新'),
          ),
          error ? h('div', { className: 'wa-err' }, error) : null,
          notice ? h('div', { className: 'wa-ok' }, notice) : null,
          catalogError ? h('div', { className: 'wa-err-inline' }, '检查失败：' + catalogError) : null,
          suites === null
            ? h('div', { className: 'wa-loading' }, '正在检查 ' + activeSuite.name + '…')
            : pending.length === 0
              ? h('div', { className: 'wa-empty' },
                  h('div', null, '这个套件里的应用都装好了。'),
                  h('div', null, '回到「应用」就可以打开它们。'))
              : h('div', { className: 'wa-grid' },
                  pending.map(app => {
                    const installing = busyKey === app.key
                    return h('div', { key: app.key, className: 'wa-card' },
                      h('div', { className: 'wa-card-top' },
                        h('div', { className: 'wa-avatar' }, h(Icon, { size: 22 })),
                        h('div', null,
                          h('div', { className: 'wa-name' }, app.name),
                          h('div', { className: 'wa-meta' }, app.latest ? '最新 v' + app.latest.version : '版本检查失败'),
                        ),
                      ),
                      h('div', { className: 'wa-desc' }, app.description || ''),
                      app.error ? h('div', { className: 'wa-err-inline' }, app.error) : null,
                      h('div', { className: 'wa-actions' },
                        app.latest
                          ? h('button', {
                              className: 'wa-btn is-primary',
                              disabled: installing,
                              onClick: () => install(app.key),
                            }, installing ? '安装中…' : '安装')
                          : null,
                      ),
                    )
                  }),
                ),
        )
      }

      return h('div', { className: 'wa-root' },
        h('div', { className: 'wa-head' },
          h('div', null,
            h('h1', { className: 'wa-title' }, '应用'),
            h('p', { className: 'wa-sub' }, '已安装的应用在下面；套件收在再下面的卡片里，点进去安装更多。也可以上传自己的静态 Web 应用（zip）。'),
          ),
          h('div', { className: 'wa-grow' }),
          h('button', { className: 'wa-btn', onClick: refresh, disabled: busy }, '刷新'),
          h('button', { className: 'wa-btn is-primary', onClick: onPick, disabled: busy }, busy ? '上传中…' : '上传应用'),
          h('input', { ref: fileRef, type: 'file', accept: '.zip,application/zip', style: { display: 'none' }, onChange: onFile }),
        ),
        progress !== null ? h('div', { className: 'wa-progress' }, h('i', { style: { width: progress + '%' } })) : null,
        error ? h('div', { className: 'wa-err' }, error) : null,
        notice ? h('div', { className: 'wa-ok' }, notice) : null,

        /* ── 已安装（套件里装的 + 上传的 zip）── */
        h('div', { className: 'wa-section' },
          h('div', { className: 'wa-section-head' },
            h('h2', { className: 'wa-section-title' }, '已安装'),
            h('span', { className: 'wa-section-hint' }, apps.length ? apps.length + ' 个应用' : '还没有安装应用'),
          ),
          apps.length === 0
            ? h('div', { className: 'wa-empty' },
                h('div', null, '还没有安装任何应用。'),
                h('div', null, '在下面的套件卡片里安装，或点右上角「上传应用」上传自己的 zip。'))
            : h('div', { className: 'wa-grid' },
                apps.map(app => {
                  const meta = appByKey.get(app.id)
                  const updating = busyKey === app.id
                  const desc = (meta && meta.description) || app.description
                  return h('div', { key: app.id, className: 'wa-card' },
                    h('div', { className: 'wa-card-top' },
                      h('div', { className: 'wa-avatar' }, app.icon ? h('img', { src: app.icon, alt: '' }) : h(Icon, { size: 22 })),
                      h('div', null,
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                          h('div', { className: 'wa-name' }, app.name),
                          meta && meta.updateAvailable && meta.latest
                            ? h('span', { className: 'wa-badge' }, '可更新 v' + meta.latest.version)
                            : null),
                        h('div', { className: 'wa-meta' },
                          'v' + app.version
                          + (app.bytes ? ' · ' + formatBytes(app.bytes) : '')
                          + ' · ' + (meta ? meta.suiteBadge : '上传')),
                      ),
                    ),
                    desc ? h('div', { className: 'wa-desc' }, desc) : null,
                    h('div', { className: 'wa-actions' },
                      h('button', {
                        className: 'wa-btn is-primary',
                        onClick: () => setOpened(meta && meta.updateAvailable && meta.latest ? { ...app, updateVersion: meta.latest.version } : app),
                      }, '打开'),
                      h('button', { className: 'wa-btn', onClick: () => openFolder(app) }, '打开目录'),
                      meta && meta.updateAvailable && meta.latest
                        ? h('button', {
                            className: 'wa-btn',
                            disabled: updating,
                            onClick: () => install(app.id),
                          }, updating ? '更新中…' : '更新到 v' + meta.latest.version)
                        : null,
                      h('button', { className: 'wa-btn', onClick: () => remove(app) }, '删除'),
                    ),
                  )
                }),
              ),
        ),

        /* ── 套件入口（和已安装卡片同尺寸，点开是未安装列表子页）── */
        h('div', { className: 'wa-section' },
          h('div', { className: 'wa-section-head' },
            h('h2', { className: 'wa-section-title' }, '套件'),
            h('span', { className: 'wa-section-hint' },
              suites === null ? checkedLabel : suiteList.length + ' 个套件 · ' + suiteAppCount + ' 个应用 · ' + checkedLabel),
          ),
          suites === null
            ? h('div', { className: 'wa-loading' }, '正在检查套件…')
            : h('div', { className: 'wa-grid' },
                suiteList.map(suite => {
                  const suiteInstalled = (suite.apps || []).filter(app => installedKeys.has(app.key)).length
                  const suiteUpdates = (suite.apps || []).filter(app => app.updateAvailable).length
                  return h('div', {
                    key: suite.key,
                    className: 'wa-card is-link',
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => setSuiteKey(suite.key),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSuiteKey(suite.key)
                      }
                    },
                  },
                    h('div', { className: 'wa-card-top' },
                      h('div', { className: 'wa-avatar' }, h(Icon, { size: 22 })),
                      h('div', null,
                        h('div', { className: 'wa-name' }, suite.name),
                        h('div', { className: 'wa-meta' },
                          (suite.apps || []).length + ' 个应用 · 已安装 ' + suiteInstalled
                          + (suiteUpdates > 0 ? ' · ' + suiteUpdates + ' 个可更新' : '')),
                      ),
                    ),
                    h('div', { className: 'wa-desc' }, suite.tagline || ''),
                    h('div', { className: 'wa-actions' },
                      h('button', {
                        className: 'wa-btn is-primary',
                        onClick: (event) => { event.stopPropagation(); setSuiteKey(suite.key) },
                      }, '查看套件'),
                    ),
                  )
                }),
              ),
          catalogError ? h('div', { className: 'wa-err-inline', style: { marginTop: 10 } }, '套件检查失败：' + catalogError) : null,
        ),
      )
    }

    function Editor({ app, onBack, onReveal }) {
      return h('div', { className: 'wa-editor' },
        h('div', { className: 'wa-editor-bar' },
          h('button', { className: 'wa-btn', onClick: onBack }, '← 应用'),
          h('span', { className: 'wa-editor-name' }, app.name),
          h('span', { className: 'wa-meta' }, 'v' + app.version),
          app.updateVersion ? h('span', { className: 'wa-badge' }, '可更新 v' + app.updateVersion) : null,
          h('div', { className: 'wa-grow' }),
          onReveal ? h('button', { className: 'wa-btn', onClick: () => onReveal(app) }, '打开目录') : null,
          h('button', { className: 'wa-btn', onClick: () => window.open(app.url, '_blank', 'noopener') }, '新窗口打开'),
        ),
        h('iframe', {
          className: 'wa-frame',
          src: app.url,
          title: app.name,
          allow: 'fullscreen; autoplay; clipboard-read; clipboard-write',
          allowFullScreen: true,
          sandbox: 'allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-pointer-lock',
        }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const disposers = []
        try { disposers.push(ensureStyles()) } catch {}
        try {
          disposers.push(ctx.slots.inject('main', () => ctx.slots.register(
            { name: 'main', key: ID }, Gallery,
          )))
        } catch (err) { console.error('[' + ID + '] register main failed', err) }
        try {
          disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
            { name: 'sidebar.panellist', id: ID, order: 6, label: '应用' }, Icon,
          )))
        } catch (err) { console.error('[' + ID + '] register panellist failed', err) }
        return () => {
          for (const dispose of disposers) {
            try { if (typeof dispose === 'function') dispose() } catch {}
          }
        }
      },
    }
  },
})
