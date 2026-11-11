import { el } from './vault-crypto.js?v=9'

export const fonts = {
  mixed: ['中文宋体 / 西文 Times New Roman', '"Times New Roman", "Liberation Serif", SimSun, "Songti SC", "Noto Serif CJK SC", serif', 'Times New Roman'],
  sans: ['默认无衬线', '"Segoe UI", "Microsoft YaHei", sans-serif', 'Microsoft YaHei'],
  serif: ['默认衬线', 'Georgia, "Noto Serif SC", SimSun, serif', 'Georgia'],
  mono: ['等宽字体', 'Consolas, "Cascadia Code", monospace', 'Consolas'],
  times: ['Times New Roman', '"Times New Roman", SimSun, serif', 'Times New Roman'],
  song: ['宋体', 'SimSun, "Songti SC", "Noto Serif SC", serif', 'SimSun'],
  hei: ['黑体', 'SimHei, "Heiti SC", "Microsoft YaHei", sans-serif', 'SimHei'],
  kai: ['楷体', 'KaiTi, "Kaiti SC", serif', 'KaiTi'],
  fangsong: ['仿宋', 'FangSong, "STFangsong", serif', 'FangSong'],
  yahei: ['微软雅黑', '"Microsoft YaHei", "PingFang SC", sans-serif', 'Microsoft YaHei'],
  arial: ['Arial', 'Arial, "Microsoft YaHei", sans-serif', 'Arial'],
  calibri: ['Calibri', 'Calibri, "Microsoft YaHei", sans-serif', 'Calibri'],
  cambria: ['Cambria', 'Cambria, SimSun, serif', 'Cambria']
}

export const bulletStyles = {
  disc: '● 实心圆', circle: '○ 空心圆', square: '■ 方块',
  '"◆ "': '◆ 菱形', '"◇ "': '◇ 空心菱形', '"▪ "': '▪ 小方块', '"✓ "': '✓ 对勾',
  '"➜ "': '➜ 箭头', '"★ "': '★ 五角星', '"– "': '– 短横线'
}
export const numberingStyles = {
  decimal: '1、2、3', 'decimal-leading-zero': '01、02、03', 'lower-alpha': 'a、b、c', 'upper-alpha': 'A、B、C',
  'lower-roman': 'i、ii、iii', 'upper-roman': 'I、II、III', 'cjk-ideographic': '一、二、三',
  'simp-chinese-informal': '一、二、三（简体）', 'simp-chinese-formal': '壹、贰、叁', 'lower-greek': 'α、β、γ'
}
export const alignments = { left: '左对齐', center: '居中', right: '右对齐', justify: '两端对齐' }

export function bounded (value, min, max, fallback) {
  const number = Number(value)
  return String(value).trim() && Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

export const imageLimits = { min: 48, width: 1600, height: 2400 }
export const sizeLimits = { min: 6, max: 96 }

export function setImageSize (node, width, height) {
  const pixelWidth = Math.round(bounded(width, imageLimits.min, imageLimits.width, 320))
  node.style.width = `${pixelWidth}px`
  if (height === undefined) return
  const pixelHeight = Math.round(bounded(height, imageLimits.min, imageLimits.height, pixelWidth))
  node.dataset.height = pixelHeight
  node.style.aspectRatio = `${pixelWidth} / ${pixelHeight}`
}

function dimension (value, unit, min, max) {
  const match = /^(-?\d+(?:\.\d+)?)(pt|px|em)$/.exec(value || '')
  if (!match || (match[2] !== unit && !(unit === 'pt' && match[2] === 'px'))) return ''
  const number = Number(match[1]) * (unit === 'pt' && match[2] === 'px' ? .75 : 1)
  return `${Math.round(bounded(number, min, max, min) * 100) / 100}${unit}`
}

export function colorValue (value) {
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase()
  if (/^#[\da-f]{3}$/i.test(value)) return '#' + [...value.slice(1).toLowerCase()].map(digit => digit + digit).join('')
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(value || '')
  if (!match || match.slice(1).some(part => Number(part) > 255)) return ''
  return '#' + match.slice(1).map(part => Number(part).toString(16).padStart(2, '0')).join('')
}

export function setFont (node, key) {
  const font = fonts[Object.hasOwn(fonts, key) ? key : 'mixed']
  node.style.fontFamily = font[1]
  node.dataset.font = Object.hasOwn(fonts, key) ? key : 'mixed'
}

export function copyFormatting (from, to) {
  const style = from.style
  const font = from.dataset?.font
  if (Object.hasOwn(fonts, font)) setFont(to, font)
  const size = dimension(style.fontSize, 'pt', sizeLimits.min, sizeLimits.max)
  if (size) to.style.fontSize = size
  if (['super', 'sub'].includes(style.verticalAlign)) to.style.verticalAlign = style.verticalAlign
  const color = colorValue(style.color || from.getAttribute('color') || '')
  const background = colorValue(style.backgroundColor)
  if (color) to.style.color = color
  if (background) to.style.backgroundColor = background
  if (Object.hasOwn(alignments, style.textAlign)) to.style.textAlign = style.textAlign
  for (const name of ['marginTop', 'marginBottom']) {
    const spacing = dimension(style[name], 'pt', 0, 72)
    if (spacing) to.style[name] = spacing
  }
  const indent = dimension(style.textIndent, 'em', 0, 8)
  if (indent) to.style.textIndent = indent
  const list = to.localName === 'ul' ? bulletStyles : numberingStyles
  if (['ol', 'ul'].includes(to.localName) && Object.hasOwn(list, style.listStyleType)) to.style.listStyleType = style.listStyleType
  if (/^[a-f0-9-]{36}$/.test(from.dataset?.inlineMedia)) {
    const width = dimension(style.width, 'px', imageLimits.min, imageLimits.width)
    if (width) setImageSize(to, parseFloat(width), /^\d+$/.test(from.dataset.height) ? Number(from.dataset.height) : undefined)
    if (['left', 'center', 'right'].includes(from.dataset.align)) to.dataset.align = from.dataset.align
  }
}

export function updateWordCount (page, output) {
  const parts = []
  function collect (node) {
    if (node.nodeType === Node.TEXT_NODE) { parts.push(node.textContent); return }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    if (node.matches('[data-inline-media], [data-math]')) { parts.push(' '); return }
    const block = node.matches('p, div, br, h1, h2, h3, h4, h5, h6, li, blockquote, pre, th, td, hr')
    if (block) parts.push(' ')
    for (const child of node.childNodes) collect(child)
    if (block) parts.push(' ')
  }
  collect(page)
  let count = 0
  const text = parts.join('').replaceAll('\u200b', '').replace(/\p{Script=Han}/gu, () => { count++; return ' ' })
  count += (text.match(/[\p{L}\p{M}\p{N}]+(?:['’.-][\p{L}\p{M}\p{N}]+)*/gu) || []).length
  output.textContent = `正文 ${count} 字`
}

export function outline (page, panel) {
  const headings = [...page.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  panel.replaceChildren(el('strong', '文档导航'))
  if (!headings.length) panel.append(el('p', '设置标题级别后，可从这里跳转。', 'muted'))
  for (const heading of headings) {
    const title = heading.textContent.trim()
    if (!title) continue
    const link = el('button', title, 'vault-outline-link')
    link.type = 'button'
    link.dataset.level = heading.localName.slice(1)
    link.onclick = () => heading.scrollIntoView({ block: 'center' })
    panel.append(link)
  }
}
