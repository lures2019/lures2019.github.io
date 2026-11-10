import { base64, deriveKey, download, el, localDay, randomBytes, seal, unseal } from './vault-crypto.js'
import { createLibrary, paperDetails } from './vault-library.js'
import { cacheImportedMedia, draftMedia, makeBundle, openBundle, syncImportedMedia, uploadMedia } from './vault-media.js'
import { recordMedia } from './vault-media-model.js'
import { insertText, richBody, richToolbar } from './vault-rich.js'
import {
  closeCloudShare, cloudConfigured, cloudConnected, connectCloud, disconnectCloud, emptyRevision, listCloudShares,
  loadCloudArchive, publishCloudShare, remoteRevision, resumeCloud, uploadCloudArchive
} from './vault-cloud.js'

const get = id => document.getElementById(id)
const gate = get('gate')
const content = get('vault-content')
const unlockForm = get('unlock-form')
const entryForm = get('entry-form')
const selected = new Set()
const library = createLibrary(get('records'), { controls: recordControls, mediaOptions: () => ({ owner: true }), editPaper: beginEdit })
let db
let snapshot
let owner
let editing
let share
let timer
let saving = false
let syncing = false
let backupAllowed = false
let syncTimer
let cloudConflict = false
let preferCloud = false
let attachments = []
let paperPdfRemoved = false
let importedMedia = []

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

function updateArchive (change) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('vault', 'readwrite')
    const store = transaction.objectStore('vault')
    const read = store.get('owner')
    let next
    let failure
    read.onsuccess = () => {
      try {
        next = change(read.result)
        if (next !== read.result) store.put(next, 'owner')
      } catch (error) {
        failure = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => resolve(next)
    transaction.onabort = () => reject(failure || new Error('保存失败，请检查浏览器的存储权限或空间。'))
  })
}

function writeArchive (blob, expectedRevision, remote) {
  return updateArchive(current => {
    if ((current?.revision || 0) !== expectedRevision) {
      throw new Error('资料库已在另一个页面修改。请锁定并重新打开。')
    }
    return {
      blob, revision: expectedRevision + 1, id: remote?.base.slice(1, -1) || crypto.randomUUID(),
      base: remote?.base || current?.base || emptyRevision, pending: !remote
    }
  })
}

async function recordBackup (sent, base) {
  const current = await updateArchive(local => {
    if (!local || local.revision < sent.revision || local.base !== sent.base) return local
    return { ...local, base, pending: local.id !== sent.id }
  })
  if (current && current.revision >= snapshot.revision) snapshot = current
}

function updateCloud (text) {
  if (!cloudConfigured) return
  const connected = cloudConnected()
  get('cloud-connect').hidden = connected
  get('cloud-disconnect').hidden = !connected
  get('cloud-retry').hidden = !connected || !owner || !snapshot?.pending || syncing || cloudConflict
  get('cloud-restore').hidden = !connected || !owner || !cloudConflict
  get('cloud-share-manager').hidden = !connected
  if (!owner && db) get('unlock').disabled = !connected && !snapshot
  if (text !== undefined) get('cloud-status').textContent = text
}

function queueBackup (delay = 350) {
  clearTimeout(syncTimer)
  if (cloudConnected() && backupAllowed && snapshot?.pending && !cloudConflict) {
    syncTimer = setTimeout(syncBackup, delay)
  }
}

async function syncBackup () {
  if (!cloudConnected() || !backupAllowed || !snapshot?.pending || cloudConflict || syncing) return
  const sent = snapshot
  syncing = true
  updateCloud('正在将加密备份保存到 GitHub…')
  let retryDelay = 350
  let retry = true
  try {
    await syncImportedMedia(importedMedia)
    importedMedia = []
    const base = await uploadCloudArchive(sent)
    await recordBackup(sent, base)
    updateCloud(snapshot.pending ? '有新改动，准备继续备份。' : '已备份到 GitHub 私仓。')
  } catch (error) {
    if (error.status === 409) cloudConflict = true
    retryDelay = 30_000
    retry = !error.status || error.status >= 500
    updateCloud(cloudConflict
      ? '私仓已有新版本，本机改动已保留。可先下载本机备份，再使用私仓版本。'
      : '已保存在本机，私仓备份尚未完成。' + error.message)
  } finally {
    syncing = false
    updateCloud()
    if (retry) queueBackup(retryDelay)
  }
}

