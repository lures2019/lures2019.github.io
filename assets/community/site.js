(() => {
  const service = document.currentScript.dataset.service
  const avatarPath = '/assets/community/avatars.svg'
  const avatarCount = 64
  const commentPath = /^\/(books|movies|music)\/?(?:index\.html)?$/
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' })
  const items = new WeakSet()
  let actor
  let observer
  let lastPage
  let lastCount
  let highlighter

  function node (tag, text = '', className = '') {
    const element = document.createElement(tag)
    if (text) element.textContent = text
    if (className) element.className = className
    return element
  }

  function browserActor () {
    if (actor) return actor
    const key = 'treehouse-community-id'
    try {
      actor = localStorage.getItem(key) || crypto.randomUUID()
      localStorage.setItem(key, actor)
    } catch { actor ||= crypto.randomUUID() }
    return actor
  }

  function avatar (index) { return avatarPath + '#a' + index }
  function avatarIndex (text) {
    let hash = 0
    for (const character of text) hash = (Math.imul(31, hash) + character.codePointAt(0)) >>> 0
    return hash % avatarCount
  }

  function deviceLabel (value) {
    if (/平板|ipad|tablet/i.test(value)) return '平板'
    if (/手机|iphone|android|mobile|ipod/i.test(value)) return '手机'
    if (/桌面|windows|linux|macintosh|macos|mac os|ubuntu|cros|chrome os/i.test(value)) return '桌面'
    return '其他'
  }

  function prism () {
    return highlighter ||= new Promise((resolve, reject) => {
      const asset = document.createElement('script')
      asset.src = '/assets/community/prism.js?v=1'
      asset.onload = () => resolve(window.Prism)
      asset.onerror = () => { highlighter = undefined; asset.remove(); reject(new Error('语法高亮暂时无法加载')) }
      document.head.append(asset)
    })
  }

  function formatCode (pre, code, name = '') {
    if (pre.dataset.treehouseCode) return
    pre.dataset.treehouseCode = 'true'
    const inferred = [...code.classList, ...pre.classList].map(value => value.match(/^lang(?:uage)?-([\w+-]+)$/i)?.[1]).find(Boolean)
    const language = (name || inferred || '').toLowerCase()
    const raw = code.textContent
    const box = node('div', '', 'comment-code')
    const bar = node('div', '', 'comment-code-bar')
    const copy = button('复制代码')
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(raw); copy.textContent = '已复制' }
      catch { copy.textContent = '请选中代码复制' }
    }
    bar.append(node('span', language || '纯文本'), copy)
    pre.before(box)
    box.append(bar, pre)
    code.textContent = raw
    if (language) void prism().then(engine => {
      if (engine && Object.hasOwn(engine.languages, language)) code.innerHTML = engine.highlight(raw, engine.languages[language], language)
    }).catch(() => {})
  }

  function commentText (text) {
    const result = node('div', '', 'review-text')
    const fence = /^```([\w+-]*)[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm
    let end = 0
    for (const match of text.matchAll(fence)) {
      result.append(text.slice(end, match.index))
      const pre = node('pre')
      const code = node('code', match[2])
      pre.append(code)
      result.append(pre)
      formatCode(pre, code, match[1])
      end = match.index + match[0].length
    }
    result.append(text.slice(end))
    return result
  }

  function codeButton (input) {
    const control = button('插入代码块', 'review-button comment-code-insert')
    control.addEventListener('mousedown', event => event.preventDefault())
    control.onclick = () => {
      const start = input.selectionStart
      const end = input.selectionEnd
      const code = input.value.slice(start, end) || '// 在这里粘贴代码'
      const block = '```javascript\n' + code + '\n```'
      const before = start > 0 && input.value[start - 1] !== '\n' ? '\n' : ''
      const after = input.value[end] !== '\n' ? '\n' : ''
      if (input.maxLength > 0 && input.value.length - (end - start) + before.length + block.length + after.length > input.maxLength) return
      input.setRangeText(before + block + after, start, end, 'end')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
      input.setSelectionRange(start + before.length + 3, start + before.length + 13)
    }
    return control
  }

  async function api (path, body, count = false) {
    const response = await fetch(service + path, {
      method: body || count ? 'POST' : 'GET', credentials: 'omit',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      ...(AbortSignal.timeout ? { signal: AbortSignal.timeout(10_000) } : {})
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.message || '服务暂时不可用。')
    }
    return response.json()
  }

  function paintVisits (counts) {
    if (!counts) return
    const today = document.getElementById('treehouse-visits-today')
    const total = document.getElementById('treehouse-visits-total')
    if (today) today.textContent = Number(counts.today).toLocaleString('zh-CN')
    if (total) total.textContent = Number(counts.total).toLocaleString('zh-CN')
  }

  function visits () {
    const page = location.pathname + location.search
    if (page === lastPage) { paintVisits(lastCount); return }
    lastPage = page
    const ready = () => {
      void api('/visits', undefined, true).then(counts => {
        if (page === lastPage) { lastCount = counts; paintVisits(counts) }
      }).catch(() => {})
    }
    if (window.requestIdleCallback) requestIdleCallback(ready, { timeout: 1500 })
    else setTimeout(ready, 0)
  }

  function button (text, className = 'review-button') {
    const element = node('button', text, className)
    element.type = 'button'
    return element
  }

  function openReviews (item, title) {
    document.querySelector('.community-review-dialog')?.close()
    const dialog = node('dialog', '', 'community-review-dialog')
    const heading = node('h2', title + ' · 短评')
    heading.id = 'review-title'
    dialog.setAttribute('aria-labelledby', heading.id)
    const close = button('关闭')
    close.onclick = () => dialog.close()
    dialog.addEventListener('close', () => dialog.remove(), { once: true })
    const header = node('header')
    header.append(heading, close)
    const form = node('form')
    const status = node('p', '正在加载短评…', 'review-status')
    status.setAttribute('role', 'status')
    const list = node('div', '', 'review-list')
    const author = node('input')
    author.maxLength = 24
    author.placeholder = '留空则匿名，可填写昵称或姓名'
    const authorLabel = node('label', '署名（可选）')
    authorLabel.append(author)
    const body = node('textarea')
    body.required = true
    body.maxLength = 800
    body.rows = 3
    const bodyLabel = node('label', '短评内容')
    bodyLabel.append(body)
    const avatarField = node('fieldset', '', 'review-avatars')
    avatarField.append(node('legend', `选择头像（${avatarCount} 款）`))
    const avatarGrid = node('div', '', 'review-avatar-grid')
    const defaultAvatar = avatarIndex(browserActor())
    for (let i = 0; i < avatarCount; i++) {
      const label = node('label')
      const radio = node('input')
      radio.type = 'radio'
      radio.name = 'avatar'
      radio.value = String(i)
      radio.checked = i === defaultAvatar
      radio.setAttribute('aria-label', '头像 ' + (i + 1))
      const image = node('img')
      image.src = avatar(i)
      image.alt = ''
      image.loading = 'lazy'
      image.width = image.height = 32
      label.append(radio, image)
      avatarGrid.append(label)
    }
    avatarField.append(avatarGrid)
    const publish = button('发表短评')
    publish.type = 'submit'
    const cancel = button('取消回复')
    cancel.hidden = true
    const replyInfo = node('span', '', 'review-reply-info')
    const actions = node('div', '', 'review-actions')
    actions.append(publish, cancel, replyInfo)
    form.append(authorLabel, bodyLabel, codeButton(body), avatarField, actions)
    dialog.append(header, form, status, list)
    document.body.append(dialog)
    dialog.showModal()

    let parent = null
    let draftId
    let busy = false
    const route = '/reviews?item=' + encodeURIComponent(item)
    function replyTo (entry) {
      parent = entry?.id || null
      replyInfo.textContent = entry ? '回复 ' + (entry.name || '匿名读者') : ''
      publish.textContent = entry ? '发表回复' : '发表短评'
      cancel.hidden = !entry
      if (entry) body.focus()
    }
    cancel.onclick = () => replyTo(null)
    form.addEventListener('input', () => { draftId = undefined })

    function card (entry, isReply = false) {
      const article = node('article', '', isReply ? 'review-card review-reply' : 'review-card')
      const picture = node('img', '', 'review-avatar')
      picture.alt = ''
      picture.src = avatar(entry.avatar)
      picture.loading = 'lazy'
      picture.width = picture.height = 38
      const name = node('strong', entry.name || '匿名读者')
      const time = node('time', dateFormat.format(entry.time))
      time.dateTime = new Date(entry.time).toISOString()
      const meta = node('div', '', 'review-meta')
      meta.append(name, time, node('span', deviceLabel(entry.terminal), 'comment-device'))
      const main = node('div', '', 'review-main')
      main.append(meta, commentText(entry.body))
      const tools = node('div', '', 'review-actions')
      const like = button('♥ ' + entry.likes, 'review-button review-like')
      like.disabled = Boolean(entry.liked)
      like.setAttribute('aria-label', `${entry.liked ? '已点赞' : '点赞'}，${entry.likes} 人赞`)
      like.onclick = async () => {
        like.disabled = true
        try {
          await api(route, { action: 'like', id: entry.id, actor: browserActor() })
          like.textContent = '♥ ' + (entry.likes + 1)
          like.setAttribute('aria-label', `已点赞，${entry.likes + 1} 人赞`)
        } catch (error) { like.disabled = false; status.textContent = error.message }
      }
      tools.append(like)
      if (!isReply) {
        const reply = button('回复')
        reply.onclick = () => replyTo(entry)
        tools.append(reply)
      }
      main.append(tools)
      for (const response of entry.replies || []) main.append(card(response, true))
      article.append(picture, main)
      return article
    }

    async function refresh () {
      const { entries } = await api(route + '&actor=' + browserActor())
      list.replaceChildren(...entries.map(entry => card(entry)))
      status.textContent = entries.length ? '显示最近 ' + entries.length + ' 条短评 · 时间为北京时间' : '还没有短评，欢迎留下你的看法。'
    }

    form.onsubmit = async event => {
      event.preventDefault()
      if (busy) return
      const text = body.value.trim()
      if (!text) { status.textContent = '请填写短评内容。'; return }
      busy = publish.disabled = true
      draftId ||= crypto.randomUUID()
      try {
        await api(route, { action: 'post', id: draftId, actor: browserActor(), body: text, name: author.value, parent,
          avatar: Number(form.elements.avatar.value) })
        draftId = undefined
        body.value = ''
        replyTo(null)
        await refresh().catch(() => { status.textContent = '已发表。重新打开短评可查看。' })
      } catch (error) { status.textContent = error.message }
      finally { busy = publish.disabled = false }
    }
    void refresh().catch(error => { status.textContent = error.message })
  }

  function appendReview (host, key, title) {
    const control = button('短评与回复', 'review-button review-item-button')
    control.setAttribute('aria-label', '查看《' + title + '》的短评与回复')
    control.onclick = event => { event.preventDefault(); event.stopPropagation(); openReviews(key, title) }
    host.append(control)
  }

  function catalog (section) {
    const root = document.getElementById('article-container')
    if (!root) return
    if (section === 'music') {
      for (const row of root.querySelectorAll('.aplayer-list li')) {
        const title = row.querySelector('.aplayer-list-title')?.textContent.trim()
        if (!title || items.has(row)) continue
        items.add(row)
        const artist = row.querySelector('.aplayer-list-author')?.textContent.trim() || ''
        void crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([title, artist]))).then(hash => {
          const id = [...new Uint8Array(hash).slice(0, 12)].map(byte => byte.toString(16).padStart(2, '0')).join('')
          if (row.isConnected) appendReview(row, 'music-' + id, title)
        })
      }
      return
    }
    for (const link of root.querySelectorAll('#idouban a[href*="/subject/"], a[href*=".douban.com/subject/"]')) {
      const id = /\/subject\/(\d+)\/?/.exec(link.pathname)?.[1]
      const row = link.closest('.idouban-item, .hexo-douban-item') || link.parentElement
      if (!id || items.has(row)) continue
      const title = (link.textContent || link.querySelector('img')?.alt || row.querySelector('a[title]')?.title || '').trim()
      if (!title) continue
      items.add(row)
      const target = row.querySelector('.idouban-info, .hexo-douban-info') || row
      appendReview(target, section + '-' + id, title)
    }
  }

  function commentAvatars () {
    for (const image of document.querySelectorAll('#vcomment .vcard .vimg')) {
      if (items.has(image)) continue
      const card = image.closest('.vcard')
      const name = card?.querySelector('.vnick')?.textContent.trim() || ''
      if (!name || /^(zayden|lures2019)$/i.test(name)) continue
      items.add(image)
      const index = avatarIndex(name + (name === '匿名' ? card?.querySelector('.vtime')?.textContent : ''))
      image.removeAttribute('srcset')
      image.src = avatar(index)
    }
  }

  function valineTools () {
    const root = document.getElementById('vcomment')
    if (!root) return
    const input = root.querySelector('textarea.veditor')
    if (input && !input.dataset.treehouseCode) {
      input.dataset.treehouseCode = 'true'
      input.before(codeButton(input))
    }
    for (const pre of root.querySelectorAll('.vcontent pre')) {
      const code = pre.querySelector('code')
      if (code) formatCode(pre, code)
    }
    for (const card of root.querySelectorAll('.vcard')) {
      const labels = [...card.querySelectorAll('.vsys')].filter(label => label.closest('.vcard') === card)
      if (!labels.length || labels[0].classList.contains('comment-device')) continue
      labels[0].textContent = deviceLabel(labels.map(label => label.textContent).join(' '))
      labels[0].classList.add('comment-device')
      for (const label of labels.slice(1)) label.remove()
    }
  }

  function setup () {
    visits()
    observer?.disconnect()
    const section = commentPath.exec(location.pathname)?.[1]
    const root = section ? document.getElementById('article-container') : document.getElementById('vcomment')
    if (!root) return
    let scheduled = false
    const enhance = () => {
      scheduled = false
      if (section) catalog(section)
      commentAvatars()
      valineTools()
    }
    observer = new MutationObserver(() => {
      if (!scheduled) { scheduled = true; requestAnimationFrame(enhance) }
    })
    observer.observe(root, { subtree: true, childList: true })
    const comments = document.getElementById('vcomment')
    if (comments && comments !== root && !root.contains(comments)) observer.observe(comments, { subtree: true, childList: true })
    enhance()
  }

  setup()
  document.addEventListener('pjax:complete', setup)
})()
