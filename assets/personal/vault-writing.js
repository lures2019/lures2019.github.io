import { el } from './vault-crypto.js'
import { draftMedia, openMedia } from './vault-media.js'
import { cleanDocument, editableDocument, renderEquations, safeLink } from './vault-rich.js'

const isImage = item => /^image\/(png|jpeg|webp|gif)$/.test(item.ref.type)

export function openWriter ({ record, attachments, initialImage, onApply }) {
  const dialog = el('dialog', '', 'vault-dialog vault-writer')
  dialog.setAttribute('aria-label', '写作窗口')
  const header = el('header', '', 'vault-dialog-head')
  const toolbar = el('div', '', 'vault-ribbon')
  const canvas = el('div', '', 'vault-writing-canvas')
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

  function button (label, action, primary = false) {
    const control = el('button', label, primary ? '' : 'secondary compact')
    control.type = 'button'
    control.addEventListener('mousedown', event => event.preventDefault())
    control.addEventListener('click', action)
    return control
  }

  function command (name, value) {
    if (!ready || !dialog.open) return
    const active = window.getSelection()
    page.focus()
    if (selection && page.contains(selection.commonAncestorContainer)) {
      active.removeAllRanges()
      active.addRange(selection)
    }
    document.execCommand(name, false, value)
    dirty = true
    rememberSelection()
  }

  function rememberSelection () {
    const active = window.getSelection()
    if (active.rangeCount && page.contains(active.getRangeAt(0).commonAncestorContainer)) selection = active.getRangeAt(0).cloneRange()
  }

  function fileNames () {
    fileList.replaceChildren(...files.map(item => el('li', item.ref.name)))
    fileList.hidden = !files.length
  }

  function decorateImages () {
    for (const chip of page.querySelectorAll('[data-inline-media]:not([contenteditable])')) {
      chip.contentEditable = 'false'
      chip.className = 'vault-inline-image'
      chip.dataset.alt = chip.textContent
      const file = files.find(item => item.ref.id === chip.dataset.inlineMedia && isImage(item))
      if (!file || file.ref.size > 8_000_000) continue
      void (file.file ? Promise.resolve(file.file) : openMedia(file.ref, { owner: true })).then(blob => {
        if (!dialog.open || !chip.isConnected) return
        const url = URL.createObjectURL(blob)
        urls.add(url)
        const image = el('img')
        image.alt = chip.dataset.alt
        image.src = url
        chip.replaceChildren(image)
      }).catch(() => {})
    }
  }

  function insertImage (item) {
    const marker = el('span', item.ref.name)
    marker.dataset.inlineMedia = item.ref.id
    command('insertHTML', '<p>' + marker.outerHTML + '</p><p><br></p>')
    decorateImages()
  }

  const prompt = el('form', '', 'vault-writing-prompt')
  prompt.hidden = true
  const input = el('input')
  const promptLabel = el('label')
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
    prompt.hidden = false
    input.focus()
    input.select()
  }
  prompt.append(promptLabel, promptSubmit, button('取消', () => { prompt.hidden = true; page.focus() }))
  prompt.onsubmit = event => {
    event.preventDefault()
    if (applyPrompt(input.value.trim()) !== false) prompt.hidden = true
  }

  function formula (chip, display = false) {
    ask('LaTeX 公式', chip?.dataset.math || 'E=mc^2', value => {
      if (!value) return false
      const marker = chip || el('span')
      marker.className = 'vault-math'
      marker.dataset.math = value
      marker.dataset.display = String(display)
      marker.contentEditable = 'false'
      marker.textContent = value
      if (!chip) command('insertHTML', marker.outerHTML + ' ')
      dirty = true
      void renderEquations(page).catch(() => {})
    })
  }

  const font = el('select')
  font.setAttribute('aria-label', '正文字体')
  font.append(new Option('默认字体', 'sans'), new Option('衬线字体', 'serif'), new Option('等宽字体', 'mono'))
  font.value = record.font || 'sans'
  page.dataset.font = font.value
  font.onchange = () => { page.dataset.font = font.value; dirty = true }

  const attach = el('input')
  attach.type = 'file'
  attach.multiple = true
  attach.hidden = true
  attach.onchange = () => {
    try {
      if (files.length + attach.files.length > 16) throw new Error('每条记录最多 16 个附件。')
      const additions = [...attach.files].map(file => ({ file, ref: draftMedia(file) }))
      files.push(...additions)
      additions.filter(isImage).forEach(insertImage)
      fileNames()
      dirty = true
    } catch (error) { notice.textContent = error.message }
    attach.value = ''
  }

  for (const [label, name, value] of [
    ['撤销', 'undo'], ['重做', 'redo'], ['正文', 'formatBlock', 'p'], ['标题', 'formatBlock', 'h2'],
    ['加粗', 'bold'], ['斜体', 'italic'], ['下划线', 'underline'], ['项目符号', 'insertUnorderedList'], ['编号', 'insertOrderedList']
  ]) toolbar.append(button(label, () => command(name, value)))
  toolbar.append(font, button('链接', () => ask('链接地址', 'https://', value => {
    const href = safeLink(value)
    if (!href) { notice.textContent = '请输入有效的链接地址。'; return false }
    if (selection?.toString()) command('createLink', href)
    else {
      const link = el('a', href)
      link.href = href
      command('insertHTML', link.outerHTML)
    }
  })), button('表格', () => command('insertHTML', '<table><thead><tr><th>标题</th><th>标题</th></tr></thead><tbody><tr><td>内容</td><td>内容</td></tr><tr><td>内容</td><td>内容</td></tr></tbody></table><p><br></p>')),
  button('表情', () => ask('表情或符号', '🙂', value => command('insertText', value))),
  button('行内公式', () => formula()), button('独立公式', () => formula(null, true)), button('图片或附件', () => attach.click()), attach)

  function close () {
    if (!dirty || confirm('关闭写作窗口并放弃本次修改？')) dialog.close()
  }
  header.append(el('h2', record.kind === 'paper' ? '论文笔记' : '日记正文'),
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
  page.addEventListener('input', () => { dirty = true; rememberSelection() })
  page.addEventListener('click', event => {
    const chip = event.target.closest('[data-math]')
    if (chip) formula(chip, chip.dataset.display === 'true')
    if (event.target.closest('a')) event.preventDefault()
  })
  page.addEventListener('paste', event => {
    event.preventDefault()
    command('insertText', event.clipboardData.getData('text/plain'))
  })
  page.addEventListener('drop', event => event.preventDefault())
  canvas.append(page)
  dialog.append(header, toolbar, prompt, notice, canvas, fileList)
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
    return renderEquations(page)
  }).catch(() => { notice.textContent = '部分公式暂时无法排版，可点击公式编辑。' })
  return dialog
}
