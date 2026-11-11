import { idPattern, localDay, maxFocusMs, studyDays, validDay } from './todo-model.js?v=4'

const legacyStorage = 'zayden-focus-v1'
const storage = 'treehouse-focus-active-v2'
const draftStorage = 'zayden-focus-draft-v1'
const modes = ['countdown', 'stopwatch']
const closedTime = timer => timer.segments.reduce((sum, [from, to]) => sum + to - from, 0)

export function elapsedAt (timer, now) {
  const running = timer.started === null ? 0 : Math.max(0, now - timer.started)
  return Math.min(timer.limit, closedTime(timer) + running)
}

export function stopSegment (timer, now) {
  if (timer.started === null) return
  const end = timer.started + elapsedAt(timer, now) - closedTime(timer)
  if (end > timer.started) timer.segments.push([timer.started, end])
  timer.started = null
}

function parseTimer (raw) {
  try {
    const value = JSON.parse(raw || 'null')
    if (!value || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160 ||
        !validDay(value.day) || typeof value.id !== 'string' || !idPattern.test(value.id) ||
        (value.taskId !== null && (typeof value.taskId !== 'string' || !idPattern.test(value.taskId))) ||
        !modes.includes(value.mode) || !Number.isSafeInteger(value.limit) || value.limit < 60_000 ||
        value.limit > maxFocusMs || typeof value.done !== 'boolean' ||
        (value.started !== null && (!Number.isSafeInteger(value.started) || value.started < 1_000_000_000_000)) ||
        !Array.isArray(value.segments) || value.segments.some(segment => !Array.isArray(segment) ||
          segment.length !== 2 || !Number.isSafeInteger(segment[0]) || !Number.isSafeInteger(segment[1]) ||
          segment[0] < 1_000_000_000_000 || segment[1] <= segment[0]) ||
        closedTime(value) > value.limit || (value.done && value.started !== null)) return null
    return value
  } catch {
    return null
  }
}

function loadTimer () {
  try {
    const saved = localStorage.getItem(storage)
    if (saved !== null) return parseTimer(saved)
  } catch { /* The same tab can still use its session storage. */ }
  try { return parseTimer(sessionStorage.getItem(storage) || sessionStorage.getItem(legacyStorage)) }
  catch { return null }
}

