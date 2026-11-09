import { base64, deriveKey, download, el, localDay, maxPackageSize, randomBytes, renderRecords, seal, unseal } from './vault-crypto.js'

const get = id => document.getElementById(id)
const gate = get('gate')
const content = get('vault-content')
const unlockForm = get('unlock-form')
const entryForm = get('entry-form')
const filter = get('entry-filter')
const paperYear = get('paper-year')
const selected = new Set()
let db
let snapshot
let owner
let editing
let share
let timer
let saving = false

function notify (text) {
  get('vault-status').textContent = text
}

function openDatabase () {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('zayden-private-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('vault')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function readArchive () {
  return new Promise((resolve, reject) => {
    const request = db.transaction('vault').objectStore('vault').get('owner')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function writeArchive (blob, expectedRevision) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('vault', 'readwrite')
    const store = transaction.objectStore('vault')
    const read = store.get('owner')
    let stale = false
    const next = { blob, revision: expectedRevision + 1 }
    read.onsuccess = () => {
      if ((read.result?.revision || 0) !== expectedRevision) {
        stale = true
        transaction.abort()
        return
      }
      store.put(next, 'owner')
    }
    transaction.oncomplete = () => resolve(next)
    transaction.onabort = () => reject(stale
      ? new Error('资料库已在另一个页面修改。请锁定并重新打开。')
      : new Error('保存失败，请检查浏览器的存储权限或空间。'))
  })
}

function updateGate () {
  const exists = Boolean(snapshot)
  get('create-options').hidden = exists
  unlockForm.elements.confirmation.disabled = exists
  unlockForm.elements.backup.disabled = exists
  get('gate-title').textContent = exists ? '打开资料库' : '创建或恢复资料库'
  get('unlock').textContent = exists ? '打开资料库' : '创建或恢复'
}

function showFields () {
  const kind = entryForm.elements.kind.value
  get('photo-fields').hidden = kind !== 'photo'
  get('paper-fields').hidden = kind !== 'paper'
  entryForm.elements.photo.required = kind === 'photo' && !editing
}

function edit (record) {
  editing = record
  entryForm.reset()
  entryForm.elements.kind.value = record?.kind || 'photo'
  entryForm.elements.kind.disabled = Boolean(record)
  entryForm.elements.title.value = record?.title || ''
  entryForm.elements.date.value = record?.date || localDay()
  entryForm.elements.note.value = record?.note || ''
  entryForm.elements.paperStatus.value = record?.paperStatus || 'writing'
  get('entry-heading').textContent = record ? '编辑记录' : '添加记录'
  get('entry-cancel').hidden = !record
  showFields()
}

function clearShare () {
  share = undefined
  get('share-result').hidden = true
  get('share-link').value = ''
  get('share-password').value = ''
}

function lock (feedback = '资料库已锁定。') {
  if (!owner) return
  clearTimeout(timer)
  owner = undefined
  selected.clear()
  clearShare()
  edit()
  get('records').replaceChildren()
  get('paper-summary').textContent = ''
  content.hidden = true
  gate.hidden = false
  updateGate()
  notify(feedback)
}

function activity () {
  if (!owner) return
  clearTimeout(timer)
  timer = setTimeout(() => lock(), 10 * 60 * 1000)
}

function render () {
  if (!owner) return
  const papers = owner.records.filter(record => record.kind === 'paper')
  const thisYear = localDay().slice(0, 4)
  const oldYear = paperYear.value
  const years = [...new Set([thisYear, ...papers.map(record => record.date.slice(0, 4))])].sort().reverse()
  paperYear.replaceChildren(...years.map(year => new Option(year + ' 年', year)))
  paperYear.value = years.includes(oldYear) ? oldYear : thisYear
  const annual = papers.filter(record => record.date.startsWith(paperYear.value + '-'))
  const count = status => annual.filter(record => record.paperStatus === status).length
  get('paper-summary').textContent =
    `论文 ${annual.length} 篇 · 已发表 ${count('published')} · 已投稿 ${count('submitted')} · 写作中 ${count('writing')}`

  const visible = owner.records.filter(record => filter.value === 'all' || record.kind === filter.value)
  renderRecords(get('records'), visible, record => {
    const actions = el('div', '', 'actions')
    const check = el('input')
    check.type = 'checkbox'
    check.id = 'share-' + record.id
    check.checked = selected.has(record.id)
    check.addEventListener('change', () => {
      if (check.checked) selected.add(record.id)
      else selected.delete(record.id)
      clearShare()
    })
    const label = el('label', '加入分享')
    label.htmlFor = check.id
    const change = el('button', '编辑', 'secondary compact')
    change.addEventListener('click', () => {
      edit(record)
      entryForm.elements.title.focus()
    })
    const remove = el('button', '删除', 'secondary compact')
    remove.addEventListener('click', async () => {
      if (saving || !owner || !confirm(`删除「${record.title}」？`)) return
      if (await persist(owner.records.filter(item => item.id !== record.id))) {
        selected.delete(record.id)
        if (editing?.id === record.id) edit()
        notify('已删除记录。')
      }
    })
    actions.append(check, label, change, remove)
    return actions
  })
}

async function persist (records) {
  const unlocked = owner
  if (!unlocked || saving) return false
  saving = true
  get('entry-save').disabled = true
  try {
    const blob = await seal('owner', unlocked.key, unlocked.salt, records)
    if (owner !== unlocked) return false
    snapshot = await writeArchive(blob, snapshot.revision)
    if (owner !== unlocked) return false
    unlocked.records = records
    clearShare()
    render()
    return true
  } catch (error) {
    notify(error.message)
    return false
  } finally {
    saving = false
    get('entry-save').disabled = false
  }
}

async function compressPhoto (file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20_000_000) {
    throw new Error('请选择一张 20 MB 以内的 JPG、PNG 或 WebP 图片。')
  }
  const image = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height))
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  try {
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  } finally {
    image.close()
  }
  const result = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85))
  if (result?.type !== 'image/webp') throw new Error('当前浏览器无法转换 WebP 图片。')
  return base64(new Uint8Array(await result.arrayBuffer()))
}