async function openVault (password, confirmation, backup) {
  snapshot = await readArchive()
  let cloudRevision
  if (cloudConnected()) {
    try {
      cloudRevision = await remoteRevision()
    } catch (error) {
      updateCloud(error.message)
      if (!snapshot || preferCloud) throw error
    }
  }
  if (preferCloud || (cloudRevision && cloudRevision !== emptyRevision &&
      (!snapshot || (snapshot.pending === false && cloudRevision !== snapshot.base)))) {
    const remote = await loadCloudArchive()
    const unlocked = await unseal('owner', password, remote.blob)
    snapshot = await writeArchive(remote.blob, snapshot?.revision || 0, remote)
    preferCloud = false
    cloudConflict = false
    updateCloud('已从 GitHub 私仓恢复。')
    return unlocked
  }
  if (snapshot) {
    const unlocked = await unseal('owner', password, snapshot.blob)
    if (!snapshot.id && cloudConfigured) snapshot = await writeArchive(snapshot.blob, snapshot.revision)
    if (cloudRevision) {
      if (snapshot.pending && cloudRevision === '"' + snapshot.id + '"') await recordBackup(snapshot, cloudRevision)
      cloudConflict = snapshot.base !== cloudRevision
      updateCloud(cloudConflict ? '私仓已有新版本，本机副本已保留。' :
        snapshot.pending ? '准备备份本机资料。' : '已备份到 GitHub 私仓。')
    }
    return unlocked
  }
  if (backup) {
    const bundle = await openBundle(backup)
    const unlocked = await unseal('owner', password, bundle.archive)
    await cacheImportedMedia(bundle, recordMedia(unlocked.records))
    snapshot = await writeArchive(bundle.archive, 0)
    return unlocked
  }
  if (password.length < 16 || password !== confirmation) throw new Error('两次密码须一致，并且至少 16 位。')
  const salt = randomBytes(16)
  const key = await deriveKey(password, salt)
  const records = []
  snapshot = await writeArchive(await seal('owner', key, salt, records), 0)
  return { key, salt, records }
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
  const rich = kind === 'journal' || kind === 'paper'
  get('photo-fields').hidden = kind !== 'photo'
  get('video-fields').hidden = kind !== 'video'
  get('paper-fields').hidden = kind !== 'paper'
  get('paper-pdf-fields').hidden = !entryForm.elements.paperPublished.checked
  get('note-toolbar').hidden = !rich
  get('rich-fields').hidden = !rich
  get('attachment-fields').hidden = kind === 'video'
  get('attachment-help').textContent = '每条记录最多 16 个附件。' + (rich ? '选择图片后可插入正文。' : '附件显示在照片配文下方。')
  get('entry-note-label').textContent = { photo: '照片配文', video: '视频配文', journal: '日记正文', paper: '论文笔记' }[kind]
  entryForm.elements.photo.required = kind === 'photo' && !editing
  entryForm.elements.video.required = kind === 'video' && !editing
  showAttachments()
}

function edit (record) {
  editing = record
  entryForm.reset()
  entryForm.elements.kind.value = record?.kind || 'photo'
  entryForm.elements.kind.disabled = Boolean(record)
  entryForm.elements.title.value = record?.title || ''
  entryForm.elements.date.value = record?.date || localDay()
  entryForm.elements.note.value = record?.note || ''
  entryForm.elements.category.value = record?.category || ''
  entryForm.elements.noteFont.value = record?.font || 'sans'
  const paper = record?.kind === 'paper' ? paperDetails(record) : {}
  entryForm.elements.paperJournal.value = record?.journal || ''
  entryForm.elements.paperSubmitted.value = paper.submitted || ''
  entryForm.elements.paperAccepted.value = paper.accepted || 'pending'
  entryForm.elements.paperPublished.checked = Boolean(paper.published)
  attachments = (record?.attachments || []).map(ref => ({ ref }))
  paperPdfRemoved = false
  get('note-preview').replaceChildren()
  get('note-preview').hidden = true
  get('entry-heading').textContent = record ? '编辑记录' : '添加记录'
  get('entry-cancel').hidden = !record
  showFields()
}

