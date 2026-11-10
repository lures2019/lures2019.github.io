import { download, el } from './vault-crypto.js'
import { openMedia } from './vault-media.js'
import { richBody } from './vault-rich.js'
import { localDay, period, validDay } from './todo-model.js'

const kinds = { photo: '照片', journal: '日记', paper: '论文', video: '视频' }

export function paperDetails (record) {
  return {
    journal: record.journal || '—',
    submitted: record.submitted ?? (['submitted', 'published'].includes(record.paperStatus) ? record.date : ''),
    accepted: record.accepted || (record.paperStatus === 'published' ? 'yes' : 'pending'),
    published: record.published ?? (record.paperStatus === 'published')
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
  const urls = new Set()
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

  root.append(filters, stats, listing)

  function clearMedia () {
    revision++
    inlineImages?.disconnect()
    for (const url of urls) URL.revokeObjectURL(url)
    urls.clear()
  }

  function mediaControl (file, kind, alt) {
    const box = el('div', '', 'vault-media-control')
    const status = el('span', '', 'muted')
    const launch = button(kind === 'video' ? '加载并播放视频' : kind === 'image' ? '查看图片' : '下载 ' + file.name, async () => {
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
        urls.add(url)
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
    const box = el('div', '', 'vault-table-wrap')
    const table = el('table', '', 'vault-paper-table')
    const headers = el('tr')
    for (const title of ['论文标题', '投稿期刊', '投稿日期', '是否录用', '是否见刊', ...(controls ? ['操作'] : []), '论文 PDF']) {
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
      title.append(paperLink(record.title, record.id))
      row.append(title)
      for (const value of [paper.journal, paper.submitted || '—', { yes: '已录用', no: '未录用', pending: '待定' }[paper.accepted] || '待定', paper.published ? '已见刊' : '未见刊']) {
        row.append(el('td', value))
      }
      if (controls) {
        const actions = el('td')
        actions.append(controls(record))
        row.append(actions)
      }
      const pdf = el('td', paper.published ? '待上传' : '—')
      if (paper.published && record.pdf) pdf.replaceChildren(mediaControl(record.pdf, 'file'))
      row.append(pdf)
      table.tBodies[0].append(row)
    }
    box.append(table)
    return box
  }

  function paperPage (record) {
    const article = el('article', '', 'vault-paper-detail entry')
    article.append(paperLink('← 返回资料库', null), el('h3', record.title))
    const paper = paperDetails(record)
    article.append(el('p', [paper.journal, paper.submitted || '未填投稿日期', paper.published ? '已见刊' : '未见刊'].join(' · '), 'entry-meta'))
    if (paper.published && record.pdf) article.append(mediaControl(record.pdf, 'file'))
    article.append(el('h4', '论文笔记'), notes(record))
    if (editPaper) article.append(button('编辑论文笔记', () => editPaper(record)))
    return article
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
    } else if (record.format === 'rich' || record.attachments?.length) {
      const details = el('details')
      details.append(el('summary', '打开日记正文'))
      details.addEventListener('toggle', () => {
        if (details.open && details.childElementCount === 1) details.append(notes(record))
      })
      article.append(details)
    } else if (record.note) {
      article.append(el('p', record.note, 'entry-text'))
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
    if (papers.length) {
      stats.append(el('span', '已录用 ' + papers.filter(record => paperDetails(record).accepted === 'yes').length))
      stats.append(el('span', '已见刊 ' + papers.filter(record => paperDetails(record).published).length))
    }
    if (!filtered.length) { listing.append(el('p', '暂无记录。', 'muted')); return }
    if (papers.length) listing.append(paperTable(papers))
    const cards = filtered.filter(record => record.kind !== 'paper')
    listing.append(...cards.slice(0, limit).map(card))
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