unlockForm.addEventListener('submit', async event => {
  event.preventDefault()
  const button = get('unlock')
  if (!db || button.disabled) return
  button.disabled = true
  const password = unlockForm.elements.password.value
  const confirmation = unlockForm.elements.confirmation.value
  const backup = unlockForm.elements.backup.files[0]
  unlockForm.reset()
  notify('正在打开资料库…')
  try {
    snapshot = await readArchive()
    if (snapshot) {
      owner = await unseal('owner', password, snapshot.blob)
    } else if (backup) {
      const restored = await unseal('owner', password, backup)
      snapshot = await writeArchive(backup, 0)
      owner = restored
    } else {
      if (password.length < 16 || password !== confirmation) throw new Error('两次密码须一致，并且至少 16 位。')
      const salt = randomBytes(16)
      const key = await deriveKey(password, salt)
      const records = []
      snapshot = await writeArchive(await seal('owner', key, salt, records), 0)
      owner = { key, salt, records }
    }
    gate.hidden = true
    content.hidden = false
    edit()
    render()
    activity()
    notify('')
  } catch (error) {
    updateGate()
    notify(error.message || '无法打开资料库。')
  } finally {
    button.disabled = false
  }
})

entryForm.addEventListener('submit', async event => {
  event.preventDefault()
  const unlocked = owner
  const button = get('entry-save')
  if (!unlocked || saving || button.disabled) return
  const title = entryForm.elements.title.value.trim()
  const date = entryForm.elements.date.value
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return notify('请输入标题和有效日期。')
  const kind = entryForm.elements.kind.value
  const record = { id: editing?.id || crypto.randomUUID(), kind, date, title, note: entryForm.elements.note.value.trim() }
  button.disabled = true
  try {
    if (kind === 'paper') record.paperStatus = entryForm.elements.paperStatus.value
    if (kind === 'photo') {
      const file = entryForm.elements.photo.files[0]
      record.photo = file ? await compressPhoto(file) : editing?.photo
      if (!record.photo) throw new Error('请选择一张照片。')
    }
    if (owner !== unlocked) return
    const records = unlocked.records.filter(item => item.id !== record.id)
    if (await persist([...records, record])) {
      edit()
      notify('已加密保存记录。')
    }
  } catch (error) {
    notify(error.message || '无法保存记录。')
  } finally {
    button.disabled = false
  }
})

get('make-share').addEventListener('click', async event => {
  const unlocked = owner
  if (!unlocked) return
  const records = unlocked.records.filter(record => selected.has(record.id))
  if (!records.length) return notify('请勾选至少一条要分享的记录。')
  const button = event.currentTarget
  button.disabled = true
  clearShare()
  try {
    const password = base64(randomBytes(18)).replaceAll('+', '-').replaceAll('/', '_')
    const salt = randomBytes(16)
    const id = crypto.randomUUID()
    const key = await deriveKey(password, salt)
    const blob = await seal('share', key, salt, records)
    if (owner !== unlocked) return
    share = { blob, id }
    get('share-link').value = new URL('share.html#' + id, location.href).href
    get('share-password').value = password
    get('share-result').hidden = false
    notify('分享文件已生成。发布加密文件后，链接即可使用。')
  } catch (error) {
    notify(error.message || '无法生成分享。')
  } finally {
    button.disabled = false
  }
})

get('save-share').addEventListener('click', () => {
  if (share) download(share.blob, share.id + '.vault')
})
get('backup').addEventListener('click', () => {
  if (owner && snapshot.blob.size <= maxPackageSize) download(snapshot.blob, 'treehouse-owner-' + localDay() + '.vault')
})
get('lock').addEventListener('click', () => lock())
get('entry-cancel').addEventListener('click', () => edit())
entryForm.elements.kind.addEventListener('change', showFields)
filter.addEventListener('change', render)
paperYear.addEventListener('change', render)
for (const event of ['keydown', 'pointerdown']) document.addEventListener(event, activity)
window.addEventListener('pagehide', () => lock())

try {
  if (!crypto.subtle) throw new Error('HTTPS required')
  db = await openDatabase()
  snapshot = await readArchive()
  updateGate()
  get('unlock').disabled = false
} catch {
  notify('无法开启加密存储。请通过 HTTPS 打开，并检查浏览器的存储权限。')
}
