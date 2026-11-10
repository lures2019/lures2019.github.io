import { download, el } from './vault-crypto.js'
import { openMedia } from './vault-media.js'
import { renderEquations } from './vault-rich.js?v=7'
import { setFont } from './vault-layout.js?v=7'

const libraries = new Map()
let printCleanup

function loadScript (name) {
  if (!libraries.has(name)) {
    libraries.set(name, new Promise((resolve, reject) => {
      const script = el('script')
      script.src = new URL(`./vendor/${name}.js?v=6`, import.meta.url).href
      script.onload = resolve
      script.onerror = () => { libraries.delete(name); script.remove(); reject(new Error('导出组件暂时无法加载。')) }
      document.head.append(script)
    }))
  }
  return libraries.get(name)
}

function dataUrl (blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function wordImage (blob) {
  if (['image/png', 'image/jpeg', 'image/gif'].includes(blob.type)) return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = el('canvas')
  const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  try { canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height) }
  finally { bitmap.close() }
  const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!image) throw new Error('图片无法转换为 Word 可编辑的对象。')
  return image
}

async function sheetFor ({ title, font, html, files, format, mediaOptions, alive }) {
  const sheet = el('article', '', 'vault-export-sheet vault-rich-text')
  const body = el('div')
  setFont(body, font)
  body.innerHTML = html
  const embedded = new Set([...body.querySelectorAll('[data-inline-media]')].map(node => node.dataset.inlineMedia))
  const remaining = files.filter(item => !embedded.has(item.ref.id))
  if (remaining.length) {
    body.append(el('h2', '附件'))
    for (const item of remaining) {
      const itemNode = el('div', item.ref.name)
      itemNode.dataset.inlineMedia = item.ref.id
      body.append(itemNode)
    }
  }
  for (const node of body.querySelectorAll('[data-inline-media]')) {
    if (!alive()) return
    const item = files.find(file => file.ref.id === node.dataset.inlineMedia)
    const name = node.textContent || '附件'
    if (!item || !/^image\/(jpeg|png|webp|gif)$/.test(item.ref.type)) {
      node.replaceChildren(el('span', `[附件：${name}]`))
      continue
    }
    const blob = item.file || await openMedia(item.ref, mediaOptions)
    const image = el('img')
    image.alt = name
    image.src = await dataUrl(format === 'docx' ? await wordImage(blob) : blob)
    await image.decode()
    const width = parseFloat(node.style.width) || image.naturalWidth
    const ratio = node.dataset.height ? Number(node.dataset.height) / width : image.naturalHeight / image.naturalWidth
    image.width = Math.min(680, width)
    image.height = Math.round(image.width * ratio)
    node.style.width = `${image.width}px`
    node.style.textAlign = node.dataset.align || 'center'
    node.replaceChildren(image)
  }
  await renderEquations(body)
  if (['png', 'jpeg', 'svg'].includes(format)) {
    for (const math of body.querySelectorAll('math[display="block"]')) math.removeAttribute('display')
  }
  if (!alive()) return
  sheet.append(el('h1', title), body)
  return sheet
}

export async function exportNote (options) {
  const { format, alive = () => true } = options
  const title = (options.title || '私密记录').trim() || '私密记录'
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80)
  const sheet = await sheetFor({ ...options, title, alive })
  if (!sheet || !alive()) return
  if (format === 'print' || format === 'pdf') {
    printCleanup?.()
    const originalTitle = document.title
    document.title = title
    document.body.classList.add('vault-printing')
    document.body.append(sheet)
    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup)
      window.removeEventListener('pagehide', cleanup)
      document.body.classList.remove('vault-printing')
      document.title = originalTitle
      sheet.remove()
      printCleanup = undefined
    }
    printCleanup = cleanup
    window.addEventListener('afterprint', cleanup, { once: true })
    window.addEventListener('pagehide', cleanup, { once: true })
    try { window.print() } catch (error) { cleanup(); throw error }
    return
  }
  if (format === 'docx') {
    await loadScript('docx')
    await loadScript('docx-math')
    await loadScript('docx-html')
    if (!alive()) return
    const { Document, Packer } = window.docx
    const children = window.docxHtml.htmlToContent(sheet.innerHTML, {
      maxImageWidth: 620,
      stylesheet: 'table { margin: 0 auto; border-collapse: collapse; } td, th { border: 1px solid #9baaa0; padding: 6px; text-align: center; }'
    })
    const blob = await Packer.toBlob(new Document({ title, sections: [{ children }] }))
    if (alive()) download(blob, `${name}.docx`)
    return
  }
  await loadScript('html-to-image')
  if (!alive()) return
  document.body.append(sheet)
  try {
    const width = sheet.scrollWidth
    const height = sheet.scrollHeight
    const ratio = Math.min(3, 30_000 / height, Math.sqrt(48_000_000 / (width * height)))
    if (format !== 'svg' && ratio < 1) throw new Error('文档太长，请分段导出图片，或使用 SVG、PDF。')
    const settings = { width, height, pixelRatio: ratio, skipFonts: true, backgroundColor: '#fff',
      style: { position: 'static', left: 'auto', top: 'auto', margin: '0' } }
    const renderer = { png: 'toPng', jpeg: 'toJpeg', svg: 'toSvg' }[format]
    const url = await window.htmlToImage[renderer](sheet, { ...settings, quality: .95 })
    if (!alive()) return
    if (url === 'data:,') throw new Error('图片尺寸超过当前浏览器支持范围。')
    download(await (await fetch(url)).blob(), `${name}.${format === 'jpeg' ? 'jpg' : format}`)
  } finally { sheet.remove() }
}