function beginEdit (record) {
  if (get('entry-save').disabled) return
  edit(record)
  entryForm.elements.title.focus()
}

function showAttachments () {
  const pdf = !paperPdfRemoved && editing?.pdf
  get('paper-pdf-name').textContent = pdf ? '当前文件：' + pdf.name : ''
  get('remove-paper-pdf').hidden = !pdf
  get('attachment-list').replaceChildren(...attachments.map(item => {
    const row = el('li', item.ref.name)
    if (['journal', 'paper'].includes(entryForm.elements.kind.value) && /^image\/(png|jpeg|gif|webp)$/.test(item.ref.type)) {
      const insert = el('button', '插入正文', 'secondary compact')
      insert.type = 'button'
      insert.onclick = () => insertText(entryForm.elements.note, '\n![图片](attachment:' + item.ref.id + ')\n')
      row.append(insert)
    }
    const remove = el('button', '移除', 'secondary compact')
    remove.type = 'button'
    remove.onclick = () => { attachments = attachments.filter(file => file !== item); showAttachments() }
    row.append(remove)
    return row
  }))
}

richToolbar(get('note-toolbar'), entryForm.elements.note, () => {
  const preview = get('note-preview')
  preview.hidden = false
  preview.replaceChildren(richBody({ note: entryForm.elements.note.value, font: entryForm.elements.noteFont.value,
    format: 'rich', attachments: attachments.map(item => item.ref) }, (file, alt) => el('span', `[${alt || file.name}]`)))
})

get('entry-attachments').addEventListener('change', event => {
  try {
    const files = [...event.target.files]
    if (attachments.length + files.length > 16) throw new Error('每条记录最多 16 个附件。')
    attachments = [...attachments, ...files.map(file => ({ file, ref: draftMedia(file) }))]
    showAttachments()
  } catch (error) {
    notify(error.message)
  } finally {
    event.target.value = ''
  }
})
get('remove-paper-pdf').addEventListener('click', () => { paperPdfRemoved = true; showAttachments() })

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
  library.clear()
  content.hidden = true
  gate.hidden = false
  updateGate()
  updateCloud()
  get('cloud-share-manager').open = false
  get('cloud-shares').replaceChildren()
  notify(feedback)
}

function activity () {
  if (!owner) return
  clearTimeout(timer)
  timer = setTimeout(() => lock(), 10 * 60 * 1000)
}

