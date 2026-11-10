import { el } from './vault-crypto.js'

const assets = new Map()
let parser

function script (name) {
  if (!assets.has(name)) {
    assets.set(name, new Promise((resolve, reject) => {
      const tag = document.createElement('script')
      tag.src = new URL('./vendor/' + name + '.js', import.meta.url).href
      tag.onload = resolve
      tag.onerror = () => {
        assets.delete(name)
        tag.remove()
        reject(new Error('正文排版组件暂时无法加载。'))
      }
      document.head.append(tag)
    }))
  }
  return assets.get(name)
}

async function markdown () {
  if (parser) return parser
  await script('markdown-it')
  const md = window.markdownit({ html: false, breaks: true })
  md.inline.ruler.before('text', 'vault_marks', (state, silent) => {
    const start = state.pos
    const marker = ['$$', '$', '++'].find(mark => state.src.startsWith(mark, start))
    if (!marker) return false
    const end = state.src.indexOf(marker, start + marker.length)
    if (end <= start + marker.length || end >= state.posMax) return false
    const text = state.src.slice(start + marker.length, end)
    if (marker === '$' && /\s/.test(text[0] + text.at(-1))) return false
    if (!silent) {
      const token = state.push('vault_mark', '', 0)
      token.content = text
      token.markup = marker
    }
    state.pos = end + marker.length
    return true
  })
  md.renderer.rules.vault_mark = (tokens, index) => {
    const token = tokens[index]
    const text = md.utils.escapeHtml(token.content)
    if (token.markup === '++') return '<u>' + text + '</u>'
    return '<span class="vault-math" data-math="' + text + '" data-display="' + (token.markup === '$$') + '">' + text + '</span>'
  }
  md.renderer.rules.image = (tokens, index) => {
    const token = tokens[index]
    const id = /^attachment:([a-f0-9-]+)$/.exec(token.attrGet('src'))?.[1]
    const alt = md.utils.escapeHtml(token.content || '图片')
    return id ? '<span data-inline-media="' + id + '">' + alt + '</span>' : '<span>' + alt + '</span>'
  }
  md.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
    tokens[index].attrSet('target', '_blank')
    tokens[index].attrSet('rel', 'noopener noreferrer')
    return renderer.renderToken(tokens, index, options)
  }
  parser = md
  return md
}

const allowedTags = new Set('p div br h1 h2 h3 h4 h5 h6 strong b em i u s strike ul ol li a blockquote pre code table thead tbody tfoot tr th td span hr'.split(' '))
const blockedTags = new Set(['script', 'style', 'iframe', 'object', 'svg', 'math', 'template'])

export function safeLink (value) {
  try {
    const url = new URL(value)
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return url.href
  } catch { /* Empty or invalid links are kept as plain text. */ }
  return ''
}

export function cleanDocument (html) {
  const input = document.createElement('template')
  input.innerHTML = html
  const output = el('div')
  function copy (from, to, depth = 0) {
    if (depth > 40) return
    for (const child of from.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { to.append(child.textContent); continue }
      if (child.nodeType !== Node.ELEMENT_NODE || blockedTags.has(child.localName)) continue
      if (!allowedTags.has(child.localName)) { copy(child, to, depth + 1); continue }
      const next = el(child.localName)
      if (next.localName === 'a') {
        const href = safeLink(child.getAttribute('href'))
        if (href) {
          next.href = href
          next.target = '_blank'
          next.rel = 'noopener noreferrer'
        }
      }
      if (child.dataset?.math && child.dataset.math.length <= 2000) {
        next.className = 'vault-math'
        next.dataset.math = child.dataset.math
        next.dataset.display = String(child.dataset.display === 'true')
        next.textContent = child.dataset.math
      } else if (/^[a-f0-9-]{36}$/.test(child.dataset?.inlineMedia)) {
        next.dataset.inlineMedia = child.dataset.inlineMedia
        next.textContent = (child.dataset.alt || child.textContent || '图片').slice(0, 200)
      } else copy(child, next, depth + 1)
      to.append(next)
    }
  }
  copy(input.content, output)
  return output.innerHTML
}

export async function editableDocument (record) {
  if (record.format === 'visual') return cleanDocument(record.note)
  if (record.format === 'rich' && record.note) {
    try { return cleanDocument((await markdown()).render(record.note)) } catch { /* Preserve the readable original. */ }
  }
  const plain = el('div')
  plain.textContent = record.note || ''
  return plain.innerHTML.replace(/\r?\n/g, '<br>')
}

export async function renderEquations (root) {
  const equations = [...root.querySelectorAll('[data-math]')].slice(0, 40)
  if (!equations.length) return
  await script('katex')
  for (const equation of equations) {
    window.katex.render(equation.dataset.math, equation, {
      output: 'mathml', displayMode: equation.dataset.display === 'true', throwOnError: false, trust: false, maxExpand: 100
    })
  }
}

export function richBody (record, inlineMedia) {
  const body = el('div', record.format === 'visual' ? '' : record.note, 'vault-rich-text')
  if (['serif', 'mono'].includes(record.font)) body.dataset.font = record.font
  if (!['rich', 'visual'].includes(record.format) || !record.note) return body
  void (async () => {
    body.innerHTML = await editableDocument(record)
    for (const node of body.querySelectorAll('[data-inline-media]')) {
      const file = record.attachments?.find(item => item.id === node.dataset.inlineMedia && /^image\/(png|jpeg|gif|webp)$/.test(item.type))
      if (file) node.replaceWith(inlineMedia(file, node.textContent))
    }
    await renderEquations(body)
  })().catch(() => { /* The source text remains readable if a vendor asset is unavailable. */ })
  return body
}
