const { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol, session } = require('electron')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { randomUUID } = require('node:crypto')

const APP = 'study://app'
const ROOT = join(__dirname, '..', 'web')
const MEDIA_PERMISSIONS = new Set(['media', 'display-capture', 'clipboard-sanitized-write'])
let window
let capture

app.setName('松间')
app.setAppUserModelId('Studyroom.Meeting')
protocol.registerSchemesAsPrivileged([{ scheme: 'study', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

function trusted(url) {
  try {
    const resolved = new URL(url)
    return resolved.protocol === 'study:' && resolved.host === 'app' && !resolved.username && !resolved.password
  } catch { return false }
}

function settle(result) {
  if (!capture) return
  const { callback, timeout } = capture
  clearTimeout(timeout)
  capture = undefined
  callback(result)
}

async function chooseDisplay(request, callback) {
  if (capture || !window || request.frame !== window.webContents.mainFrame ||
      !trusted(request.frame.url) || !request.userGesture || !request.videoRequested) {
    callback(null)
    return
  }
  const token = randomUUID()
  capture = { token, callback, timeout: setTimeout(() => settle(null), 45000), sources: [] }
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 280, height: 158 } })
    if (!window || capture?.token !== token) return
    capture.sources = sources.slice(0, 80)
    if (!capture.sources.length) { settle(null); return }
    window.webContents.send('study-capture-list', {
      token,
      sources: capture.sources.map(source => ({
        id: source.id, name: source.name,
        thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL()
      }))
    })
  } catch {
    if (capture?.token === token) settle(null)
  }
}

function openWindow() {
  window = new BrowserWindow({
    width: 1350, height: 900, minWidth: 450, minHeight: 620,
    backgroundColor: '#0d0f19', autoHideMenuBar: true, title: '松间 · 多人在线自习室',
    icon: join(ROOT, 'assets', 'app.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true, devTools: !app.isPackaged
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!trusted(url)) event.preventDefault()
  })
  window.on('closed', () => { window = undefined; settle(null) })
  void window.loadURL(`${APP}/`)
}

app.whenReady().then(async () => {
  protocol.handle('study', async request => {
    const { pathname } = new URL(request.url)
    const route = pathname === '/' ? '/index.html' : pathname
    if (!trusted(request.url) || !/^\/(assets\/)?[a-z0-9_-]+\.(html|js|css|svg|webp|png)$/i.test(route)) {
      return new Response('Not found', { status: 404 })
    }
    // Explicit content types are required for modules on a registered scheme.
    const file = await net.fetch(pathToFileURL(join(ROOT, route.slice(1))).href)
    const headers = new Headers(file.headers)
    if (route.endsWith('.js')) headers.set('Content-Type', 'text/javascript; charset=utf-8')
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'no-referrer')
    return new Response(file.body, { status: file.status, headers })
  })
  const mediaSession = session.defaultSession
  mediaSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    contents === window?.webContents && trusted(origin) && (details?.isMainFrame ?? true) && MEDIA_PERMISSIONS.has(permission))
  mediaSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(contents === window?.webContents && trusted(details.requestingUrl || contents.getURL()) &&
      (details.isMainFrame ?? true) && MEDIA_PERMISSIONS.has(permission)))
  mediaSession.setDisplayMediaRequestHandler(chooseDisplay)
  mediaSession.on('will-download', (event, item, contents) => {
    if (contents !== window?.webContents || !item.getURL().startsWith(`blob:${APP}/`) ||
        item.getMimeType() !== 'image/png') event.preventDefault()
  })
  ipcMain.on('study-capture-choice', (event, token, sourceId) => {
    if (!window || !capture || event.senderFrame !== window.webContents.mainFrame || !trusted(event.senderFrame.url) ||
        event.sender !== window.webContents || token !== capture.token || typeof sourceId !== 'string') return
    const source = capture.sources.find(item => item.id === sourceId)
    settle(source ? { video: source } : null)
  })
  if (require('../package.json').localPreview) {
    const { startLocal } = await import('../server/local.mjs')
    const { server } = startLocal({ env: {} })
    server.on('error', error => {
      if (error.code !== 'EADDRINUSE') console.error('Local meeting service:', error.code)
    })
  }
  openWindow()
})

app.on('window-all-closed', () => app.quit())
