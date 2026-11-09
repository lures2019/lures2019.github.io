import { idPattern, localDay, maxFocusMs, studyDays, validDay } from './todo-model.js'

const storage = 'zayden-focus-v1'
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

function loadTimer () {
  try {
    const value = JSON.parse(sessionStorage.getItem(storage) || 'null')
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

function clockText (ms, remaining) {
  const seconds = remaining ? Math.ceil(ms / 1000) : Math.floor(ms / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(part => String(part).padStart(2, '0')).join(':')
}

export function bindTimer ({ canSave, save, notify }) {
  const get = id => document.getElementById(id)
  const form = get('timer-form')
  const { title, mode, minutes } = form.elements
  const start = get('timer-start')
  const pause = get('timer-pause')
  const finishButton = get('timer-save')
  const discard = get('timer-discard')
  const state = get('timer-state')
  const clock = get('timer-clock')
  let selected
  let current = loadTimer()
  let saving = false

  function persist () {
    try {
      if (current) sessionStorage.setItem(storage, JSON.stringify(current))
      else sessionStorage.removeItem(storage)
    } catch {
      notify('浏览器无法保存本次计时草稿，建议保存后再离开页面。')
    }
  }

  function render () {
    const active = Boolean(current)
    const down = (current?.mode || mode.value) === 'countdown'
    const limit = current?.limit ?? Math.max(0, Number(minutes.value)) * 60_000
    const elapsed = current ? elapsedAt(current, Date.now()) : 0
    clock.value = clockText(down ? Math.max(0, limit - elapsed) : elapsed, down)
    const running = active && current.started !== null
    state.textContent = saving ? '正在保存' : !active ? '等待开始' : current.done ? '已结束 · 待保存'
      : running ? (down ? '倒计时中' : '正计时中') : '已暂停'
    title.disabled = active
    mode.disabled = active
    get('timer-minutes').hidden = !down
    minutes.disabled = active || !down
    start.hidden = active
    start.disabled = !canSave()
    pause.hidden = !active || current.done
    pause.textContent = running ? '暂停' : '继续'
    finishButton.hidden = !active
    finishButton.disabled = saving || !canSave() || elapsed < 1000
    finishButton.textContent = active && current.done ? '保存本次时长' : '结束并保存'
    discard.hidden = !active
    discard.disabled = saving
  }

  function reset () {
    current = null
    selected = undefined
    title.value = ''
    persist()
    render()
  }

  async function finish () {
    if (!current || saving) return
    if (!current.done) {
      stopSegment(current, Date.now())
      if (closedTime(current) < 1000) return render()
      current.done = true
      persist()
    }
    if (!canSave()) return render()
    saving = true
    render()
    try {
      if (await save({ id: current.id, taskId: current.taskId, title: current.title, day: current.day,
        days: studyDays(current.segments) })) reset()
    } finally {
      saving = false
      render()
    }
  }

  function tick () {
    if (current && !current.done && elapsedAt(current, Date.now()) >= current.limit) {
      finish()
    } else {
      render()
    }
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
  finishButton.addEventListener('click', finish)
  discard.addEventListener('click', () => {
    if (current && !saving && confirm('放弃本次计时记录？')) reset()
  })
  title.addEventListener('input', () => { selected = undefined })
  mode.addEventListener('change', render)
  minutes.addEventListener('input', render)
  if (current) {
    title.value = current.title
    mode.value = current.mode
    if (current.mode === 'countdown') minutes.value = String(current.limit / 60_000)
  }
  setInterval(tick, 250)
  render()

  return {
    render,
    prefill (task, due) {
      if (current) return notify('请先结束并保存当前计时。')
      selected = { id: task.id, due }
      title.value = task.title
      title.focus()
    }
  }
}
