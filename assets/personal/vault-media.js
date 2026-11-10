import { base64, maxPackageSize, randomBytes } from './vault-crypto.js'
import { cloudConnected, readMediaChunk, writeMediaChunk } from './vault-cloud.js'
import { chunkSize, maxMediaBytes, mediaId } from './vault-media-model.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const pending = new WeakMap()
const bundleMagic = 'ZTVBUND2'
const maxBundleBytes = 240_000_000
const chunkCount = file => Math.ceil(file.size / chunkSize)
const plainSize = (file, part) => Math.min(chunkSize, file.size - part * chunkSize)
const slot = (id, part) => id + '/' + part
let cache

function openCache () {
  return cache ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('treehouse-vault-attachments', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('chunks')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function cacheRequest (mode, operation) {
  const db = await openCache()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chunks', mode)
    const request = operation(transaction.objectStore('chunks'))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

function cipher (file, part) {
  // Each file gets a random key. Its chunk number is unique under that key.
  const iv = new Uint8Array(12)
  new DataView(iv.buffer).setUint32(8, part)
  return { name: 'AES-GCM', iv, additionalData: encoder.encode(slot(file.id, part)) }
}

function mediaKey (file) {
  return crypto.subtle.importKey('raw', Uint8Array.from(atob(file.key), c => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export function draftMedia (file) {
  if (!file.size || file.size > maxMediaBytes) throw new Error('单个文件上限 120 MB。')
  let upload = pending.get(file)
  if (!upload) {
    upload = {
      descriptor: {
        id: crypto.randomUUID(), name: file.name.slice(0, 200),
        type: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.type) ? file.type : 'application/octet-stream',
        key: base64(randomBytes(32)), size: file.size
      },
      part: 0
    }
    pending.set(file, upload)
  }
  return upload.descriptor
}

export async function uploadMedia (file, progress = () => {}) {
  if (!cloudConnected()) throw new Error('请先连接 GitHub，再上传附件或视频。')
  const media = draftMedia(file)
  const upload = pending.get(file)
  const key = await mediaKey(media)
  for (; upload.part < chunkCount(media); upload.part++) {
    const part = upload.part
    progress(`正在上传 ${media.name} · ${part + 1}/${chunkCount(media)}`)
    const bytes = await file.slice(part * chunkSize, (part + 1) * chunkSize).arrayBuffer()
    const encrypted = new Blob([await crypto.subtle.encrypt(cipher(media, part), key, bytes)])
    await writeMediaChunk(media.id, part, encrypted)
    await cacheRequest('readwrite', store => store.put({ blob: encrypted }, slot(media.id, part))).catch(() => {})
  }
  return media
}

async function encryptedChunk (file, part, options) {
  const id = slot(file.id, part)
  const size = plainSize(file, part) + 16
  const portable = options.bundle?.chunks.get(id)
  const local = options.shareKey || !options.owner ? undefined
    : await cacheRequest('readonly', store => store.get(id)).catch(() => undefined)
  const bytes = portable?.size === size ? portable : local?.blob?.size === size ? local.blob
    : await readMediaChunk(file.id, part, options.shareKey)
  if (bytes.size !== size) throw new Error('附件分片不完整。')
  return bytes
}

export async function openMedia (file, options = {}) {
  const key = await mediaKey(file)
  const parts = []
  const total = chunkCount(file)
  let done = 0
  options.progress?.(done, total)
  for (let start = 0; start < total; start += 3) {
    const group = Array.from({ length: Math.min(3, total - start) }, (_, offset) => start + offset)
    parts.push(...await Promise.all(group.map(async part => {
      const encrypted = await encryptedChunk(file, part, options)
      const plain = await crypto.subtle.decrypt(cipher(file, part), key, await encrypted.arrayBuffer())
      options.progress?.(++done, total)
      return plain
    })))
  }
  // Active documents always download instead of being rendered in the page.
  return new Blob(parts, { type: /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm))$/.test(file.type) ? file.type : 'application/octet-stream' })
}

export async function makeBundle (archive, files, options = {}) {
  if (!files.length) return archive
  const size = archive.size + files.reduce((total, file) => total + file.size + 16 * chunkCount(file), 0)
  if (size > maxBundleBytes) throw new Error('附件合计超过 240 MB，请分批生成离线文件。')
  const parts = []
  const index = []
  for (const file of files) {
    for (let part = 0; part < chunkCount(file); part++) {
      options.progress?.(file, part + 1, chunkCount(file))
      const bytes = await encryptedChunk(file, part, options)
      parts.push(bytes)
      index.push([file.id, part, bytes.size])
    }
  }
  const manifest = encoder.encode(JSON.stringify({ archiveSize: archive.size, index }))
  const length = new DataView(new ArrayBuffer(4))
  length.setUint32(0, manifest.length)
  return new Blob([bundleMagic, length.buffer, manifest, archive, ...parts])
}

export async function openBundle (blob) {
  if (decoder.decode(await blob.slice(0, 8).arrayBuffer()) !== bundleMagic) return { archive: blob, chunks: new Map() }
  try {
    const manifestSize = new DataView(await blob.slice(8, 12).arrayBuffer()).getUint32(0)
    if (blob.size > maxBundleBytes + 500_000 || manifestSize < 2 || manifestSize > 499_988) throw new Error()
    const { archiveSize, index } = JSON.parse(decoder.decode(await blob.slice(12, 12 + manifestSize).arrayBuffer()))
    if (!Number.isSafeInteger(archiveSize) || archiveSize < 52 || archiveSize > maxPackageSize || !Array.isArray(index)) throw new Error()
    const start = 12 + manifestSize
    const archive = blob.slice(start, start + archiveSize)
    let position = start + archiveSize
    const chunks = new Map()
    for (const [id, part, size] of index) {
      const key = slot(id, part)
      if (typeof id !== 'string' || !mediaId.test(id) || !Number.isInteger(part) || part < 0 || part >= 40 ||
          !Number.isInteger(size) || size <= 16 || size > chunkSize + 16 || chunks.has(key)) throw new Error()
      chunks.set(key, blob.slice(position, position + size))
      position += size
    }
    if (position !== blob.size) throw new Error()
    return { archive, chunks }
  } catch {
    throw new Error('离线加密文件不完整。')
  }
}

export async function cacheImportedMedia (bundle, files) {
  for (const file of files) {
    const secret = await mediaKey(file)
    for (let part = 0; part < chunkCount(file); part++) {
      const key = slot(file.id, part)
      const blob = bundle.chunks.get(key)
      if (blob?.size !== plainSize(file, part) + 16) throw new Error('离线文件缺少附件分片。')
      try {
        await crypto.subtle.decrypt(cipher(file, part), secret, await blob.arrayBuffer())
      } catch {
        throw new Error('附件分片校验失败，请重新下载离线文件。')
      }
      await cacheRequest('readwrite', store => store.put({ blob, pending: true }, key))
    }
  }
}

export async function syncImportedMedia (files) {
  for (const file of files) {
    for (let part = 0; part < chunkCount(file); part++) {
      const id = slot(file.id, part)
      const cached = await cacheRequest('readonly', store => store.get(id)).catch(() => undefined)
      if (!cached?.pending) continue
      await writeMediaChunk(file.id, part, cached.blob)
      await cacheRequest('readwrite', store => store.put({ blob: cached.blob }, id))
    }
  }
}
