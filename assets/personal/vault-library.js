import { download, el } from './vault-crypto.js'
import { openMedia } from './vault-media.js'
import { richBody } from './vault-rich.js?v=5'
import { localDay, period, validDay } from './todo-model.js'

const kinds = { photo: '照片', journal: '日记', paper: '论文', video: '视频' }
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

export function createLibrary (root, { controls, mediaOptions, editPaper } = {}) {
  const type = select({ all: '全部类型', ...kinds })
  const range = select({ all: '全部日期', week: '按周', month: '按月', year: '按年' })
  const date = el('input')
  date.type = 'date'
  date.value = localDay()
  const category = select({ all: '全部分类' })
  const search = el('input')
  search.type = 'search'
  search.placeholder = '搜索标题或正文'
  const filters = el('div', '', 'vault-filters')
  filters.append(field('类型', type), field('统计范围', range), field('参照日期', date), field('分类', category), field('搜索', search))
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

  root.append(filters, stats, listing)

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
        player.src = url
        if (kind === 'video') {
          player.controls = true
          player.preload = 'metadata'
          player.playsInline = true
        } else player.alt = alt || file.name
        box.replaceChildren(player)
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
    box.append(richBody(record, (file, alt) => mediaControl(file, 'image', alt)))
    for (const file of record.attachments || []) box.append(mediaControl(file, 'file'))
    return box
  }

  function routePaper (id) {
    const url = new URL(location.href)
    if (id) url.searchParams.set('paper', id)
    else url.searchParams.delete('paper')
    return url
  }

  function paperLink (title, id) {
    const link = el('a', title)
    link.href = routePaper(id).href
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      history.pushState(null, '', link.href)
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
      const link = paperLink(record.title, record.id)
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
      const pdf = el('td', paper.published ? '待上传' : '—')
      if (paper.published && record.pdf) pdf.replaceChildren(mediaControl(record.pdf, 'file', undefined, '下载 PDF'))
      row.append(pdf)
      table.tBodies[0].append(row)
    }
    box.append(table)
    section.append(titleBar, box)
    return section
  }

  function paperPage (record) {
    const article = el('article', '', 'vault-paper-detail entry')
    article.append(paperLink('← 返回资料库', null), el('h3', record.title))
    const paper = paperDetails(record)
    article.append(el('p', [paper.journal, paper.submitted || '未填投稿日期', paperStages[paper.stage], paper.indexing].join(' · '), 'entry-meta'))
    if (paper.published && record.pdf) article.append(mediaControl(record.pdf, 'file'))
    if (controls) article.append(controls(record))
    article.append(el('h4', '论文笔记'), record.note || record.attachments?.length ? notes(record) : el('p', '尚未填写笔记。', 'muted'))
    if (editPaper) article.append(button('编辑论文笔记', () => editPaper(record)))
    return article
  }

  function openJournal (record) {
    const dialog = el('dialog', '', 'vault-dialog vault-reader-dialog')
    dialog.setAttribute('aria-label', record.title)
    const header = el('header', '', 'vault-dialog-head')
    header.append(el('h2', record.title), button('关闭', () => dialog.close()))
    const documentView = el('div', '', 'vault-reading-page')
    documentView.append(el('p', [record.date, record.category].filter(Boolean).join(' · '), 'entry-meta'), notes(record))
    dialog.append(header, documentView)
    document.body.append(dialog)
    reader = dialog
    dialog.addEventListener('close', () => {
      for (const [box, url] of urls) {
        if (dialog.contains(box)) { URL.revokeObjectURL(url); urls.delete(box) }
      }
      dialog.remove()
      if (reader === dialog) reader = undefined
    }, { once: true })
    dialog.showModal()
  }

  function card (record) {
    const article = el('article', '', 'entry vault-card')
    article.dataset.kind = record.kind
    article.append(el('h3', record.title), el('p', [record.date, kinds[record.kind], record.category].filter(Boolean).join(' · '), 'entry-meta'))
    if (record.kind === 'photo') {
      const photo = el('figure', '', 'vault-photo')
      const img = el('img')
      img.alt = record.title
      img.loading = 'lazy'
      img.decoding = 'async'
      img.src = 'data:image/webp;base64,' + record.photo
      photo.append(img)
      if (record.note) photo.append(el('figcaption', record.note))
      article.append(photo)
      for (const file of record.attachments || []) article.append(mediaControl(file, 'file'))
    } else if (record.kind === 'video') {
      article.append(mediaControl(record.video, 'video'))
      if (record.note) article.append(el('p', record.note, 'entry-text'))
    } else {
      if (record.note) {
        const preview = document.createElement('template')
        if (record.format === 'visual') preview.innerHTML = record.note.slice(0, 800)
        const text = record.format === 'visual' ? preview.content.textContent : record.note.replace(/^[#>*+-]+\s*/gm, '')
        if (text.trim()) article.append(el('p', text.trim().slice(0, 220), 'vault-journal-excerpt'))
      }
      article.append(button('打开日记正文', () => openJournal(record)))
    }
    if (controls) article.append(controls(record))
    return article
  }

  function render () {
    clearMedia()
    const selectedPaper = new URL(location.href).searchParams.get('paper')
    const detail = records.find(record => record.kind === 'paper' && record.id === selectedPaper)
    filters.hidden = stats.hidden = Boolean(detail) || !visible
    date.disabled = range.value === 'all'
    listing.replaceChildren()
    if (!visible) { stats.replaceChildren(); return }
    if (detail) { listing.append(paperPage(detail)); return }
    const scope = range.value === 'all' ? null : period(validDay(date.value) ? date.value : localDay(), range.value)
    const keyword = search.value.trim().toLocaleLowerCase()
    const filtered = records.filter(record => (!scope || (record.date >= scope.start && record.date <= scope.end)) &&
      (category.value === 'all' || (record.category || '') === category.value.slice(1)) &&
      (type.value === 'all' || record.kind === type.value) &&
      (!keyword || [record.title, record.note, record.journal].some(text => typeof text === 'string' && text.toLocaleLowerCase().includes(keyword))))
      .sort((a, b) => b.date.localeCompare(a.date))
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
      type.value = range.value = 'all'
      date.value = localDay()
      search.value = ''
      limit = 18
      render()
    }
  }
}
