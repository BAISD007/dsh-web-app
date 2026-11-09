/**
 * dsh-web-app 文件桥（自动注入到托管的 Web 应用里）。
 *
 * 目标：让托管应用里「保存 / 导出」产生的下载落到 DSH 的可见目录，而不是浏览器下载列表，
 * 同时在页面上给一条「已保存到 …」的提示，并把消息发给插件页面（可以点「打开保存目录」）。
 *
 * 只接管 <a download> + blob:/data: 的下载；桥接失败会退回浏览器原生下载，不会丢文件。
 */
(function () {
  if (window.__DSH_WEB_APP_BRIDGE__) return
  window.__DSH_WEB_APP_BRIDGE__ = true

  var APP_ID = ''
  try {
    var matched = /^\/web-apps\/app\/([^/]+)\//.exec(location.pathname)
    APP_ID = matched ? decodeURIComponent(matched[1]) : ''
  } catch (_) {}
  if (!APP_ID) return

  function toast(text) {
    try {
      var el = document.createElement('div')
      el.textContent = text
      el.style.cssText = [
        'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483647',
        'max-width:70vw', 'padding:9px 13px', 'border-radius:9px',
        'background:rgba(20,20,22,.92)', 'color:#f2f2f2',
        'font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
        'box-shadow:0 8px 24px rgba(0,0,0,.35)', 'pointer-events:none', 'white-space:pre-wrap',
      ].join(';')
      document.documentElement.appendChild(el)
      setTimeout(function () { try { el.remove() } catch (_) {} }, 6000)
    } catch (_) {}
  }

  function notify(saved) {
    var payload = {
      type: 'dsh-web-app:saved',
      appId: APP_ID,
      name: saved && saved.name,
      path: saved && saved.path,
      dir: saved && saved.dir,
    }
    var hosted = false
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*')
        hosted = true
      }
    } catch (_) {}
    if (hosted) return
    var line = saved && saved.name ? '已保存「' + saved.name + '」到 DSH 保存目录' : '已保存到 DSH 保存目录'
    toast(saved && saved.path ? line + '\n' + saved.path : line)
  }

  async function upload(name, blob) {
    var res = await fetch('/web-apps/api/save', {
      method: 'POST',
      headers: {
        'content-type': blob.type || 'application/octet-stream',
        'x-app-id': encodeURIComponent(APP_ID),
        'x-save-name': encodeURIComponent(name || 'file'),
      },
      body: blob,
    })
    var body = await res.json().catch(function () { return {} })
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status))
    return body
  }

  function fileNameFor(anchor) {
    var attr = anchor.getAttribute && anchor.getAttribute('download')
    if (attr && attr.trim()) return attr.trim()
    try {
      var path = new URL(anchor.href, location.href).pathname
      var name = decodeURIComponent(path.split('/').pop() || '')
      return name || 'file'
    } catch (_) {
      return 'file'
    }
  }

  var nativeClick = HTMLAnchorElement.prototype.click
  var bridging = false

  function startBridge(anchor) {
    if (!anchor || bridging) return false
    var href = anchor.href || ''
    if (!/^(blob:|data:)/i.test(href)) return false
    var name = fileNameFor(anchor)
    bridging = true
    ;(async function () {
      try {
        var blob = await (await fetch(href)).blob()
        // 太大的文件不搬进内存，直接走浏览器下载
        if (blob.size > 256 * 1024 * 1024) throw new Error('文件超过 256 MB')
        var saved = await upload(name, blob)
        notify(saved)
      } catch (err) {
        toast('保存到 DSH 目录失败，改用浏览器下载：' + (err && err.message ? err.message : err))
        try {
          var fallback = document.createElement('a')
          fallback.href = href
          fallback.download = name
          fallback.setAttribute('data-dsh-bridge-fallback', '1')
          fallback.style.display = 'none'
          document.body.appendChild(fallback)
          nativeClick.call(fallback)
          setTimeout(function () { try { fallback.remove() } catch (_) {} }, 1000)
        } catch (_) {}
      } finally {
        bridging = false
      }
    })()
    return true
  }

  function patchedClick() {
    if (this && this.getAttribute && this.getAttribute('data-dsh-bridge-fallback')) {
      return nativeClick.call(this)
    }
    if (this && this.hasAttribute && this.hasAttribute('download') && startBridge(this)) return
    return nativeClick.call(this)
  }

  try {
    HTMLAnchorElement.prototype.click = patchedClick
  } catch (_) {}

  // 用户直接点击页面里的 <a download>（不是脚本 click）也接管
  document.addEventListener('click', function (event) {
    var target = event.target
    var anchor = target && target.closest ? target.closest('a[download]') : null
    if (!anchor) return
    if (anchor.getAttribute('data-dsh-bridge-fallback')) return
    if (startBridge(anchor)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }, true)

  // 给其它想主动保存的页面用：window.__DSH_WEB_APP_BRIDGE_SAVE__(name, blob)
  window.__DSH_WEB_APP_BRIDGE_SAVE__ = async function (name, blob) {
    var saved = await upload(name, blob)
    notify(saved)
    return saved
  }
})()
