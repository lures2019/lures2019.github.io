import { download, el } from './vault-crypto.js?v=8'
import { openMedia } from './vault-media.js?v=8'
import { editableDocument, richBody } from './vault-rich.js?v=8'
import { localDay, period, validDay } from './todo-model.js'
import { isImageType, isVideoType } from './vault-media-model.js?v=8'

const kinds = { photo: '照片', journal: '日记', paper: '论文', video: '视频' }
const isPhoto = file => isImageType(file.type)
const isVideo = file => isVideoType(file.type)
const mediaKind = file => isPhoto(file) ? 'image' : isVideo(file) ? 'video' : 'file'
export const paperStages = {
  writing: '写作中', submitted: '已投稿', reviewing: '审稿中', revising: '返修中',
  accepted: '已录用', published: '已见刊', rejected: '已拒稿', withdrawn: '已撤稿'
}

export function paperDetails (record) {
  const published = record.published ?? (record.paperStatus === 'published')
  const accepted = record.accepted || (published ? 'yes' : 'pending')
  return {
    journal: record.journal || '—',
    submitted: record.submitted ?? (['submitted', 'published'].includes(record.paperStatus) ? record.date : ''),
    accepted, published,
    stage: Object.hasOwn(paperStages, record.stage) ? record.stage : published ? 'published' : accepted === 'yes' ? 'accepted'
      : accepted === 'no' ? 'rejected' : record.paperStatus === 'submitted' ? 'submitted' : 'writing',
    indexing: record.indexing || '—'
  }
}

function field (label, control) {
  const wrapper = el('label', label)
  wrapper.append(control)
  return wrapper
}

function select (choices) {
  const control = el('select')
  control.append(...Object.entries(choices).map(([value, text]) => new Option(text, value)))
  return control
}

function button (text, handler) {
  const control = el('button', text, 'secondary compact')
  control.type = 'button'
  control.addEventListener('click', handler)
  return control
}

