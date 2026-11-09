import { maxPackageSize, renderRecords, unseal } from './vault-crypto.js'

const form = document.getElementById('read-share')
const status = document.getElementById('reader-status')
const gate = document.getElementById('reader-gate')
const content = document.getElementById('reader-content')
const records = document.getElementById('reader-records')
const submit = form.querySelector('button')
let ciphertext
let timer
let revision = 0

function lock () {
  revision++
  clearTimeout(timer)
  records.replaceChildren()
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
    if (!file && !ciphertext) {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error('请打开有效的分享链接，或选择加密文件。')
      const response = await fetch('./shares/' + id + '.vault', { cache: 'no-store' })
      if (!response.ok) throw new Error('分享文件尚未发布，或链接已经失效。')
      if (Number(response.headers.get('Content-Length')) > maxPackageSize) throw new Error('分享文件过大。')
      const payload = await response.blob()
      if (request !== revision) return
      ciphertext = payload
    }
    const archive = await unseal('share', password, file || ciphertext)
    if (request !== revision) return
    renderRecords(records, archive.records)
    status.textContent = ''
    gate.hidden = true
    content.hidden = false
    activity()
  } catch (error) {
    if (request === revision) status.textContent = error.message || '无法打开分享。'
  } finally {
    submit.disabled = false
  }
})

document.getElementById('reader-lock').addEventListener('click', lock)
for (const event of ['keydown', 'pointerdown']) document.addEventListener(event, activity)
window.addEventListener('hashchange', () => {
  ciphertext = undefined
  form.reset()
  lock()
})
window.addEventListener('pagehide', lock)
