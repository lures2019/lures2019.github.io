import { maxPackageSize, unseal } from './vault-crypto.js?v=9'
import { readCloudShare, shareIdPattern } from './vault-cloud.js'
import { createLibrary } from './vault-library.js?v=10'
import { openBundle } from './vault-media.js?v=8'

const form = document.getElementById('read-share')
const status = document.getElementById('reader-status')
const gate = document.getElementById('reader-gate')
const content = document.getElementById('reader-content')
const records = document.getElementById('reader-records')
const submit = form.querySelector('button')
const library = createLibrary(records, { mediaOptions: () => ({ bundle, shareKey }) })
let ciphertext
let bundle
let shareKey
let timer
let revision = 0

function lock () {
  revision++
  clearTimeout(timer)
  library.clear()
  ciphertext = undefined
  bundle = undefined
  shareKey = undefined
  form.elements.file.value = ''
  content.hidden = true
  gate.hidden = false
  status.textContent = '已锁定分享。'
  form.elements.password.focus()
}

function activity () {
  if (!content.hidden) {
    clearTimeout(timer)
    timer = setTimeout(lock, 10 * 60 * 1000)
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  const password = form.elements.password.value
  const file = form.elements.file.files[0]
  const id = location.hash.slice(1)
  const request = ++revision
  form.elements.password.value = ''
  submit.disabled = true
  status.textContent = '正在解锁…'
  try {
    const cloud = id.startsWith('cloud-')
    if (!file && (cloud || !ciphertext)) {
      const shareId = cloud ? id.slice(6) : id
      let payload
      if (cloud) {
        payload = await readCloudShare(shareId)
      } else {
        if (!shareIdPattern.test(shareId.toLowerCase())) throw new Error('请打开有效的分享链接，或选择加密文件。')
        const response = await fetch('./shares/' + shareId + '.vault', { cache: 'no-store' })
        if (!response.ok) throw new Error('分享文件尚未发布，或链接已经失效。')
        if (Number(response.headers.get('Content-Length')) > maxPackageSize) throw new Error('分享文件过大。')
        payload = await response.blob()
      }
      if (request !== revision) return
      ciphertext = payload
    }
    const payload = await openBundle(file || ciphertext)
    const archive = await unseal('share', password, payload.archive)
    if (request !== revision) return
    bundle = payload
    shareKey = !file && cloud ? id.slice(6) : undefined
    library.show(archive.records)
    status.textContent = ''
    gate.hidden = true
    content.hidden = false
    activity()
  } catch (error) {
    if (request === revision) status.textContent = (error.message || '无法打开分享。') +
      (!file && id.startsWith('cloud-') && (!error.status || error.status >= 500) && !ciphertext ? ' 也可以选择分享者发来的 .vault 文件离线解锁。' : '')
  } finally {
    submit.disabled = false
  }
})

document.getElementById('reader-lock').addEventListener('click', lock)
for (const event of ['keydown', 'pointerdown']) document.addEventListener(event, activity)
window.addEventListener('hashchange', () => {
  form.reset()
  lock()
})
window.addEventListener('pagehide', lock)