export function createLibrary (root, { controls, mediaOptions, editPaper, uploadPdf } = {}) {
  const tabs = el('nav', '', 'vault-category-tabs')
  tabs.setAttribute('aria-label', '按记录类型浏览')
  const range = select({ all: '全部日期', week: '按周', month: '按月', year: '按年' })
  const date = el('input')
  date.type = 'date'
  date.value = localDay()
  const category = select({ all: '全部分类' })
  const search = el('input')
  search.type = 'search'
  search.placeholder = '搜索标题或正文'
  const filters = el('div', '', 'vault-filters')
  filters.append(field('统计范围', range), field('参照日期', date), field('分类', category), field('搜索', search))
  const stats = el('div', '', 'vault-stats')
  const listing = el('div', '', 'vault-records')
  const urls = new Map()
  const inlineImages = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      inlineImages.unobserve(entry.target)
      if (entry.target.isConnected) entry.target.querySelector('button')?.click()
    }
  }, { rootMargin: '100px' }) : null
  let records = []
  let visible = false
  let limit = 18
  let revision = 0
  let reader

  root.append(tabs, filters, stats, listing)

  function clearMedia () {
    revision++
    if (reader?.open) reader.close()
    inlineImages?.disconnect()
    for (const url of urls.values()) URL.revokeObjectURL(url)
    urls.clear()
  }

  function mediaControl (file, kind, alt, label) {
    const box = el('div', '', 'vault-media-control')
    const status = el('span', '', 'muted')
    const launch = button(label || (kind === 'video' ? '加载并播放视频' : kind === 'image' ? '查看图片' : '下载 ' + file.name), async () => {
      const current = revision
      launch.disabled = true
      try {
        const blob = await openMedia(file, {
          ...mediaOptions?.(), progress: (done, total) => { status.textContent = `正在解密 ${done}/${total}` }
        })
        if (current !== revision || !box.isConnected) return
        if (kind === 'file') {
          download(blob, file.name)
          status.textContent = ''
          return
        }
        const url = URL.createObjectURL(blob)
        urls.set(box, url)
        const player = el(kind === 'video' ? 'video' : 'img')
        player.addEventListener('error', () => {
          box.replaceChildren(el('p', '当前浏览器无法预览该文件。', 'muted'), button('下载 ' + file.name, () => download(blob, file.name)))
        }, { once: true })
        player.src = url
        if (kind === 'video') {
          player.controls = true
          player.preload = 'metadata'
          player.playsInline = true
        } else player.alt = alt || file.name
        box.replaceChildren(player)
        if (kind === 'image' && box.closest('.vault-photo-album')) attachPhotoPreview(player)
        if (kind === 'video') void player.play().catch(() => {})
      } catch (error) {
        status.textContent = error.message || '附件暂时无法读取。'
      } finally {
        launch.disabled = false
      }
    })
    if (label) launch.title = file.name
    box.append(launch, status)
    if (kind === 'image' && file.size <= 8_000_000) inlineImages?.observe(box)
    return box
  }

  function notes (record) {
    const box = el('div', '', 'vault-notes')
    const navigation = el('nav', '', 'vault-outline vault-reading-outline')
    navigation.hidden = true
    const source = document.createElement('template')
    const inlineIds = new Set()
    if (record.format === 'visual') {
      source.innerHTML = record.note
      for (const marker of source.content.querySelectorAll('[data-inline-media]')) inlineIds.add(marker.dataset.inlineMedia)
    } else for (const match of record.note.matchAll(/attachment:([a-f0-9-]{36})/g)) inlineIds.add(match[1])
    const count = ['journal', 'paper'].includes(record.kind) ? el('span', '', 'vault-word-count') : null
    const actions = noteExports(record)
    if (count) actions.append(count)
    box.append(actions, navigation, richBody(record, (file, alt) => mediaControl(file, mediaKind(file), alt), navigation, count))
    for (const file of record.attachments || []) {
      if (!inlineIds.has(file.id)) box.append(mediaControl(file, mediaKind(file)))
    }
    return box
  }

  function noteExports (record) {
    const actions = el('div', '', 'vault-note-exports')
    const menu = select({ '': '导出与打印', print: '打印到打印机', pdf: '保存为 PDF', docx: '下载 Word DOCX', png: '导出高清 PNG', jpeg: '导出高清 JPEG', svg: '导出 SVG' })
    menu.setAttribute('aria-label', '导出与打印')
    const status = el('span', '', 'muted')
    status.setAttribute('role', 'status')
    menu.onchange = async () => {
      const format = menu.value
      if (!format) return
      menu.disabled = true
      status.textContent = '正在准备文档…'
      try {
        const { exportNote } = await import('./vault-export.js?v=8')
        await exportNote({ format, title: record.title, font: record.font, html: await editableDocument(record),
          files: (record.attachments || []).map(ref => ({ ref })), mediaOptions: mediaOptions?.(), alive: () => visible && actions.isConnected })
        status.textContent = ['print', 'pdf'].includes(format) ? '请在浏览器打印窗口选择输出位置。' : '文档已生成。'
      } catch (error) { status.textContent = error.message || '导出失败，请重试。' }
      finally { menu.disabled = false; menu.value = '' }
    }
    actions.append(menu, status)
    return actions
  }

  function viewLink (title, kind, id, reset = false) {
    const url = new URL(location.href)
    for (const key of ['kind', 'record', 'paper']) url.searchParams.delete(key)
    if (Object.hasOwn(kinds, kind)) url.searchParams.set('kind', kind)
    if (id) url.searchParams.set(kind === 'paper' ? 'paper' : 'record', id)
    const link = el('a', title)
    link.href = url.href
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      if (reset) {
        range.value = category.value = 'all'
        search.value = ''
        limit = 18
      }
      if (location.href !== link.href) history.pushState(null, '', link.href)
      render()
      root.scrollIntoView({ block: 'start' })
    })
    return link
  }

  function paperTable (papers) {
    const section = el('section', '', 'vault-paper-section')
    const titleBar = el('header', '', 'vault-section-head')
    titleBar.append(el('h3', '论文档案'), el('p', `${papers.length} 篇 · 点击论文标题查看详情和笔记`, 'muted'))
    const box = el('div', '', 'vault-table-wrap')
    box.tabIndex = 0
    box.setAttribute('aria-label', '论文档案表格，可横向滚动')
    const table = el('table', '', 'vault-paper-table')
    const headers = el('tr')
    for (const title of ['论文标题', '期刊', '所处阶段', '检索', '论文PDF']) {
      const cell = el('th', title)
      cell.scope = 'col'
      headers.append(cell)
    }
    table.append(el('thead'), el('tbody'))
    table.tHead.append(headers)
    for (const record of papers) {
      const row = el('tr')
      const paper = paperDetails(record)
      const title = el('td')
      const link = viewLink(record.title, 'paper', record.id)
      link.title = record.title
      title.append(link)
      const journal = el('td', paper.journal)
      journal.title = paper.journal
      const stage = el('td')
      const badge = el('span', paperStages[paper.stage], 'vault-stage')
      badge.dataset.stage = paper.stage
      stage.append(badge)
      const indexing = el('td', paper.indexing)
      indexing.title = paper.indexing
      row.append(title, journal, stage, indexing)
      const pdf = el('td', '—')
      if (record.pdf) pdf.replaceChildren(mediaControl(record.pdf, 'file', undefined, '下载 PDF'))
      else if (uploadPdf) pdf.replaceChildren(button('上传 PDF', () => uploadPdf(record)))
      row.append(pdf)
      table.tBodies[0].append(row)
    }
    box.append(table)
    section.append(titleBar, box)
    return section
  }

  function paperPage (record) {
    const article = el('article', '', 'vault-paper-detail entry')
    article.append(viewLink('← 返回资料库', 'paper'), el('h3', record.title))
    const paper = paperDetails(record)
    article.append(el('p', [paper.journal, paper.submitted || '未填投稿日期', paperStages[paper.stage], paper.indexing].join(' · '), 'entry-meta'))
    const pdfActions = el('div', '', 'actions')
    if (record.pdf) pdfActions.append(mediaControl(record.pdf, 'file'))
    if (uploadPdf) pdfActions.append(button(record.pdf ? '更换 PDF' : '上传 PDF', () => uploadPdf(record)))
    article.append(pdfActions)
    if (controls) article.append(controls(record))
    article.append(el('h4', '论文笔记'))
    if (record.note || record.attachments?.length) article.append(notes(record))
    else article.append(el('span', '正文 0 字', 'vault-word-count'), el('p', '尚未填写笔记。', 'muted'))
    if (editPaper) article.append(button('编辑论文笔记', () => editPaper(record)))
    return article
  }

  function detailPage (record) {
    const photo = record.kind === 'photo'
    const article = el('article', '', 'vault-record-detail vault-reading-page')
    article.append(viewLink(`← 返回${kinds[record.kind]}`, record.kind), el('h3', record.title),
      el('p', [record.date, record.category].filter(Boolean).join(' · '), 'entry-meta'))
    if (record.kind === 'video') {
      if (record.note) article.append(el('p', record.note, 'vault-album-caption'))
      const grid = el('div', '', 'vault-video-album')
      for (const [index, file] of [record.video, ...(record.attachments || [])].entries()) {
        const clip = el('figure', '', 'vault-clip')
        const name = el('figcaption', '', 'vault-clip-name')
        name.append(el('strong', '#' + String(index + 1).padStart(2, '0')), el('span', file.name))
        clip.append(mediaControl(file, 'video'), name)
        grid.append(clip)
      }
      article.append(grid)
    } else if (!photo) article.append(notes(record))
    else {
      if (record.note) article.append(el('p', record.note, 'vault-album-caption'))
      const grid = el('div', '', 'vault-photo-album')
      const mainImage = coverPhoto(record)
      attachPhotoPreview(mainImage)
      grid.append(mainImage)
      for (const file of record.attachments || []) {
        if (isPhoto(file)) grid.append(mediaControl(file, 'image'))
        else article.append(mediaControl(file, mediaKind(file)))
      }
      article.append(grid)
    }
    if (controls) article.append(controls(record))
    return article
  }

  function coverPhoto (record) {
    const img = el('img')
    img.alt = record.title
    img.loading = 'lazy'
    img.decoding = 'async'
    img.src = 'data:image/webp;base64,' + record.photo
    return img
  }

  function attachPhotoPreview (image) {
    image.tabIndex = 0
    image.setAttribute('role', 'button')
    image.setAttribute('aria-label', '放大图片：' + image.alt)
    const open = () => {
      const dialog = el('dialog', '', 'vault-dialog vault-image-viewer')
      dialog.setAttribute('aria-label', '图片预览')
      const preview = el('img')
      preview.src = image.src
      preview.alt = image.alt
      dialog.append(button('关闭', () => dialog.close()), preview)
      document.body.append(dialog)
      reader = dialog
      dialog.addEventListener('close', () => {
        dialog.remove()
        if (reader === dialog) reader = undefined
      }, { once: true })
      dialog.showModal()
    }
    image.onclick = open
    image.onkeydown = event => {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); open() }
    }
  }

  function card (record) {
    const article = el('article', '', 'entry vault-card')
    article.dataset.kind = record.kind
    const title = el('h3')
    title.append(viewLink(record.title, record.kind, record.id))
    article.append(title, el('p', [record.date, kinds[record.kind], record.category].filter(Boolean).join(' · '), 'entry-meta'))
    if (record.kind === 'photo') {
      const photo = el('figure', '', 'vault-photo')
      const imageLink = viewLink('', 'photo', record.id)
      imageLink.append(coverPhoto(record))
      photo.append(imageLink)
      if (record.note) photo.append(el('figcaption', record.note))
      article.append(photo)
      for (const file of record.attachments || []) {
        if (!isPhoto(file)) article.append(mediaControl(file, 'file'))
      }
    } else if (record.kind === 'video') {
      if (record.attachments?.length) article.append(viewLink('浏览 ' + (record.attachments.length + 1) + ' 个视频或分段', 'video', record.id))
      else article.append(mediaControl(record.video, 'video'))
      if (record.note) article.append(el('p', record.note, 'entry-text'))
    } else {
      if (record.note) {
        const preview = document.createElement('template')
        if (record.format === 'visual') preview.innerHTML = record.note.slice(0, 800)
        const text = record.format === 'visual' ? preview.content.textContent : record.note.replace(/^[#>*+-]+\s*/gm, '')
        if (text.trim()) article.append(el('p', text.trim().slice(0, 220), 'vault-journal-excerpt'))
      }
      article.append(viewLink('打开日记正文', 'journal', record.id))
    }
    if (controls) article.append(controls(record))
    return article
  }

  function render () {
    clearMedia()
    const params = new URL(location.href).searchParams
    const selectedKind = params.get('kind')
    const selectedPaper = params.get('paper')
    const selectedRecord = params.get('record')
    const detail = records.find(record => record.kind === 'paper' ? record.id === selectedPaper
      : record.kind === selectedKind && record.id === selectedRecord)
    filters.hidden = stats.hidden = Boolean(detail) || !visible
    tabs.hidden = !visible
    date.disabled = range.value === 'all'
    listing.replaceChildren()
    if (!visible) { stats.replaceChildren(); return }
    const activeKind = detail?.kind || selectedKind
    tabs.replaceChildren(...Object.entries({ all: '全部', photo: '照片', video: '视频', paper: '论文', journal: '日记' }).map(([kind, label]) => {
      const count = kind === 'all' ? records.length : records.filter(record => record.kind === kind).length
      const link = viewLink(`${label} ${count}`, kind, null, true)
      if (kind === (activeKind || 'all')) link.setAttribute('aria-current', 'page')
      return link
    }))
    if (detail) { listing.append(detail.kind === 'paper' ? paperPage(detail) : detailPage(detail)); return }
    const scope = range.value === 'all' ? null : period(validDay(date.value) ? date.value : localDay(), range.value)
    const keyword = search.value.trim().toLocaleLowerCase()
    const filtered = records.filter(record => (!scope || (record.date >= scope.start && record.date <= scope.end)) &&
      (category.value === 'all' || (record.category || '') === category.value.slice(1)) &&
      (!Object.hasOwn(kinds, selectedKind) || record.kind === selectedKind) &&
      (!keyword || [record.title, record.note, record.journal].some(text => typeof text === 'string' && text.toLocaleLowerCase().includes(keyword))))
      .sort((a, b) => Number(b.id === selectedRecord) - Number(a.id === selectedRecord) || b.date.localeCompare(a.date))
    stats.replaceChildren(el('p', (scope?.label || '全部日期') + ' · ' + filtered.length + ' 条记录', 'muted'))
    for (const [key, label] of Object.entries(kinds)) {
      stats.append(el('span', label + ' ' + filtered.filter(record => record.kind === key).length))
    }
    const papers = filtered.filter(record => record.kind === 'paper')
    if (scope && papers.length) {
      stats.append(el('span', '已录用 ' + papers.filter(record => paperDetails(record).accepted === 'yes').length))
      stats.append(el('span', '已见刊 ' + papers.filter(record => paperDetails(record).published).length))
    }
    if (!filtered.length) { listing.append(el('p', '暂无记录。', 'muted')); return }
    if (papers.length) listing.append(paperTable(papers))
    const cards = filtered.filter(record => record.kind !== 'paper')
    if (cards.length) {
      const grid = el('div', '', 'vault-grid')
      grid.append(...cards.slice(0, limit).map(card))
      listing.append(grid)
    }
    if (cards.length > limit) listing.append(button('显示更多记录', () => { limit += 18; render() }))
  }

  filters.addEventListener('change', () => { limit = 18; render() })
  search.addEventListener('input', () => { limit = 18; render() })
  window.addEventListener('popstate', render)
  return {
    show (items) {
      visible = true
      records = items
      const chosen = category.value
      const labels = [...new Set(items.map(record => typeof record.category === 'string' ? record.category : ''))].sort()
      category.replaceChildren(new Option('全部分类', 'all'), ...labels.map(label => new Option(label || '未分类', ':' + label)))
      category.value = [...category.options].some(option => option.value === chosen) ? chosen : 'all'
      render()
    },
    clear () {
      visible = false
      records = []
      category.replaceChildren(new Option('全部分类', 'all'))
      range.value = 'all'
      date.value = localDay()
      search.value = ''
      limit = 18
      render()
    }
  }
}