function clockText (ms, remaining) {
  const seconds = remaining ? Math.ceil(ms / 1000) : Math.floor(ms / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(part => String(part).padStart(2, '0')).join(':')
}

export function bindTimer ({ canSave, canCelebrate, save, notify, celebrate }) {
  const get = id => document.getElementById(id)
  const form = get('timer-form')
  const { title, mode, minutes } = form.elements
  const start = get('timer-start')
  const pause = get('timer-pause')
  const finishButton = get('timer-save')
  const discard = get('timer-discard')
  const state = get('timer-state')
  const clock = get('timer-clock')
  const correct = get('timer-correct')
  const endForm = get('timer-end-form')
  const endInput = endForm.elements.actualEnd
  let selected
  let current = loadTimer()
  let autoRecover = Boolean(current?.done)
  let saving = false

  function rememberDraft () {
    try {
      sessionStorage.setItem(draftStorage, JSON.stringify({ title: title.value, mode: mode.value, minutes: minutes.value, selected }))
    } catch { /* The timer remains usable when session storage is unavailable. */ }
  }

  function persist () {
    const data = current ? JSON.stringify(current) : 'null'
    try {
      localStorage.setItem(storage, data)
      sessionStorage.removeItem(legacyStorage)
      sessionStorage.removeItem(storage)
    } catch {
      try { sessionStorage.setItem(storage, data) }
      catch { notify('浏览器无法保存本次计时草稿，请先保存再离开页面。') }
    }
  }

  function render () {
    const active = Boolean(current)
    const down = (current?.mode || mode.value) === 'countdown'
    const limit = current?.limit ?? Math.max(0, Number(minutes.value)) * 60_000
    const elapsed = current ? elapsedAt(current, Date.now()) : 0
    if (current?.rewardPending && canCelebrate()) {
      current.rewardPending = false
      persist()
      celebrate(current.title, elapsed)
    }
    clock.value = clockText(down ? Math.max(0, limit - elapsed) : elapsed, down)
    const running = active && current.started !== null
    state.textContent = saving ? '正在保存' : !active ? '等待开始' : current.done ? '已结束 · 待保存'
      : running ? (down ? '倒计时中' : elapsed >= limit ? '达到计时上限 · 请确认结束' : '正计时中') : '已暂停'
    title.disabled = active
    mode.disabled = active
    get('timer-minutes').hidden = !down
    minutes.disabled = active || !down
    start.hidden = active
    start.disabled = !canSave()
    pause.hidden = !active || current.done
    pause.textContent = running ? '暂停' : '继续'
    finishButton.hidden = !active
    finishButton.disabled = saving || elapsed < 1000 || (current?.done && !canSave())
    finishButton.textContent = active && current.done ? '保存本次时长' : '结束并保存'
    discard.hidden = !active
    discard.disabled = saving
    correct.hidden = down || !running || Boolean(current?.done)
    correct.disabled = saving
    if (correct.hidden) endForm.hidden = true
  }

  function reset () {
    current = null
    selected = undefined
    title.value = ''
    endForm.hidden = true
    persist()
    rememberDraft()
    render()
  }

  async function finish (end = Date.now()) {
    if (!current || saving) return
    if (!current.done) {
      if (elapsedAt(current, end) < 1000) return notify('请至少记录一秒。')
      stopSegment(current, end)
      current.done = true
      current.rewardPending = true
      persist()
    }
    if (!canSave()) {
      autoRecover = true
      notify('计时已结束并保存在本机，连接后可补存到 GitHub。')
      return render()
    }
    const session = current
    saving = true
    render()
    try {
      if (await save({ id: session.id, taskId: session.taskId, title: session.title, day: session.day,
        days: studyDays(session.segments) }) && current?.id === session.id) reset()
    } finally {
      saving = false
      render()
    }
  }

  function tick () {
    if (current?.mode === 'countdown' && !current.done && elapsedAt(current, Date.now()) >= current.limit) {
      void finish()
      return
    }
    if (autoRecover && current?.done && canSave() && !saving) {
      autoRecover = false
      void finish()
      return
    }
    render()
  }

  form.addEventListener('submit', event => {
    event.preventDefault()
    if (current || !canSave() || !title.value.trim()) return
    const limit = mode.value === 'countdown' ? minutes.valueAsNumber * 60_000 : maxFocusMs
    if (!Number.isSafeInteger(limit) || limit < 60_000 || limit > maxFocusMs) return
    current = { id: crypto.randomUUID(), taskId: selected?.id || null, title: title.value.trim(),
      day: selected?.due || localDay(), mode: mode.value, limit, started: Date.now(), segments: [], done: false }
    persist()
    render()
  })

  pause.addEventListener('click', () => {
    if (!current || current.done) return
    if (current.started === null) current.started = Date.now()
    else stopSegment(current, Date.now())
    persist()
    tick()
  })
  finishButton.addEventListener('click', () => void finish())
  correct.addEventListener('click', () => {
    endForm.hidden = false
    const asChina = time => new Date(time + 8 * 3600_000).toISOString().slice(0, 19)
    endInput.min = asChina(current.started)
    endInput.max = asChina(Date.now())
    endInput.value = endInput.max
    endInput.focus()
  })
  get('timer-end-cancel').onclick = () => { endForm.hidden = true }
  endForm.onsubmit = event => {
    event.preventDefault()
    const end = Date.parse(endInput.value + '+08:00')
    if (!current || current.started === null || !Number.isFinite(end) || end < current.started || end > Date.now()) {
      return notify('请填写最后一段开始与现在之间的北京时间。')
    }
    void finish(end)
  }
  discard.addEventListener('click', () => {
    if (current && !saving && confirm('放弃本次计时记录？')) reset()
  })
  title.addEventListener('input', () => { selected = undefined; rememberDraft() })
  mode.addEventListener('change', () => { rememberDraft(); render() })
  minutes.addEventListener('input', () => { rememberDraft(); render() })
  if (current) {
    persist()
    title.value = current.title
    mode.value = current.mode
    if (current.mode === 'countdown') minutes.value = String(current.limit / 60_000)
  } else {
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftStorage) || 'null')
      if (typeof draft?.title === 'string') title.value = draft.title.slice(0, 160)
      if (modes.includes(draft?.mode)) mode.value = draft.mode
      if (/^\d{1,4}$/.test(draft?.minutes)) minutes.value = draft.minutes
      if (idPattern.test(draft?.selected?.id) && validDay(draft.selected.due)) selected = draft.selected
    } catch { /* A malformed draft can be discarded without affecting saved time. */ }
  }
  window.addEventListener('storage', event => {
    if (event.key !== storage || event.storageArea !== localStorage) return
    const wasActive = Boolean(current)
    current = parseTimer(event.newValue)
    if (current) {
      current.rewardPending = false
      title.value = current.title
      mode.value = current.mode
      if (current.mode === 'countdown') minutes.value = String(current.limit / 60_000)
    } else if (wasActive) { title.value = ''; selected = undefined }
    endForm.hidden = true
    render()
  })
  window.addEventListener('online', () => {
    autoRecover = Boolean(current?.done)
    tick()
  })
  setInterval(tick, 250)
  render()

  return {
    render,
    prefill (task, due) {
      if (current) return notify('请先结束并保存当前计时。')
      selected = { id: task.id, due }
      title.value = task.title
      rememberDraft()
      title.focus()
    }
  }
}
