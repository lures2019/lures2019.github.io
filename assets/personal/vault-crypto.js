import { validMedia } from './vault-media-model.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const signature = { owner: 'ZTOWNER1', share: 'ZTSHARE1' }
const saltSize = 16
const ivSize = 12
const headerSize = 8 + saltSize + ivSize
export const maxPackageSize = 40_000_000

export const randomBytes = size => crypto.getRandomValues(new Uint8Array(size))

export function base64 (bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export async function deriveKey (password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  )
}

export async function seal (kind, key, salt, records) {
  const marker = encoder.encode(signature[kind])
  const iv = randomBytes(ivSize)
  const plain = encoder.encode(JSON.stringify({ version: 1, records }))
  if (plain.byteLength + headerSize + 16 > maxPackageSize) throw new Error('资料包过大，请减少照片或分批分享。')
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: marker }, key, plain)
  return new Blob([marker, salt, iv, data], { type: 'application/octet-stream' })
}

export async function unseal (kind, password, blob) {
  if (blob.size < headerSize + 16 || blob.size > maxPackageSize) throw new Error('资料包大小无效。')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const marker = bytes.subarray(0, 8)
  if (decoder.decode(marker) !== signature[kind]) throw new Error('请选择正确类型的加密文件。')
  const salt = bytes.subarray(8, 8 + saltSize)
  const iv = bytes.subarray(8 + saltSize, headerSize)
  const key = await deriveKey(password, salt)
  let plain
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: marker }, key, bytes.subarray(headerSize)
    )
  } catch {
    throw new Error('密码不正确，或文件已损坏。')
  }
  const archive = JSON.parse(decoder.decode(plain))
  if (archive.version !== 1 || !Array.isArray(archive.records)) throw new Error('无法读取资料包内容。')
  const ids = new Set()
  for (const record of archive.records) {
    if (!record || typeof record.id !== 'string' || ids.has(record.id) ||
        !['photo', 'journal', 'paper', 'video'].includes(record.kind) || typeof record.title !== 'string' ||
        typeof record.note !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
        (record.kind === 'paper' && !['writing', 'submitted', 'published'].includes(record.paperStatus)) ||
        (record.kind === 'video' && (!validMedia(record.video) || !/^video\/(mp4|webm)$/.test(record.video.type))) ||
        (record.pdf !== undefined && (!validMedia(record.pdf) || record.pdf.type !== 'application/pdf')) ||
        (record.attachments !== undefined && (!Array.isArray(record.attachments) || record.attachments.length > 16 ||
          !record.attachments.every(validMedia))) ||
        (record.kind === 'photo' && (typeof record.photo !== 'string' ||
          !record.photo.startsWith('UklGR') || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.photo)))) {
      throw new Error('资料包中的记录格式无效。')
    }
    ids.add(record.id)
  }
  return { key, salt, records: archive.records }
}

export function download (blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function localDay () {
  const today = new Date()
  return [today.getFullYear(), today.getMonth() + 1, today.getDate()]
    .map(part => String(part).padStart(2, '0')).join('-')
}

export function el (tag, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
}

export function renderRecords (container, records, controls) {
  const labels = { photo: '照片', journal: '日记', paper: '论文' }
  const status = { writing: '写作中', submitted: '已投稿', published: '已发表' }
  container.replaceChildren()
  if (!records.length) container.append(el('p', '暂无记录。', 'muted'))
  for (const record of [...records].sort((a, b) => b.date.localeCompare(a.date))) {
    const card = el('article', '', 'entry')
    card.append(el('h3', record.title))
    const metadata = [record.date, labels[record.kind]]
    if (record.kind === 'paper') metadata.push(status[record.paperStatus])
    card.append(el('p', metadata.join(' · '), 'entry-meta'))
    if (record.note) card.append(el('p', record.note, 'entry-text'))
    if (record.kind === 'photo') {
      const details = el('details')
      details.append(el('summary', '查看照片'))
      const img = el('img')
      img.alt = record.title
      img.decoding = 'async'
      details.append(img)
      details.addEventListener('toggle', () => {
        if (details.open && !img.getAttribute('src')) img.src = 'data:image/webp;base64,' + record.photo
      })
      card.append(details)
    }
    if (controls) card.append(controls(record))
    container.append(card)
  }
}
