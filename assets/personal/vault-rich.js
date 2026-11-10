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

export function richBody (record, inlineMedia) {
  const body = el('div', record.note, 'vault-rich-text')
  if (['serif', 'mono'].includes(record.font)) body.dataset.font = record.font
  if (record.format !== 'rich' || !record.note) return body
  void (async () => {
    const md = await markdown()
    body.innerHTML = md.render(record.note)
    for (const node of body.querySelectorAll('[data-inline-media]')) {
      const file = record.attachments?.find(item => item.id === node.dataset.inlineMedia && /^image\/(png|jpeg|gif|webp)$/.test(item.type))
      if (file) node.replaceWith(inlineMedia(file, node.textContent))
    }
    const equations = [...body.querySelectorAll('[data-math]')].slice(0, 40)
    if (!equations.length) return
    await script('katex')
    for (const equation of equations) {
      window.katex.render(equation.dataset.math, equation, {
        output: 'mathml', displayMode: equation.dataset.display === 'true', throwOnError: false, trust: false, maxExpand: 100
      })
    }
  })().catch(() => { /* The source text remains readable if a vendor asset is unavailable. */ })
  return body
}

export function insertText (input, before, after = '', fallback = '') {
  const start = input.selectionStart
  const end = input.selectionEnd
  const content = before + (input.value.slice(start, end) || fallback) + after
  if (input.value.length - (end - start) + content.length > input.maxLength) return
  input.setRangeText(content, start, end, 'end')
  input.focus()
}

export function richToolbar (container, input, preview) {
  const tools = [
    ['标题', '\n## ', '\n', '小标题'], ['加粗', '**', '**', '文字'], ['下划线', '++', '++', '文字'],
    ['链接', '[', '](https://example.com/)', '链接文字'], ['表情', '🙂'],
    ['公式', '$', '$', 'E=mc^2'], ['独立公式', '\n$$', '$$\n', '\\frac{a}{b}'],
    ['表格', '\n| 项目 | 说明 |\n| --- | --- |\n| 内容 | 备注 |\n']
  ]
  for (const [label, before, after, fallback] of tools) {
    const button = el('button', label, 'secondary compact')
    button.type = 'button'
    button.addEventListener('click', () => insertText(input, before, after, fallback))
    container.append(button)
  }
  const button = el('button', '预览正文', 'secondary compact')
  button.type = 'button'
  button.addEventListener('click', preview)
  container.append(button)
}
