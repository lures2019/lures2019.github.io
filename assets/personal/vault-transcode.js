import { isImageType, isVideoType, maxAttachments, maxMediaBytes } from './vault-media-model.js?v=8'

const maxVideoInput = 1_000_000_000
const videoNames = /\.(mp4|m4v|webm|mov|qt|mkv|avi|mpg|mpeg|mts|m2ts|ts|flv|wmv|3gp|ogv|vob|asf)$/i
const imageNames = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif', ico: 'image/x-icon' }
const imageConversions = new Set(['image/bmp', 'image/tiff', 'image/heic', 'image/heif', 'image/x-icon', 'image/vnd.microsoft.icon'])
const converted = new WeakMap()
const enginePath = './vendor/ffmpeg/'
const titled = (file, extension) => (file.name.replace(/\.[^.]*$/, '') || '媒体').slice(0, 155) + extension
const named = (file, type, name = file.name) => file.type === type && file.name === name ? file : new File([file], name, { type })

export const looksLikeVideo = file => file.type.startsWith('video/') || videoNames.test(file.name)
function imageType (file) {
  const extension = file.name.split('.').at(-1).toLowerCase()
  if (isImageType(file.type) || imageConversions.has(file.type)) return file.type
  return Object.hasOwn(imageNames, extension) ? imageNames[extension] : ''
}

async function ffmpeg (file, progress, run) {
  const { FFmpeg } = await import(enginePath + 'index.js')
  const engine = new FFmpeg()
  try {
    progress('正在加载浏览器媒体转换组件…')
    await engine.load({
      coreURL: new URL(enginePath + 'ffmpeg-core.js', import.meta.url).href,
      wasmURL: new URL(enginePath + 'ffmpeg-core.wasm', import.meta.url).href
    })
    await engine.createDir('/input')
    // WORKERFS reads the selected File on demand, without copying the original to WASM memory.
    await engine.mount('WORKERFS', { blobs: [{ name: 'source', data: file }] }, '/input')
    return await run(engine)
  } finally {
    engine.terminate()
  }
}

export async function prepareImage (file, progress = () => {}) {
  const type = imageType(file)
  if (!type) throw new Error('请选择 JPEG、PNG、WebP、GIF、AVIF、BMP、TIFF 或 HEIC/HEIF 图片。')
  if (!file.size || file.size > maxMediaBytes) throw new Error('单张图片最多 120 MB。')
  if (isImageType(type)) return named(file, type)
  if (type === 'image/heic' || type === 'image/heif') {
    progress('正在将 HEIC/HEIF 图片转换为 JPEG…')
    const { heicTo } = await import('./vendor/heic-to.js')
    const result = await heicTo({ blob: file, type: 'image/jpeg', quality: .88 }).catch(() => {
      throw new Error('这张 HEIC/HEIF 无法转换，请尝试导出为 JPEG 后再插入。')
    })
    return new File([result], titled(file, '.jpg'), { type: 'image/jpeg' })
  }
  return ffmpeg(file, progress, async engine => {
    progress('正在转换图片 ' + file.name + '…')
    const result = await engine.exec(['-i', '/input/source', '-frames:v', '1', 'image.png'])
    if (result !== 0) throw new Error('这张图片无法转换，请尝试导出为 PNG 或 JPEG 后再插入。')
    return new File([await engine.readFile('image.png')], titled(file, '.png'), { type: 'image/png' })
  })
}

async function playable (file) {
  const video = document.createElement('video')
  const url = URL.createObjectURL(file)
  try {
    return await new Promise(resolve => {
      const timeout = setTimeout(() => resolve(false), 3500)
      const settle = value => { clearTimeout(timeout); resolve(value) }
      video.onloadedmetadata = () => settle(video.videoWidth > 0)
      video.onerror = () => settle(false)
      video.preload = 'metadata'
      video.src = url
    })
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

async function convertVideo (file, progress) {
  const detected = /\.(mp4|m4v)$/i.test(file.name) ? 'video/mp4' : /\.webm$/i.test(file.name) ? 'video/webm' : ''
  const type = isVideoType(file.type) ? file.type : detected
  if (type && file.size <= maxMediaBytes) {
    const candidate = named(file, type)
    if (await playable(candidate)) return [candidate]
  }
  return ffmpeg(file, progress, async engine => {
    let seconds = -1
    engine.on('progress', ({ time }) => {
      const elapsed = Math.max(0, Math.floor(time / 1_000_000))
      if (elapsed === seconds) return
      seconds = elapsed
      progress(`正在本机转换视频 · 已处理 ${elapsed} 秒…`)
    })
    progress('正在本机转换并分段…')
    const result = await engine.exec(['-i', '/input/source', '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '24', '-maxrate', '2M', '-bufsize', '4M',
      '-c:a', 'aac', '-b:a', '96k', '-force_key_frames', 'expr:gte(t,n_forced*120)',
      '-f', 'segment', '-segment_time', '120', '-reset_timestamps', '1',
      '-segment_format_options', 'movflags=+faststart', 'segment-%03d.mp4'])
    const output = (await engine.listDir('/')).map(entry => entry.name).filter(name => /^segment-\d+\.mp4$/.test(name)).sort()
    if (result !== 0 || !output.length) throw new Error('视频无法转换，请检查源文件，或导出为 H.264 MP4 后重试。')
    if (output.length > maxAttachments + 1) throw new Error('视频分段数量超过单条记录上限，请按较短的批次导入。')
    const parts = []
    for (const [index, path] of output.entries()) {
      const bytes = await engine.readFile(path)
      if (bytes.byteLength > maxMediaBytes) throw new Error('转换后的分段超过上传限制，请缩短源视频后重试。')
      const suffix = output.length === 1 ? '.mp4' : `-${String(index + 1).padStart(3, '0')}.mp4`
      parts.push(new File([bytes], titled(file, suffix), { type: 'video/mp4' }))
      await engine.deleteFile(path)
    }
    return parts
  })
}

export function prepareVideo (file, progress = () => {}) {
  if (!looksLikeVideo(file) || !file.size || file.size > maxVideoInput) {
    throw new Error('请选择 1 GB 以内的视频。超大文件可分批选择后追加到同一记录。')
  }
  if (!converted.has(file)) {
    converted.set(file, convertVideo(file, progress).catch(error => {
      converted.delete(file)
      throw error
    }))
  }
  return converted.get(file)
}

export async function prepareAttachments (files, available, progress) {
  const result = []
  for (const file of files) {
    if (looksLikeVideo(file)) result.push(...await prepareVideo(file, progress))
    else if (imageType(file)) result.push(await prepareImage(file, progress))
    else result.push(file)
    if (result.length > available) throw new Error(`此批附件超过剩余名额，每条记录最多 ${maxAttachments} 个附件。`)
  }
  return result
}
