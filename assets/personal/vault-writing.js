import { el } from './vault-crypto.js?v=9'
import { draftMedia, openMedia } from './vault-media.js?v=8'
import { isImageType, isVideoType, maxAttachments } from './vault-media-model.js?v=8'
import { prepareAttachments } from './vault-transcode.js?v=8'
import { cleanDocument, codeLanguages, editableDocument, renderCodeBlocks, renderEquations, safeLink } from './vault-rich.js?v=10'
import { alignments, bounded, bulletStyles, fonts, imageLimits, numberingStyles, outline, setFont, setImageSize, setUnderline, sizeLimits, underlines, updateWordCount } from './vault-layout.js?v=10'
import { historyState, sameHistoryState, setHistorySelection } from './vault-history.js'
import { cellsInRange, changeTable, columnWidths, mergeCells, setColumnWidths, splitCell, tableGrid, tableLimits } from './vault-table.js'

const isImage = item => isImageType(item.ref.type)
const isVideo = item => isVideoType(item.ref.type)
const isMedia = item => isImage(item) || isVideo(item)
const emojiGroups = [
  ['表情与手势', 0x1f600, 0x1f64f], ['食物与饮品', 0x1f345, 0x1f37f], ['旅行与交通', 0x1f680, 0x1f6a5]
]
const highlightColors = { '#fff0a8': '柠檬黄', '#c7f3c7': '薄荷绿', '#b9e9fc': '冰蓝', '#fed1de': '玫瑰粉',
  '#e2d0ff': '薰衣草紫', '#ffd6ad': '蜜桃橙', '#d8e2ef': '雾灰蓝', '#ffffff': '白色' }
const textColors = { '#000000': '黑色', '#404040': '深灰', '#808080': '灰色', '#ffffff': '白色',
  '#c00000': '深红', '#ff0000': '红色', '#ed7d31': '橙色', '#bf9000': '金黄', '#548235': '绿色',
  '#008080': '青色', '#0070c0': '蓝色', '#203864': '深蓝', '#7030a0': '紫色', '#c43c7d': '玫红' }
const blockSelector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,div:not([data-math])'
const parentElement = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
const hasUnderline = node => node.matches('u,[data-underline]') || node.style.textDecorationLine.split(' ').includes('underline')

function isolateInline (node) {
  const parent = node.parentElement
  for (const side of ['before', 'after']) {
    const sibling = parent.cloneNode(false)
    const next = () => side === 'before' ? parent.firstChild : node.nextSibling
    while (next() && next() !== node) {
      const child = next()
      if (child.nodeType === Node.TEXT_NODE && !child.length) child.remove()
      else sibling.append(child)
    }
    if (sibling.hasChildNodes()) parent[side](sibling)
  }
  return parent
}

function clearInheritedUnderline (span) {
  let current = span
  for (let ancestor = current.parentElement; ancestor && !ancestor.matches(blockSelector);) {
    if (hasUnderline(ancestor)) {
      while (current !== ancestor) current = isolateInline(current)
      if (current.localName === 'u') {
        const plain = el('span')
        for (const { name, value } of current.attributes) plain.setAttribute(name, value)
        plain.append(...current.childNodes)
        current.replaceWith(plain)
        current = plain
      }
      delete current.dataset.underline
      current.style.textDecorationLine = current.style.textDecorationLine.split(' ').filter(line => line !== 'underline').join(' ')
      if (!current.style.textDecorationLine) {
        current.style.textDecorationStyle = ''
        current.style.textDecorationThickness = ''
      }
      ancestor = current.parentElement
    } else ancestor = ancestor.parentElement
  }
}