function recordControls (record) {
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
    change.addEventListener('click', () => beginEdit(record))
    const remove = el('button', '删除', 'secondary compact')
    remove.addEventListener('click', async () => {
      if (get('entry-save').disabled || !owner || !confirm(`删除「${record.title}」？`)) return
      if (await persist(owner.records.filter(item => item.id !== record.id))) {
        selected.delete(record.id)
        if (editing?.id === record.id) edit()
        notify('已删除记录。')
      }
    })
    actions.append(check, label, change, remove)
    return actions
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
    queueBackup()
    if (owner !== unlocked) return false
    unlocked.records = records
    clearShare()
    library.show(records)
    if (cloudConfigured && !cloudConflict) {
      updateCloud(cloudConnected() ? '已保存在本机，准备备份。' : '已保存在本机。连接 GitHub 后会继续备份。')
    }
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
    owner = await openVault(password, confirmation, backup)
    importedMedia = snapshot.pending ? recordMedia(owner.records).map(({ id, size }) => ({ id, size })) : []
    backupAllowed = true
    gate.hidden = true
    content.hidden = false
    edit()
    library.show(owner.records)
    activity()
    updateCloud()
    queueBackup()
    notify('')
  } catch (error) {
    preferCloud = false
    updateGate()
    notify(error.message || '无法打开资料库。')
  } finally {
    button.disabled = false
    updateCloud()
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
  const form = entryForm.elements
  const record = { id: editing?.id || crypto.randomUUID(), kind, date, title, note: form.note.value.trim(), category: form.category.value.trim() }
  const files = attachments.slice()
  const progress = message => { if (owner === unlocked) { activity(); notify(message) } }
  button.disabled = true
  try {
    if (kind === 'paper') {
      record.journal = form.paperJournal.value.trim()
      record.submitted = form.paperSubmitted.value
      record.accepted = form.paperAccepted.value
      record.published = form.paperPublished.checked
      if (record.published) record.accepted = 'yes'
      record.paperStatus = record.published ? 'published' : record.submitted ? 'submitted' : 'writing'
      const file = record.published && form.paperPdf.files[0]
      if (file && await file.slice(0, 5).text() !== '%PDF-') throw new Error('请选择有效的 PDF 文件。')
      if (file) record.pdf = await uploadMedia(file, progress)
      else if (!paperPdfRemoved && editing?.pdf) record.pdf = editing.pdf
    }
    if (kind === 'photo') {
      const file = form.photo.files[0]
      record.photo = file ? await compressPhoto(file) : editing?.photo
      if (!record.photo) throw new Error('请选择一张照片。')
    }
    if (kind === 'video') {
      const file = form.video.files[0]
      if (file && !['video/mp4', 'video/webm'].includes(file.type)) throw new Error('请选择 MP4 或 WebM 视频。')
      record.video = file ? await uploadMedia(file, progress) : editing?.video
      if (!record.video) throw new Error('请选择视频。')
    }
    if (kind === 'journal' || kind === 'paper') {
      record.format = 'rich'
      record.font = form.noteFont.value
    }
    if (kind !== 'video' && files.length) {
      record.attachments = []
      for (const { file, ref } of files) {
        if (owner !== unlocked) return
        record.attachments.push(file ? await uploadMedia(file, progress) : ref)
      }
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

function shareLink (id, proof) {
  return new URL('share.html#' + (proof ? 'cloud-' + id + '.' + proof : id), location.href).href
}

async function refreshShares () {
  const target = get('cloud-shares')
  const manager = get('cloud-share-manager')
  const unlocked = owner
  if (!unlocked || !cloudConnected() || !manager.open) return
  target.replaceChildren(el('p', '正在读取分享链接…', 'muted'))
  try {
    const shares = await listCloudShares()
    if (owner !== unlocked || !cloudConnected() || !manager.open) return
    target.replaceChildren()
    if (!shares.length) target.append(el('p', '暂无在线分享。', 'muted'))
    for (const { id, proof } of shares) {
      const row = el('div', '', 'actions')
      const link = el('a', '分享 ' + id.slice(0, 8))
      link.href = shareLink(id, proof)
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      const close = el('button', '关闭链接', 'secondary compact')
      close.type = 'button'
      close.addEventListener('click', async () => {
        if (!confirm('关闭这个分享链接？')) return
        close.disabled = true
        try {
          await closeCloudShare(id)
          if (share?.id === id) clearShare()
          await refreshShares()
        } catch (error) {
          notify(error.message)
          updateCloud()
          close.disabled = false
        }
      })
      row.append(link, close)
      target.append(row)
    }
  } catch (error) {
    if (owner === unlocked) target.replaceChildren(el('p', error.message, 'muted'))
    updateCloud()
  }
}

get('cloud-share-manager').addEventListener('toggle', refreshShares)
get('cloud-connect').addEventListener('click', async event => {
  const button = event.currentTarget
  button.disabled = true
  try {
    await connectCloud()
  } catch (error) {
    updateCloud(error.message)
    button.disabled = false
  }
})
get('cloud-disconnect').addEventListener('click', () => {
  disconnectCloud()
  clearShare()
  get('cloud-shares').replaceChildren()
  updateCloud('已断开 GitHub。未同步的改动保存在本机。')
})
get('cloud-retry').addEventListener('click', syncBackup)
get('cloud-restore').addEventListener('click', () => {
  if (!confirm('使用私仓版本会替换本机副本。若有需要保留的改动，请先取消并下载加密备份。继续？')) return
  preferCloud = true
  lock('请输入资料库密码以恢复私仓版本。')
})
window.addEventListener('online', () => queueBackup())

get('make-share').addEventListener('click', async event => {
  const unlocked = owner
  if (!unlocked) return
  const includeNotes = get('share-paper-notes').checked
  const records = unlocked.records.filter(record => selected.has(record.id)).map(record => {
    if (record.kind !== 'paper') return record
    return { ...record, ...(includeNotes ? {} : { note: '', attachments: [] }),
      pdf: paperDetails(record).published ? record.pdf : undefined }
  })
  if (!records.length) return notify('请勾选至少一条要分享的记录。')
  if (cloudConfigured && !cloudConnected()) return notify('请先连接 GitHub，再生成在线分享。')
  const button = event.currentTarget
  button.disabled = true
  clearShare()
  try {
    const password = base64(randomBytes(18)).replaceAll('+', '-').replaceAll('/', '_')
    const salt = randomBytes(16)
    const id = crypto.randomUUID()
    const key = await deriveKey(password, salt)
    const blob = await seal('share', key, salt, records)
    const files = recordMedia(records)
    if (owner !== unlocked) return
    let proof
    if (cloudConfigured) {
      notify('正在发布加密分享…')
      await syncImportedMedia(files)
      proof = await publishCloudShare(id, blob, files.map(file => file.id))
      if (owner !== unlocked) return
    }
    share = { blob, id, files }
    get('share-link').value = shareLink(id, proof)
    get('share-password').value = password
    get('share-result').hidden = false
    notify(cloudConfigured ? '分享已发布，可以把链接和独立密码发给对方。' :
      '分享文件已生成。发布加密文件后，链接即可使用。')
    if (cloudConfigured) await refreshShares()
  } catch (error) {
    notify(error.message || '无法生成分享。')
    updateCloud()
  } finally {
    button.disabled = false
  }
})

async function downloadBundle (button, archive, files, name) {
  const unlocked = owner
  if (!unlocked || !archive) return
  button.disabled = true
  try {
    const blob = await makeBundle(archive, files, { owner: true, progress (file, part, total) {
      if (owner === unlocked) { activity(); notify(`正在准备 ${file.name} · ${part}/${total}`) }
    } })
    if (owner === unlocked) { download(blob, name); notify('已准备好加密文件。') }
  } catch (error) {
    if (owner === unlocked) notify(error.message)
  } finally {
    button.disabled = false
  }
}

get('save-share').addEventListener('click', event => {
  if (share) void downloadBundle(event.currentTarget, share.blob, share.files, share.id + '.vault')
})
get('backup').addEventListener('click', event => {
  if (owner) void downloadBundle(event.currentTarget, snapshot.blob, recordMedia(owner.records), 'treehouse-owner-' + localDay() + '.vault')
})
get('share-paper-notes').addEventListener('change', clearShare)
get('lock').addEventListener('click', () => lock())
get('entry-cancel').addEventListener('click', () => edit())
entryForm.elements.kind.addEventListener('change', showFields)
entryForm.elements.paperPublished.addEventListener('change', showFields)
for (const event of ['keydown', 'pointerdown']) document.addEventListener(event, activity)
window.addEventListener('pagehide', () => lock())

try {
  if (!crypto.subtle) throw new Error('HTTPS required')
  db = await openDatabase()
  snapshot = await readArchive()
  updateGate()
  get('unlock').disabled = cloudConfigured
  if (cloudConfigured) {
    get('cloud-pending').hidden = true
    get('vault-cloud').hidden = false
    get('vault-storage-note').textContent = '工作副本在本机加密保存，并自动备份到 GitHub 私仓。十分钟无操作会锁定。'
    get('share-help').textContent = '分享会保存加密副本。对方用链接和独立密码查看，你可随时关闭链接。'
    get('make-share').textContent = '生成分享链接和密码'
    try {
      await resumeCloud()
      updateCloud(cloudConnected() ? '已连接 GitHub，打开资料库后会检查备份。' :
        '连接 GitHub 后启用自动备份。')
    } catch (error) {
      updateCloud(error.message)
    }
  }
} catch {
  notify('无法开启加密存储。请通过 HTTPS 打开，并检查浏览器的存储权限。')
}
