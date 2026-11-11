export const chunkSize = 3_000_000
export const maxMediaBytes = 40 * chunkSize
export const maxAttachments = 120
export const maxSharedMedia = 128
export const mediaId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
export const isImageType = type => /^(image\/(png|jpeg|gif|webp|avif))$/.test(type)
export const isVideoType = type => /^video\/(mp4|webm)$/.test(type)

export function validMedia (item) {
  return item && typeof item.id === 'string' && mediaId.test(item.id) &&
    typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 200 &&
    typeof item.type === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(item.type) && item.type.length <= 100 &&
    typeof item.key === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(item.key) &&
    Number.isSafeInteger(item.size) && item.size > 0 && item.size <= maxMediaBytes
}

export function recordMedia (records) {
  const media = new Map()
  for (const record of records) {
    for (const item of [...(record.attachments || []), record.video, record.pdf]) {
      if (item) media.set(item.id, item)
    }
  }
  return [...media.values()]
}