export function openWriter ({ record, attachments, initialImage, onApply, onActivity }) {
  const dialog = el('dialog', '', 'vault-dialog vault-writer')
  dialog.setAttribute('aria-label', '写作窗口')
  const tools = el('div', '', 'vault-writer-tools')
  const header = el('header', '', 'vault-dialog-head')
  const wordCount = el('span', '正文 0 字', 'vault-word-count')
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
  let preparing = false
  let files = attachments.slice()
  let defaultFont = Object.hasOwn(fonts, record.font) ? record.font : 'mixed'
  let activeMedia
  let tableAnchor
  let tableSelection
  let resize
  let changing = false
  let pendingInput
  let currentState
  let typing
  let composition
  const undo = []
  const redo = []

  function refreshWriting () {
    outline(page, navigation)
    updateWordCount(page, wordCount)
  }

  function capture () {
    page.normalize()
    return historyState(page, selection, defaultFont, files)
  }

  function recordChange (before, inputType) {
    rememberSelection()
    if (files.some(item => item.ref.inlineOnly)) {
      const embedded = new Set([...page.querySelectorAll('[data-inline-media]')].map(chip => chip.dataset.inlineMedia))
      files = files.filter(item => !item.ref.inlineOnly || embedded.has(item.ref.id))
    }
    if (!currentState || currentState.files.length !== files.length || files.some((item, index) => item !== currentState.files[index])) fileNames()
    const next = capture()
    if (before && !sameHistoryState(before, next)) {
      const time = Date.now()
      const grouped = /^(insertText|deleteContentBackward|deleteContentForward)$/.test(inputType || '')
      const from = JSON.stringify(before.positions)
      if (!grouped || typing?.type !== inputType || time - typing.at > 850 || typing.to !== from) {
        undo.push(before)
        if (undo.length > 70) undo.shift()
      }
      typing = grouped ? { type: inputType, at: time, to: JSON.stringify(next.positions) } : undefined
      redo.length = 0
      dirty = true
    }
    currentState = next
    refreshWriting()
  }

  function mutate (apply) {
    if (!ready || !dialog.open) return
    if (changing) return apply()
    const before = capture()
    changing = true
    try { return apply() }
    finally { changing = false; recordChange(before) }
  }

  function history (backward) {
    const source = backward ? undo : redo
    const target = backward ? redo : undo
    if (!source.length || !ready) return
    target.push(capture())
    const state = source.pop()
    typing = pendingInput = undefined
    clearTableSelection()
    activeMedia = null
    for (const url of urls) URL.revokeObjectURL(url)
    urls.clear()
    page.innerHTML = state.html
    defaultFont = state.font
    setFont(page, state.font)
    files = state.files.slice()
    selection = setHistorySelection(page, state.positions)
    decorateImages()
    renderSpecial()
    fileNames()
    currentState = capture()
    dirty = true
    refreshWriting()
  }

  function button (label, action, primary = false) {
    const control = el('button', label, primary ? '' : 'secondary compact')
    control.type = 'button'
    control.addEventListener('mousedown', event => {
      rememberSelection()
      event.preventDefault()
    })
    control.addEventListener('click', action)
    return control
  }

  function command (name, value) {
    if (name === 'undo' || name === 'redo') return history(name === 'undo')
    return mutate(() => {
      restoreSelection()
      const result = document.execCommand(name, false, value)
      rememberSelection()
      return result
    })
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
    control.addEventListener('pointerdown', rememberSelection)
    control.onchange = () => {
      if (document.activeElement === page) rememberSelection()
      if (control.value) action(control.value)
      control.value = ''
    }
    return control
  }

  function inlineFormat (apply, after) {
    mutate(() => {
      const active = restoreSelection()
      if (!active.rangeCount) return
      const range = active.getRangeAt(0)
      if (range.collapsed) {
        const span = el('span', '\u200b')
        apply(span)
        range.insertNode(span)
        after?.(span)
        active.collapse(span.firstChild, 1)
      } else {
        const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
        const selected = []
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if (text.parentElement.closest('[contenteditable="false"]') || !range.intersectsNode(text)) continue
          const start = text === range.startContainer ? range.startOffset : 0
          const end = text === range.endContainer ? range.endOffset : text.length
          if (end > start) selected.push({ text, start, end })
        }
        const spans = selected.map(({ text, start, end }) => {
          const part = document.createRange()
          part.setStart(text, start)
          part.setEnd(text, end)
          const span = el('span')
          apply(span)
          span.append(part.extractContents())
          part.insertNode(span)
          after?.(span)
          return span
        })
        if (spans.length) active.setBaseAndExtent(spans[0], 0, spans.at(-1), spans.at(-1).childNodes.length)
      }
      rememberSelection()
    })
  }

  function fontSize (size) {
    inlineFormat(span => { span.style.fontSize = `${size}pt` })
  }

  function underline (style) {
    inlineFormat(span => {
      if (style !== 'none') setUnderline(span, style)
    }, clearInheritedUnderline)
  }

  function paragraphFormat (apply) {
    mutate(() => {
      const active = restoreSelection()
      if (!active.rangeCount) return
      const range = active.getRangeAt(0)
      let blocks = range.collapsed ? [parentElement(range.startContainer)?.closest(blockSelector)].filter(block => block && block !== page)
        : [...page.querySelectorAll(blockSelector)].filter(block => range.intersectsNode(block) && !block.querySelector(blockSelector) &&
          !block.closest('[contenteditable="false"]'))
      if (!blocks.length) {
        command('formatBlock', 'p')
        const paragraph = parentElement(window.getSelection().anchorNode)?.closest('p')
        if (paragraph) blocks = [paragraph]
      }
      blocks.forEach(apply)
    })
  }

  function list (type, style) {
    mutate(() => {
      const nearest = () => parentElement(window.getSelection().anchorNode)?.closest('ul,ol')
      const selection = restoreSelection()
      if (nearest()?.localName !== type) {
        const block = parentElement(selection.anchorNode)?.closest('p,div,h1,h2,h3,h4,h5,h6')
        if (selection.isCollapsed && block && block !== page && page.contains(block) && !nearest()) {
          const list = el(type)
          const item = el('li')
          const at = selection.anchorNode
          const offset = selection.anchorOffset
          item.append(...block.childNodes)
          if (!item.firstChild) item.append(el('br'))
          list.append(item)
          block.replaceWith(list)
          if (item.contains(at)) selection.collapse(at, offset)
          else moveCaret(item)
        } else command(type === 'ul' ? 'insertUnorderedList' : 'insertOrderedList')
      }
      const current = nearest()
      if (current?.localName === type && page.contains(current)) current.style.listStyleType = style
    })
  }

  function selectMedia (chip) {
    activeMedia?.classList.remove('vault-media-selected')
    activeMedia = chip
    chip?.classList.add('vault-media-selected')
  }

  function resizeMedia (chip, width, height) {
    setImageSize(chip, width, height)
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
          const { width, height } = image.getBoundingClientRect()
          if (!width || !height) return
          const before = capture()
          const { clientX, clientY } = event
          handle.setPointerCapture(event.pointerId)
          handle.onpointermove = move => resizeMedia(chip, width + move.clientX - clientX, height + move.clientY - clientY)
          handle.onlostpointercapture = () => {
            handle.onpointermove = null
            recordChange(before)
          }
        })
        chip.replaceChildren(image, handle)
      }).catch(() => { notice.textContent = '附件暂时无法预览，稍后可以重试。' })
      if (isImage(file) && (file.file || file.ref.size <= 8_000_000)) load()
      else chip.replaceChildren(button(isVideo(file) ? '加载视频预览' : '加载图片预览', load))
    }
  }

  function insertImage (item) {
    const marker = el('div', item.ref.name)
    marker.dataset.inlineMedia = item.ref.id
    marker.dataset.align = 'center'
    insertBlock(marker)
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
      mutate(() => {
        const marker = chip || el(display ? 'div' : 'span')
        marker.className = 'vault-math'
        marker.dataset.math = value
        marker.dataset.display = String(display)
        if (display) marker.dataset.number = number.value.trim().replace(/^[（(](.*)[）)]$/, '$1').trim()
        marker.contentEditable = 'false'
        marker.textContent = value
        if (!chip) {
          if (display) insertBlock(marker)
          else command('insertHTML', marker.outerHTML + ' ')
        }
      })
      renderSpecial()
    })
    numberLabel.hidden = !display
    number.value = chip?.dataset.number || ''
  }

  setFont(page, defaultFont)
  const fontControl = selectControl('字体', Object.fromEntries(Object.entries(fonts).map(([key, [label]]) => [key, label])), key => {
    if (selection?.toString()) inlineFormat(span => setFont(span, key))
    else mutate(() => { defaultFont = key; setFont(page, key) })
  })
  fontControl.title = '选中文字时更改选区字体，光标停在正文时更改全文默认字体'

  const attach = el('input')
  attach.type = 'file'
  attach.multiple = true
  attach.hidden = true
  async function addAttachments (picked, inlineOnly = false) {
    if (!picked.length || preparing) return
    const at = selection?.cloneRange()
    preparing = true
    attach.disabled = applyRecord.disabled = true
    try {
      const prepared = await prepareAttachments(picked, maxAttachments - files.length, message => {
        if (dialog.open) { notice.textContent = message; onActivity() }
      })
      if (!dialog.open) return
      const additions = prepared.map(file => {
        const ref = draftMedia(file)
        return { file, ref: inlineOnly ? { ...ref, inlineOnly: true } : ref }
      })
      if (at && page.contains(at.commonAncestorContainer)) selection = at
      mutate(() => {
        files.push(...additions)
        additions.filter(isMedia).forEach(insertImage)
      })
      notice.textContent = `已添加 ${additions.length} 个附件。`
    } catch (error) { notice.textContent = error?.message || '无法处理选中的文件，请分批重试。' }
    finally { preparing = attach.disabled = applyRecord.disabled = false }
  }
  attach.onchange = () => {
    const picked = [...attach.files]
    attach.value = ''
    void addAttachments(picked)
  }

  for (const [label, name, value] of [
    ['撤销', 'undo'], ['重做', 'redo'], ['加粗', 'bold'], ['斜体', 'italic'], ['删除线', 'strikeThrough'],
    ['上标', 'superscript'], ['下标', 'subscript']
  ]) toolbar.append(button(label, () => command(name, value)))
  const sizeControl = selectControl('字号', {}, value => {
    if (value !== 'custom') { fontSize(value); return }
    customSize.hidden = false
    const input = customSize.querySelector('input')
    input.focus()
    input.select()
  })
  sizeControl.append(...[8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 60, 72].map(size => new Option(`${size} pt`, size)),
    new Option('自定义字号…', 'custom'))
  const palette = el('div', '', 'vault-text-palette')
  palette.popover = 'auto'
  palette.setAttribute('role', 'group')
  palette.setAttribute('aria-label', '文字颜色选项')
  const paletteButton = button('常用文字颜色', () => {
    const rect = paletteButton.getBoundingClientRect()
    palette.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 258))}px`
    const above = window.innerHeight - rect.bottom < Math.min(225, window.innerHeight * .45)
    palette.style.top = above ? 'auto' : `${rect.bottom + 5}px`
    palette.style.bottom = above ? `${window.innerHeight - rect.top + 5}px` : 'auto'
  })
  paletteButton.popoverTargetElement = palette
  for (const [color, label] of Object.entries(textColors)) {
    const choice = button(label, () => {
      palette.hidePopover()
      inlineFormat(span => { span.style.color = color })
    })
    const swatch = el('span', '', 'vault-color-swatch')
    swatch.setAttribute('aria-hidden', 'true')
    swatch.style.backgroundColor = color
    choice.append(swatch)
    palette.append(choice)
  }
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
    fontControl, sizeControl, selectControl('下划线', { ...Object.fromEntries(Object.entries(underlines).map(([key, [label]]) => [key, label])), none: '清除下划线' }, underline),
    paletteButton, palette,
    textColor, selectControl('高亮颜色', highlightColors, color => inlineFormat(span => { span.style.backgroundColor = color })), highlight,
    selectControl('段落对齐', alignments, value => paragraphFormat(block => { block.style.textAlign = value })),
    selectControl('项目符号', bulletStyles, style => list('ul', style)),
    selectControl('编号样式', numberingStyles, style => list('ol', style)))

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
  const customSize = numbersForm('vault-writing-prompt', [['字号（pt）', 12, sizeLimits.min, sizeLimits.max, .01]], '应用字号', ([size]) => fontSize(size))
  const spacing = numbersForm('vault-writing-prompt', [['段前（pt）', 0, 0, 72, 1], ['段后（pt）', 8, 0, 72, 1], ['首行缩进（字符）', 2, 0, 8, .5]], '应用段距与缩进', ([before, after, indent]) => {
    paragraphFormat(block => {
      block.style.marginTop = `${before}pt`
      block.style.marginBottom = `${after}pt`
      block.style.textIndent = `${indent}em`
    })
  })
  const tableSettings = numbersForm('vault-writing-prompt', [['表格行数', 3, 1, tableLimits.rows, 1], ['表格列数', 3, 1, tableLimits.columns, 1]], '插入表格', ([rows, columns]) => {
    const header = '<thead><tr>' + '<th>标题</th>'.repeat(columns) + '</tr></thead>'
    const row = '<tr>' + '<td>内容</td>'.repeat(columns) + '</tr>'
    const table = el('table')
    table.innerHTML = header + '<tbody>' + row.repeat(rows - 1) + '</tbody>'
    mutate(() => insertBlock(table))
  })
  const splitSettings = numbersForm('vault-writing-prompt', [['拆分行数', 1, 1, 12, 1], ['拆分列数', 2, 1, 12, 1]], '拆分单元格', ([rows, columns]) => {
    withTable((grid, cell) => moveCaret(splitCell(grid, cell, rows, columns)))
  })
  const widthSettings = numbersForm('vault-writing-prompt', [['当前列宽（%）', 30, 1, 99, 1]], '应用列宽', ([percent]) => {
    withTable((grid, cell) => {
      if (grid.columns === 1) return
      const index = grid.cells.find(entry => entry.cell === cell).x
      const widths = columnWidths(grid, true)
      const others = widths.reduce((sum, width, i) => sum + (i === index ? 0 : width), 0)
      setColumnWidths(grid.table, widths.map((width, i) => i === index ? percent : width / others * (100 - percent)))
    })
  })
  function moveCaret (element) {
    if (!element) return
    const active = window.getSelection()
    page.focus()
    active.selectAllChildren(element)
    active.collapseToStart()
    rememberSelection()
  }

  function insertBlock (block) {
    const active = restoreSelection()
    if (!active.rangeCount) return
    const range = active.getRangeAt(0)
    if (!page.contains(range.commonAncestorContainer)) return
    if (tableCell(range.startContainer) !== tableCell(range.endContainer)) range.collapse(false)
    else range.deleteContents()
    const scope = parentElement(range.startContainer)?.closest('td,th,li,blockquote') || page
    const follow = el('p')
    follow.append(el('br'))
    if (range.startContainer === scope) {
      range.insertNode(block)
      block.after(follow)
      moveCaret(follow)
      return
    }
    let container = range.startContainer
    while (container.parentNode !== scope) container = container.parentNode
    const trailing = range.cloneRange()
    trailing.setEndAfter(container)
    const suffix = trailing.extractContents()
    const remainder = suffix.firstChild
    container.after(block)
    if (remainder?.nodeType === Node.ELEMENT_NODE && remainder.matches('p,div') && !emptyLine(remainder)) {
      block.after(suffix)
      moveCaret(remainder)
    } else {
      block.after(follow, suffix)
      if (remainder?.nodeType === Node.ELEMENT_NODE && remainder.matches('p,div') && emptyLine(remainder)) remainder.remove()
      moveCaret(follow)
    }
    if (container.nodeType === Node.ELEMENT_NODE && container.matches('p,div') && emptyLine(container)) container.remove()
  }

  function tableCell (at = selection?.startContainer) {
    const cell = parentElement(at)?.closest('td,th')
    return cell && page.contains(cell) ? cell : undefined
  }

  function clearTableSelection () {
    for (const cell of page.querySelectorAll('[data-vault-table-selected]')) cell.removeAttribute('data-vault-table-selected')
    tableSelection = undefined
  }

  function withTable (action) {
    try {
      mutate(() => {
        const cell = tableSelection?.[0] || tableCell() || (tableAnchor?.isConnected ? tableAnchor : null)
        if (!cell) throw new Error('请先把光标放在表格单元格内。')
        action(tableGrid(cell.closest('table')), cell)
      })
    } catch (error) { notice.textContent = error.message }
  }

  function removeTable (table) {
    const paragraph = el('p')
    paragraph.append(el('br'))
    table.replaceWith(paragraph)
    moveCaret(paragraph)
  }

  function tableAction (action) {
    if (action === 'split') return withTable(() => {
      splitSettings.hidden = false
      splitSettings.querySelector('input').focus()
    })
    if (action === 'width') return withTable((grid, cell) => {
      const index = grid.cells.find(entry => entry.cell === cell).x
      widthSettings.querySelector('input').value = Math.max(1, Math.min(99, Math.round(columnWidths(grid, true)[index])))
      widthSettings.hidden = false
      widthSettings.querySelector('input').focus()
    })
    withTable((grid, cell) => {
      if (action === 'merge') {
        const end = tableSelection?.[1] || tableCell(selection?.endContainer)
        moveCaret(mergeCells(grid, cell, end))
        clearTableSelection()
      } else if (action === 'even') setColumnWidths(grid.table, Array(grid.columns).fill(1))
      else if (action === 'remove') removeTable(grid.table)
      else if ((action === 'deleteRow' && grid.rows === 1) || (action === 'deleteColumn' && grid.columns === 1)) removeTable(grid.table)
      else moveCaret(changeTable(grid, cell, action))
    })
  }

  const tableMenu = selectControl('表格操作', {
    insertRowBefore: '上方插入行', insertRowAfter: '下方插入行', insertColumnBefore: '左侧插入列', insertColumnAfter: '右侧插入列',
    deleteRow: '删除当前行', deleteColumn: '删除当前列', merge: '合并所选单元格', split: '自定义拆分单元格',
    width: '设置当前列宽', even: '平均分布列宽', remove: '删除整张表格'
  }, tableAction)
  tableMenu.title = '拖动列分隔线调整宽度。按住 Shift 点击第二格可框选合并。'
  const imageSize = numbersForm('vault-writing-prompt', [
    ['图片宽度（px）', 320, imageLimits.min, imageLimits.width, 1],
    ['图片高度（px）', 240, imageLimits.min, imageLimits.height, 1]
  ], '应用图片尺寸', ([width, height]) => {
    if (activeMedia?.isConnected) mutate(() => resizeMedia(activeMedia, width, height))
  })
  function imageSelected (action) {
    if (activeMedia?.isConnected && activeMedia.querySelector('img')) action()
    else notice.textContent = '请先点击正文里的图片。'
  }
  toolbar.append(button('段距与缩进', () => { spacing.hidden = !spacing.hidden }),
    selectControl('图片对齐', { left: '图片左对齐', center: '图片居中', right: '图片右对齐' }, value => imageSelected(() => mutate(() => {
      activeMedia.dataset.align = value
    }))), button('图片尺寸', () => imageSelected(() => {
      imageSize.hidden = !imageSize.hidden
      if (imageSize.hidden) return
      const image = activeMedia.querySelector('img')
      const [width, height] = imageSize.querySelectorAll('input')
      width.value = bounded(Math.round(parseFloat(activeMedia.style.width) || image.width), imageLimits.min, imageLimits.width, 320)
      height.value = bounded(Number(activeMedia.dataset.height) ||
        Math.round(width.valueAsNumber * image.naturalHeight / image.naturalWidth || image.height), imageLimits.min, imageLimits.height, 240)
      width.focus()
    })), button('链接', () => ask('链接地址', 'https://', value => {
    const href = safeLink(value)
    if (!href) { notice.textContent = '请输入有效的链接地址。'; return false }
    if (selection?.toString()) command('createLink', href)
    else {
      const link = el('a', href)
      link.href = href
      command('insertHTML', link.outerHTML)
    }
  })), button('表格', () => { tableSettings.hidden = !tableSettings.hidden }), tableMenu)
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

  const codeForm = el('form', '', 'vault-writing-prompt vault-code-form')
  codeForm.hidden = true
  const languageLabel = el('label', '代码语言')
  const language = el('select')
  language.append(...Object.entries(codeLanguages).map(([key, label]) => new Option(label, key)))
  languageLabel.append(language)
  const codeLabel = el('label', '代码内容')
  const codeInput = el('textarea')
  codeInput.rows = 6
  codeInput.maxLength = 40_000
  codeInput.spellcheck = false
  codeInput.required = true
  codeLabel.append(codeInput)
  const saveCode = button('应用代码块', () => {})
  saveCode.type = 'submit'
  let editingCode
  function openCode (pre) {
    editingCode = pre
    language.value = pre?.dataset.language || 'javascript'
    codeInput.value = pre?.querySelector('code')?.textContent || selection?.toString() || ''
    codeForm.hidden = false
    codeInput.focus()
  }
  codeInput.onkeydown = event => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    codeInput.setRangeText('  ', codeInput.selectionStart, codeInput.selectionEnd, 'end')
  }
  codeForm.append(languageLabel, codeLabel, saveCode, button('取消', () => { codeForm.hidden = true; restoreSelection() }))
  codeForm.onsubmit = event => {
    event.preventDefault()
    const pre = editingCode?.isConnected ? editingCode : el('pre')
    mutate(() => {
      pre.dataset.language = language.value
      pre.contentEditable = 'false'
      pre.removeAttribute('data-rendered-code')
      pre.replaceChildren(el('code', codeInput.value))
      if (!pre.isConnected) insertBlock(pre)
    })
    codeForm.hidden = true
    renderSpecial()
  }
  toolbar.append(button('代码块', () => openCode(parentElement(selection?.startContainer)?.closest('pre'))))

  function renderSpecial () {
    page.querySelectorAll('[data-math],pre[data-language]').forEach(chip => { chip.contentEditable = 'false' })
    void Promise.all([renderEquations(page), renderCodeBlocks(page)]).catch(() => {
      notice.textContent = '部分公式或代码高亮暂时无法显示，原文仍已保留。'
    })
  }

  function columnBoundary (event) {
    const cell = tableCell(event.target)
    if (!cell) return
    const rect = cell.getBoundingClientRect()
    const left = Math.abs(event.clientX - rect.left)
    const right = Math.abs(event.clientX - rect.right)
    if (Math.min(left, right) > 7) return
    try {
      const grid = tableGrid(cell.closest('table'))
      const entry = grid.cells.find(item => item.cell === cell)
      const index = left < right ? entry.x - 1 : entry.x + entry.w - 1
      if (index >= 0 && index < grid.columns - 1) return { grid, index }
    } catch { /* Keep oversized legacy tables readable. */ }
  }

  page.onpointerdown = event => {
    if (event.button !== 0 || event.defaultPrevented) return
    const boundary = columnBoundary(event)
    if (boundary) {
      event.preventDefault()
      const { grid, index } = boundary
      resize = { grid, index, start: event.clientX, width: grid.table.getBoundingClientRect().width,
        columns: columnWidths(grid, true), before: capture() }
      page.setPointerCapture(event.pointerId)
      return
    }
    const cell = tableCell(event.target)
    const anchor = tableCell() || tableAnchor
    clearTableSelection()
    if (event.shiftKey && cell && anchor?.closest('table') === cell.closest('table')) {
      event.preventDefault()
      try {
        const { entries } = cellsInRange(tableGrid(cell.closest('table')), anchor, cell)
        tableSelection = [anchor, cell]
        for (const entry of entries) entry.cell.dataset.vaultTableSelected = ''
      } catch (error) { notice.textContent = error.message }
    } else tableAnchor = cell
  }
  page.onpointermove = event => {
    if (!resize) {
      page.classList.toggle('vault-column-resize', Boolean(columnBoundary(event)))
      return
    }
    const { grid, index, width, start, columns } = resize
    if (!width || Math.abs(event.clientX - start) < 1 && !grid.table.querySelector('colgroup')) return
    const minimum = Math.min(5, columns[index], columns[index + 1])
    const delta = Math.max(minimum - columns[index], Math.min(columns[index + 1] - minimum, (event.clientX - start) / width * 100))
    const widths = columns.slice()
    widths[index] += delta
    widths[index + 1] -= delta
    setColumnWidths(grid.table, widths)
  }
  page.onlostpointercapture = () => {
    if (!resize) return
    const { before } = resize
    resize = null
    recordChange(before)
  }
  page.onpointerleave = () => { if (!resize) page.classList.remove('vault-column-resize') }

  function openLink (link) {
    const url = safeLink(link?.getAttribute('href'))
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  function emptyLine (block) {
    return !block.textContent.replaceAll('\u200b', '').trim() && !block.querySelector('[data-inline-media],[data-math],pre,table,ul,ol')
  }

  function leaveList (item) {
    const list = item.parentElement
    const tail = list.cloneNode(false)
    if (list.localName === 'ol') tail.start = (list.start || 1) + [...list.children].indexOf(item) + 1
    while (item.nextElementSibling) tail.append(item.nextElementSibling)
    const paragraph = el('p')
    paragraph.style.textAlign = 'left'
    paragraph.append(el('br'))
    list.after(paragraph)
    if (tail.children.length) paragraph.after(tail)
    item.remove()
    if (!list.children.length) list.remove()
    moveCaret(paragraph)
  }

  function atStart (range, block) {
    if (!range.collapsed || !block?.contains(range.startContainer)) return false
    const prefix = range.cloneRange()
    prefix.selectNodeContents(block)
    prefix.setEnd(range.startContainer, range.startOffset)
    return !prefix.toString().replaceAll('\u200b', '').length &&
      !prefix.cloneContents().querySelector('[data-inline-media],[data-math],pre,table')
  }

  function paragraphBreak () {
    mutate(() => {
      const current = parentElement(selection?.startContainer)
      const item = current?.closest('li')
      if (item && emptyLine(item)) return leaveList(item)
      const previous = current?.closest(blockSelector)
      command('insertParagraph')
      const next = parentElement(window.getSelection().anchorNode)?.closest(blockSelector)
      if (next && next !== previous && next !== page && !next.matches('li,td,th') && !next.closest('li')) {
        next.style.textAlign = next.closest('td,th') ? '' : 'left'
        next.style.textIndent = ''
      }
    })
  }

  page.addEventListener('keydown', event => {
    if (!ready || event.isComposing) return
    const shortcut = event.ctrlKey || event.metaKey
    if (shortcut && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      history(event.key.toLowerCase() === 'z' && !event.shiftKey)
      return
    }
    rememberSelection()
    const current = parentElement(selection?.startContainer)
    const link = current?.closest('a')
    if (shortcut && event.key === 'Enter' && link) {
      event.preventDefault()
      openLink(link)
      return
    }
    if (shortcut || event.altKey || !selection) return
    const block = current?.closest(blockSelector)
    const item = current?.closest('li')
    if (event.key === 'Tab') {
      event.preventDefault()
      const cell = tableCell()
      if (cell) withTable((grid, selectedCell) => {
        const index = grid.cells.findIndex(entry => entry.cell === selectedCell)
        const next = grid.cells[index + (event.shiftKey ? -1 : 1)]
        if (next) moveCaret(next.cell)
        else if (!event.shiftKey) {
          const last = grid.rows
          changeTable(grid, selectedCell, 'insertRowAfter')
          moveCaret(grid.table.rows[last]?.cells[0])
        }
      })
      else if (item) command(event.shiftKey ? 'outdent' : 'indent')
      else if (event.shiftKey || atStart(selection, block) || current === page) {
        paragraphFormat(paragraph => {
          const indent = parseFloat(paragraph.style.textIndent) || 0
          paragraph.style.textIndent = Math.max(0, Math.min(8, indent + (event.shiftKey ? -2 : 2))) + 'em'
        })
      } else command('insertText', '\u00a0'.repeat(4))
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      paragraphBreak()
    } else if (event.key === 'Backspace' && block && block !== page && atStart(selection, item || block)) {
      if (item) {
        event.preventDefault()
        if (emptyLine(item)) mutate(() => leaveList(item))
        else command('outdent')
      } else if (block.style.textAlign && block.style.textAlign !== 'left' || parseFloat(block.style.textIndent) > 0) {
        event.preventDefault()
        mutate(() => { block.style.textAlign = block.closest('td,th') ? '' : 'left'; block.style.textIndent = '' })
      }
    }
  })

  const exportControl = selectControl('导出与打印', { print: '打印到打印机', pdf: '保存为 PDF', docx: '下载 Word DOCX', png: '导出高清 PNG', jpeg: '导出高清 JPEG', svg: '导出 SVG' }, async format => {
    if (!ready || exportControl.disabled) return
    exportControl.disabled = true
    notice.textContent = '正在准备文档…'
    try {
      const { exportNote } = await import('./vault-export.js?v=10')
      await exportNote({ format, title: record.title, font: defaultFont, html: cleanDocument(page.innerHTML), files, mediaOptions: { owner: true }, alive: () => dialog.open })
      notice.textContent = ['print', 'pdf'].includes(format) ? '可在浏览器打印窗口选择打印机或「另存为 PDF」。' : '文档已生成。'
    } catch (error) { notice.textContent = error.message || '导出失败，请重试。' }
    finally { exportControl.disabled = false }
  })

  function close () {
    if (!dirty || confirm('关闭写作窗口并放弃本次修改？')) dialog.close()
  }
  const applyRecord = button('应用到记录', () => {
    if (!ready || preparing) return
    const html = cleanDocument(page.innerHTML)
    if (html.length > 150_000) { notice.textContent = '正文过长，请拆分为多条记录。'; return }
    onApply(html, defaultFont, files)
    dialog.close()
  }, true)
  header.append(el('h2', record.kind === 'paper' ? '论文笔记' : '日记正文'), wordCount, exportControl, button('关闭', close), applyRecord)
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  dialog.addEventListener('close', () => {
    document.removeEventListener('selectionchange', rememberSelection)
    for (const url of urls) URL.revokeObjectURL(url)
    dialog.remove()
  }, { once: true })
  document.addEventListener('selectionchange', rememberSelection)
  page.addEventListener('beforeinput', event => {
    if (!ready || changing || composition || event.isComposing) return
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      event.preventDefault()
      history(event.inputType === 'historyUndo')
      return
    }
    rememberSelection()
    if (event.inputType === 'insertParagraph' && event.cancelable) {
      event.preventDefault()
      paragraphBreak()
      return
    }
    pendingInput = historyState(page, selection, defaultFont, files)
  })
  page.addEventListener('input', event => {
    if (!ready || changing || composition || event.isComposing) return
    recordChange(pendingInput || currentState, event.inputType)
    pendingInput = undefined
  })
  page.addEventListener('compositionstart', () => {
    if (ready) { rememberSelection(); composition = capture() }
  })
  page.addEventListener('compositionend', () => {
    if (!composition) return
    const before = composition
    composition = pendingInput = undefined
    recordChange(before)
  })
  page.addEventListener('click', event => {
    const chip = event.target.closest('[data-math]')
    if (chip) formula(chip, chip.dataset.display === 'true')
    const media = event.target.closest('[data-inline-media]')
    selectMedia(media)
    if (media && event.target.matches('img')) {
      const range = document.createRange()
      range.selectNode(media)
      page.focus()
      const active = window.getSelection()
      active.removeAllRanges()
      active.addRange(range)
      rememberSelection()
    }
    const link = event.target.closest('a')
    if (link) {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) openLink(link)
    }
  })
  page.addEventListener('dblclick', event => {
    const block = event.target.closest('pre[data-language]')
    if (block) openCode(block)
  })
  page.addEventListener('paste', event => {
    event.preventDefault()
    rememberSelection()
    const pictures = [...event.clipboardData.items].filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile()).filter(Boolean)
    if (pictures.length) void addAttachments(pictures, true)
    else command('insertText', event.clipboardData.getData('text/plain'))
  })
  page.addEventListener('drop', event => event.preventDefault())
  canvas.append(navigation, page)
  tools.append(header, toolbar, prompt, customSize, spacing, tableSettings, splitSettings, widthSettings, imageSize, codeForm, notice)
  dialog.append(tools, canvas, fileList)
  document.body.append(dialog)
  dialog.showModal()
  void editableDocument(record).then(html => {
    if (!dialog.open) return
    page.innerHTML = html
    ready = true
    page.focus()
    rememberSelection()
    renderSpecial()
    currentState = capture()
    if (initialImage) insertImage(initialImage)
    decorateImages()
    fileNames()
    refreshWriting()
  }).catch(() => { notice.textContent = '部分公式暂时无法排版，可点击公式编辑。' })
  return dialog
}
