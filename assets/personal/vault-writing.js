import { el } from './vault-crypto.js'
import { draftMedia, openMedia } from './vault-media.js'
import { cleanDocument, editableDocument, renderEquations, safeLink } from './vault-rich.js?v=6'
import { alignments, bounded, fonts, listStyles, outline, setFont } from './vault-layout.js'

const isImage = item => /^image\/(png|jpeg|webp|gif)$/.test(item.ref.type)
const isVideo = item => /^video\/(mp4|webm)$/.test(item.ref.type)
const isMedia = item => isImage(item) || isVideo(item)
const emojiGroups = [
  ['表情与手势', 0x1f600, 0x1f64f], ['食物与饮品', 0x1f345, 0x1f37f], ['旅行与交通', 0x1f680, 0x1f6a5]
]
const highlightColors = { '#fff0a8': '柠檬黄', '#c7f3c7': '薄荷绿', '#b9e9fc': '冰蓝', '#fed1de': '玫瑰粉',
  '#e2d0ff': '薰衣草紫', '#ffd6ad': '蜜桃橙', '#d8e2ef': '雾灰蓝', '#ffffff': '白色' }

export function openWriter ({ record, attachments, initialImage, onApply }) {
  const dialog = el('dialog', '', 'vault-dialog vault-writer')
  dialog.setAttribute('aria-label', '写作窗口')
  const tools = el('div', '', 'vault-writer-tools')
  const header = el('header', '', 'vault-dialog-head')
  const toolbar = el('div', '', 'vault-ribbon')
  const canvas = el('div', '', 'vault-writing-canvas')
  const navigation = el('nav', '', 'vault-outline')
  navigation.setAttribute('aria-label', '文档标题导航')
  const page = el('div', '', 'vault-writing-page vault-rich-text')
  page.contentEditable = 'true'
  page.setAttribute('role', 'textbox')
  page.setAttribute('aria-label', '正文编辑器')
  page.setAttribute('aria-multiline', 'true')
  const notice = el('p', '', 'vault-writer-notice status')
  notice.setAttribute('role', 'status')
  const fileList = el('ul', '', 'vault-writer-files')
  const urls = new Set()
  let selection
  let ready = false
  let dirty = false
  let files = attachments.slice()
  let activeMedia

  function button (label, action, primary = false) {
    const control = el('button', label, primary ? '' : 'secondary compact')
    control.type = 'button'
    control.addEventListener('mousedown', event => event.preventDefault())
    control.addEventListener('click', action)
    return control
  }

  function command (name, value) {
    if (!ready || !dialog.open) return
    restoreSelection()
    document.execCommand(name, false, value)
    dirty = true
    rememberSelection()
    outline(page, navigation)
  }

  function restoreSelection () {
    const saved = selection
    const active = window.getSelection()
    page.focus()
    if (saved && page.contains(saved.commonAncestorContainer)) {
      active.removeAllRanges()
      active.addRange(saved)
    }
    return active
  }

  function rememberSelection () {
    const active = window.getSelection()
    if (active.rangeCount && page.contains(active.getRangeAt(0).commonAncestorContainer)) selection = active.getRangeAt(0).cloneRange()
  }

  function fileNames () {
    fileList.replaceChildren(...files.map(item => el('li', item.ref.name)))
    fileList.hidden = !files.length
  }

  function selectControl (label, choices, action) {
    const control = el('select')
    control.setAttribute('aria-label', label)
    control.append(new Option(label, ''), ...Object.entries(choices).map(([value, text]) => new Option(text, value)))
    control.onchange = () => {
      if (control.value) action(control.value)
      control.value = ''
    }
    return control
  }

  function inlineFormat (apply) {
    if (!ready) return
    const active = restoreSelection()
    if (!active.rangeCount) return
    const range = active.getRangeAt(0)
    const span = el('span')
    apply(span)
    if (range.collapsed) span.textContent = '\u200b'
    else span.append(range.extractContents())
    range.insertNode(span)
    active.selectAllChildren(span)
    if (span.textContent === '\u200b') active.collapseToEnd()
    dirty = true
    rememberSelection()
  }

  function paragraphFormat (apply) {
    if (!ready) return
    const selector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,div:not([data-math])'
    const active = restoreSelection()
    if (!active.rangeCount) return
    let range = active.getRangeAt(0)
    let blocks = [...page.querySelectorAll(selector)].filter(block => range.intersectsNode(block) && !block.querySelector(selector) &&
      !block.closest('[contenteditable="false"]'))
    if (!blocks.length) {
      command('formatBlock', 'p')
      const current = restoreSelection()
      if (!current.rangeCount) return
      range = current.getRangeAt(0)
      blocks = [...page.querySelectorAll('p')].filter(block => range.intersectsNode(block) && !block.closest('[contenteditable="false"]'))
    }
    blocks.forEach(apply)
    dirty = true
  }

  function list (type, style) {
    if (!ready) return
    const nearest = () => window.getSelection().anchorNode?.parentElement?.closest(type)
    restoreSelection()
    if (!nearest()) command(type === 'ul' ? 'insertUnorderedList' : 'insertOrderedList')
    const current = nearest()
    if (current && page.contains(current)) current.style.listStyleType = style
    dirty = true
  }

  function selectMedia (chip) {
    activeMedia?.classList.remove('vault-media-selected')
    activeMedia = chip
    chip?.classList.add('vault-media-selected')
  }

  function resizeMedia (chip, width) {
    chip.style.width = `${Math.round(bounded(width, 48, 1600, 320))}px`
    dirty = true
  }

  function decorateImages () {
    for (const chip of page.querySelectorAll('[data-inline-media]:not([contenteditable])')) {
      chip.contentEditable = 'false'
      chip.classList.add('vault-inline-image')
      chip.dataset.alt ||= chip.textContent
      chip.dataset.align ||= 'center'
      const file = files.find(item => item.ref.id === chip.dataset.inlineMedia && isMedia(item))
      if (!file) continue
      const load = () => void (file.file ? Promise.resolve(file.file) : openMedia(file.ref, { owner: true })).then(blob => {
        if (!dialog.open || !chip.isConnected) return
        const url = URL.createObjectURL(blob)
        urls.add(url)
        if (isVideo(file)) {
          const video = el('video')
          video.controls = true
          video.playsInline = true
          video.preload = 'metadata'
          video.src = url
          chip.replaceChildren(video)
          return
        }
        const image = el('img')
        image.alt = chip.dataset.alt
        image.src = url
        const handle = button('拖动调整图片大小', () => {})
        handle.className = 'vault-resize-handle'
        handle.addEventListener('pointerdown', event => {
          event.preventDefault()
          selectMedia(chip)
          const start = event.clientX
          const width = chip.getBoundingClientRect().width
          handle.setPointerCapture(event.pointerId)
          handle.onpointermove = move => resizeMedia(chip, width + move.clientX - start)
          handle.onlostpointercapture = () => { handle.onpointermove = null }
        })
        chip.replaceChildren(image, handle)
      }).catch(() => { notice.textContent = '附件暂时无法预览，稍后可以重试。' })
      if (isImage(file) && file.ref.size <= 8_000_000) load()
      else chip.replaceChildren(button(isVideo(file) ? '加载视频预览' : '加载图片预览', load))
    }
  }

  function insertImage (item) {
    const marker = el('div', item.ref.name)
    marker.dataset.inlineMedia = item.ref.id
    marker.dataset.align = 'center'
    command('insertHTML', marker.outerHTML + '<p><br></p>')
    decorateImages()
  }

  const prompt = el('form', '', 'vault-writing-prompt')
  prompt.hidden = true
  const input = el('input')
  const promptLabel = el('label')
  const numberLabel = el('label', '公式编号（可留空）')
  const number = el('input')
  number.maxLength = 32
  number.placeholder = '例如 1 或 1.1'
  numberLabel.append(number)
  numberLabel.hidden = true
  input.required = true
  input.maxLength = 2000
  const promptSubmit = button('插入', () => {})
  promptSubmit.type = 'submit'
  let applyPrompt
  function ask (label, value, apply) {
    promptLabel.textContent = label
    promptLabel.append(input)
    input.value = value
    applyPrompt = apply
    numberLabel.hidden = true
    prompt.hidden = false
    input.focus()
    input.select()
  }
  prompt.append(promptLabel, numberLabel, promptSubmit, button('取消', () => { prompt.hidden = true; page.focus() }))
  prompt.onsubmit = event => {
    event.preventDefault()
    if (applyPrompt(input.value.trim()) !== false) prompt.hidden = true
  }

  function formula (chip, display = false) {
    ask('LaTeX 公式', chip?.dataset.math || 'E=mc^2', value => {
      if (!value) return false
      const marker = chip || el(display ? 'div' : 'span')
      marker.className = 'vault-math'
      marker.dataset.math = value
      marker.dataset.display = String(display)
      if (display) marker.dataset.number = number.value.trim().replace(/^[（(](.*)[）)]$/, '$1').trim()
      marker.contentEditable = 'false'
      marker.textContent = value
      if (!chip) command('insertHTML', marker.outerHTML + (display ? '<p><br></p>' : ' '))
      dirty = true
      void renderEquations(page).catch(() => {})
    })
    numberLabel.hidden = !display
    number.value = chip?.dataset.number || ''
  }

  const font = el('select')
  font.setAttribute('aria-label', '全文默认字体')
  font.append(...Object.entries(fonts).map(([key, [label]]) => new Option(label, key)))
  font.value = Object.hasOwn(fonts, record.font) ? record.font : 'sans'
  setFont(page, font.value)
  font.onchange = () => { setFont(page, font.value); dirty = true }

  const attach = el('input')
  attach.type = 'file'
  attach.multiple = true
  attach.hidden = true
  attach.onchange = () => {
    try {
      if (files.length + attach.files.length > 16) throw new Error('每条记录最多 16 个附件。')
      const additions = [...attach.files].map(file => ({ file, ref: draftMedia(file) }))
      files.push(...additions)
      additions.filter(isMedia).forEach(insertImage)
      fileNames()
      dirty = true
    } catch (error) { notice.textContent = error.message }
    attach.value = ''
  }

  for (const [label, name, value] of [
    ['撤销', 'undo'], ['重做', 'redo'], ['加粗', 'bold'], ['斜体', 'italic'], ['下划线', 'underline'], ['删除线', 'strikeThrough']
  ]) toolbar.append(button(label, () => command(name, value)))
  const sizes = Object.fromEntries([8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 60, 72].map(size => [size, `${size} pt`]))
  const textColor = el('input')
  const highlight = el('input')
  for (const [control, label, color, property] of [[textColor, '自定义文字颜色', '#283d2f', 'color'], [highlight, '自定义高亮颜色', '#fff0a8', 'backgroundColor']]) {
    control.type = 'color'
    control.value = color
    control.setAttribute('aria-label', label)
    control.title = label
    control.onchange = () => inlineFormat(span => { span.style[property] = control.value })
  }
  toolbar.append(selectControl('标题级别', { p: '正文', h1: '标题 1', h2: '标题 2', h3: '标题 3', h4: '标题 4', h5: '标题 5', h6: '标题 6' }, value => command('formatBlock', value)),
    font, selectControl('选中文字字体', Object.fromEntries(Object.entries(fonts).map(([key, [label]]) => [key, label])), key => inlineFormat(span => setFont(span, key))),
    selectControl('字号', sizes, size => inlineFormat(span => { span.style.fontSize = `${size}pt` })),
    textColor, selectControl('高亮颜色', highlightColors, color => inlineFormat(span => { span.style.backgroundColor = color })), highlight,
    selectControl('段落对齐', alignments, value => paragraphFormat(block => { block.style.textAlign = value })),
    selectControl('项目符号', Object.fromEntries(Object.entries(listStyles).slice(0, 3)), style => list('ul', style)),
    selectControl('编号样式', Object.fromEntries(Object.entries(listStyles).slice(3)), style => list('ol', style)))

  function numbersForm (className, fields, label, submit) {
    const form = el('form', '', className)
    const inputs = fields.map(([name, value, min, max, step]) => {
      const label = el('label', name)
      const input = el('input')
      input.type = 'number'
      input.value = value
      input.min = min
      input.max = max
      input.step = step
      input.required = true
      label.append(input)
      form.append(label)
      return input
    })
    const apply = button(label, () => {})
    apply.type = 'submit'
    form.append(apply, button('取消', () => { form.hidden = true }))
    form.hidden = true
    form.onsubmit = event => {
      event.preventDefault()
      submit(inputs.map(input => input.valueAsNumber))
      form.hidden = true
    }
    return form
  }
  const spacing = numbersForm('vault-writing-prompt', [['段前（pt）', 0, 0, 72, 1], ['段后（pt）', 8, 0, 72, 1], ['首行缩进（字符）', 2, 0, 8, .5]], '应用段距与缩进', ([before, after, indent]) => {
    paragraphFormat(block => {
      block.style.marginTop = `${before}pt`
      block.style.marginBottom = `${after}pt`
      block.style.textIndent = `${indent}em`
    })
  })
  const tableSettings = numbersForm('vault-writing-prompt', [['表格行数', 3, 1, 20, 1], ['表格列数', 3, 1, 12, 1]], '插入表格', ([rows, columns]) => {
    const header = '<thead><tr>' + '<th>标题</th>'.repeat(columns) + '</tr></thead>'
    const row = '<tr>' + '<td>内容</td>'.repeat(columns) + '</tr>'
    command('insertHTML', '<table>' + header + '<tbody>' + row.repeat(rows - 1) + '</tbody></table><p><br></p>')
  })
  const imageWidth = numbersForm('vault-writing-prompt', [['图片宽度（px）', 320, 48, 1600, 1]], '应用图片宽度', ([width]) => {
    if (activeMedia?.isConnected) resizeMedia(activeMedia, width)
  })
  function imageSelected (action) {
    if (activeMedia?.isConnected && activeMedia.querySelector('img')) action()
    else notice.textContent = '请先点击正文里的图片。'
  }
  toolbar.append(button('段距与缩进', () => { spacing.hidden = !spacing.hidden }),
    selectControl('图片对齐', { left: '图片左对齐', center: '图片居中', right: '图片右对齐' }, value => imageSelected(() => {
      activeMedia.dataset.align = value
      dirty = true
    })), button('图片尺寸', () => imageSelected(() => { imageWidth.hidden = !imageWidth.hidden })), button('链接', () => ask('链接地址', 'https://', value => {
    const href = safeLink(value)
    if (!href) { notice.textContent = '请输入有效的链接地址。'; return false }
    if (selection?.toString()) command('createLink', href)
    else {
      const link = el('a', href)
      link.href = href
      command('insertHTML', link.outerHTML)
    }
  })), button('表格', () => { tableSettings.hidden = !tableSettings.hidden }))
  const emoji = selectControl('表情', {}, value => command('insertText', value))
  for (const [label, start, end] of emojiGroups) {
    const group = el('optgroup')
    group.label = label
    for (let code = start; code <= end; code++) {
      const character = String.fromCodePoint(code)
      group.append(new Option(character, character))
    }
    emoji.append(group)
  }
  toolbar.append(emoji,
  button('行内公式', () => formula()), button('独立公式', () => formula(null, true)), button('图片或附件', () => attach.click()), attach)

  const exportControl = selectControl('导出与打印', { print: '打印到打印机', pdf: '保存为 PDF', docx: '下载 Word DOCX', png: '导出高清 PNG', jpeg: '导出高清 JPEG', svg: '导出 SVG' }, async format => {
    if (!ready || exportControl.disabled) return
    exportControl.disabled = true
    notice.textContent = '正在准备文档…'
    try {
      const { exportNote } = await import('./vault-export.js?v=6')
      await exportNote({ format, title: record.title, font: font.value, html: cleanDocument(page.innerHTML), files, mediaOptions: { owner: true }, alive: () => dialog.open })
      notice.textContent = ['print', 'pdf'].includes(format) ? '可在浏览器打印窗口选择打印机或「另存为 PDF」。' : '文档已生成。'
    } catch (error) { notice.textContent = error.message || '导出失败，请重试。' }
    finally { exportControl.disabled = false }
  })

  function close () {
    if (!dirty || confirm('关闭写作窗口并放弃本次修改？')) dialog.close()
  }
  header.append(el('h2', record.kind === 'paper' ? '论文笔记' : '日记正文'), exportControl,
    button('关闭', close), button('应用到记录', () => {
      if (!ready) return
      const html = cleanDocument(page.innerHTML)
      if (html.length > 150_000) { notice.textContent = '正文过长，请拆分为多条记录。'; return }
      onApply(html, font.value, files)
      dialog.close()
    }, true))
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  dialog.addEventListener('close', () => {
    document.removeEventListener('selectionchange', rememberSelection)
    for (const url of urls) URL.revokeObjectURL(url)
    dialog.remove()
  }, { once: true })
  document.addEventListener('selectionchange', rememberSelection)
  page.addEventListener('input', () => { dirty = true; rememberSelection(); outline(page, navigation) })
  page.addEventListener('click', event => {
    const chip = event.target.closest('[data-math]')
    if (chip) formula(chip, chip.dataset.display === 'true')
    selectMedia(event.target.closest('[data-inline-media]'))
    if (event.target.closest('a')) event.preventDefault()
  })
  page.addEventListener('paste', event => {
    event.preventDefault()
    command('insertText', event.clipboardData.getData('text/plain'))
  })
  page.addEventListener('drop', event => event.preventDefault())
  canvas.append(navigation, page)
  tools.append(header, toolbar, prompt, spacing, tableSettings, imageWidth, notice)
  dialog.append(tools, canvas, fileList)
  document.body.append(dialog)
  dialog.showModal()
  void editableDocument(record).then(html => {
    if (!dialog.open) return
    page.innerHTML = html
    page.querySelectorAll('[data-math]').forEach(chip => { chip.contentEditable = 'false' })
    ready = true
    page.focus()
    if (initialImage) insertImage(initialImage)
    decorateImages()
    fileNames()
    outline(page, navigation)
    return renderEquations(page)
  }).catch(() => { notice.textContent = '部分公式暂时无法排版，可点击公式编辑。' })
  return dialog
}
