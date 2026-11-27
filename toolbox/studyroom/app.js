import { config } from './config.js'
import { $, avatar, element, formatCode, icon, setIcon, toast } from './ui.js'
import { MeetingMedia } from './rtc.js?v=0.1.1'
import { makeBoard } from './board.js?v=0.1.1'
import { MeetingSignal } from './signaling.js'

const desktop = window.studyDesktop
const CODE = /^[0-9A-HJKMNP-TV-Z]{16}$/
const defaultProfile = { name: '访客', avatar: '', tone: 0 }
const local = ['localhost', '127.0.0.1'].includes(location.hostname)
const mediaLabels = {
  mic: ['打开麦克风', '关闭麦克风', 'mic-off', 'mic'],
  camera: ['打开摄像头', '关闭摄像头', 'camera-off', 'video'],
  screen: ['共享屏幕', '停止共享', 'monitor', 'monitor']
}
const sample = [
  { id: 'code', name: '小林', tone: 0, screen: true, host: true },
  { id: 'timer', name: '阿禾', tone: 1, screen: true },
  { id: 'board', name: '橘子', tone: 2, screen: true }
]
let identity = { ...defaultProfile, ...load('study-profile') }
let active
let pending
let draft
let clock
let localSignal = load('study-signal') || ''
const board = makeBoard(send)

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}

function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Private browsing storage */ }
}

function makeRoom(data) {
  return {
    code: '', started: Date.now(), locked: false, players: new Map(), incoming: new Map(), media: {},
    cards: new Map(), busy: new Set(), focus: '', chatCount: 0, status: new Map(), strokes: [], ...data
  }
}

function send(message) {
  if (!active) return
  if (active.demo) {
    if (message.type === 'stroke') board.draw(message.stroke)
    if (message.type === 'clear') board.reset()
    if (message.type === 'chat') appendChat({ body: message.body, name: identity.name, at: Date.now() })
    if (message.type === 'profile') {
      Object.assign(active.players.get(active.id), identity)
      renderPeople()
    }
    return true
  }
  return active.signal.send(message)
}

function normalizeCode(input) {
  let value = input.trim()
  if (value.includes('://')) {
    try { value = new URLSearchParams(new URL(value).hash.slice(1)).get('room') ?? '' } catch { return '' }
  }
  value = value.replace(/[\s-]/g, '').toUpperCase()
  return CODE.test(value) ? value : ''
}

function endpoint(value) {
  try {
    const address = new URL(value)
    const secure = address.protocol === 'wss:'
    const loopback = address.protocol === 'ws:' && ['localhost', '127.0.0.1'].includes(address.hostname)
    if ((!secure && !loopback) || address.username || address.password || address.search || address.hash) return null
    return address
  } catch { return null }
}

function signalServer() {
  if (localSignal) return endpoint(localSignal)
  if (config.signalUrl) return endpoint(config.signalUrl)
  if (config.sameOriginSignal && location.protocol === 'https:') return endpoint(`wss://${location.host}`)
  if (local) return endpoint(`ws://${location.host}`)
  return null
}

function error(message = '') {
  $('entry-error').hidden = !message
  $('entry-error').textContent = message
}

function waiting(on) {
  for (const id of ['create', 'join', 'open-demo']) $(id).disabled = on
}

function connect(code) {
  if (pending || active) return
  const address = signalServer()
  if (!address) {
    error('此版本还未配置会议服务。可体验演示，或在连接设置中填入服务地址。')
    return
  }
  if (!window.isSecureContext || !window.RTCPeerConnection) {
    error('会议需要安全环境，请用 HTTPS 页面或 Windows 客户端。')
    return
  }
  error()
  waiting(true)
  const signal = new MeetingSignal({
    address, code, message: handle, status: connectionStatus,
    welcome(incoming, resumed) {
      if (resumed) {
        restoreRoom(active, incoming)
        return
      }
      pending = undefined
      waiting(false)
      openRoom(makeRoom({
        signal, id: incoming.id, code: incoming.code, started: incoming.createdAt, locked: incoming.locked,
        players: new Map(incoming.players.map(player => [player.id, player])), capacity: incoming.capacity, boardFull: incoming.boardFull
      }), incoming.strokes, incoming.chat)
      connectMedia(active, incoming.iceServers)
    },
    failure(message) {
      if (pending === signal) {
        pending = undefined
        waiting(false)
      } else if (active?.signal === signal) {
        $('meeting-code').value = formatCode(active.code)
        exitRoom()
      }
      error(message)
    }
  })
  pending = signal
  signal.start()
}

function connectionStatus(reconnecting) {
  if (!active) return
  $('reconnect-status').hidden = !reconnecting
  $('canvas').dataset.offline = String(reconnecting)
  $('chat-form').querySelector('button').disabled = reconnecting
  $('lock').disabled = $('end-room').disabled = $('clear-board').disabled = reconnecting
}

function connectMedia(room, iceServers) {
  room.rtc = new MeetingMedia({ self: room.id, iceServers, send, remote: receiveTrack, status: peerStatus })
  const media = {}
  for (const kind of Object.keys(mediaLabels)) {
    const track = room.media[kind]?.getTracks()[0]
    media[kind] = track?.readyState === 'live'
    if (media[kind]) void room.rtc.replace(kind, track)
    else room.media[kind] = null
  }
  Object.assign(room.players.get(room.id), media)
  send({ type: 'profile', ...identity })
  send({ type: 'media', ...media })
  for (const person of room.players.values()) room.rtc.add(person.id)
}

function restoreRoom(room, snapshot) {
  room.rtc.close()
  for (const entry of room.incoming.values()) entry.audio?.remove()
  room.incoming.clear()
  room.status.clear()
  room.id = snapshot.id
  room.players = new Map(snapshot.players.map(player => [player.id, player]))
  room.locked = snapshot.locked
  if (room.players.get(room.id)?.mutedByHost) {
    room.media.mic?.getTracks().forEach(track => track.stop())
    room.media.mic = null
  }
  room.strokes = snapshot.strokes
  $('canvas').dataset.full = String(Boolean(snapshot.boardFull))
  board.reset(room.strokes)
  $('chat-list').replaceChildren()
  for (const entry of snapshot.chat) appendChat(entry)
  connectMedia(room, snapshot.iceServers)
  updateControls()
  renderPeople()
  renderScreens()
  toast('已重新连接会议')
}

function handle(message) {
  switch (message.type) {
    case 'player': {
      const wasMuted = active.players.get(message.player.id)?.mutedByHost
      active.players.set(message.player.id, message.player)
      active.rtc.add(message.player.id)
      syncAudio(message.player)
      if (message.player.id === active.id && wasMuted !== message.player.mutedByHost) {
        if (message.player.mutedByHost && active.media.mic) updateMedia(active, 'mic', null)
        if (wasMuted !== undefined) toast(message.player.mutedByHost ? '房主已关闭你的麦克风。' : '房主已允许你自行打开麦克风。')
        updateControls()
      }
      renderPeople()
      renderScreens()
      break
    }
    case 'left':
      active.players.delete(message.id)
      active.rtc.remove(message.id)
      for (const name of Object.keys(mediaLabels)) {
        const entry = active.incoming.get(`${message.id}:${name}`)
        entry?.audio?.remove()
        active.incoming.delete(`${message.id}:${name}`)
      }
      active.status.delete(message.id)
      renderPeople()
      renderScreens()
      break
    case 'signal':
      active.rtc.receive(message.from, message.signal)
      break
    case 'lock':
      active.locked = message.locked
      renderPeople()
      break
    case 'stroke':
      active.strokes.push(message.stroke)
      board.draw(message.stroke)
      break
    case 'clear':
      active.strokes = []
      $('canvas').dataset.full = 'false'
      board.reset()
      break
    case 'board-full':
      $('canvas').dataset.full = 'true'
      board.reset(active.strokes)
      toast('白板已满，可先导出，再由房主清空。')
      break
    case 'chat':
      appendChat(message.entry)
      if ($('chat').hidden) {
        active.chatCount++
        $('chat-count').textContent = active.chatCount
        $('chat-count').hidden = false
      }
      break
  }
}

function openRoom(room, strokes = [], chat = []) {
  active = room
  connectionStatus(false)
  room.strokes = strokes
  $('canvas').dataset.full = String(Boolean(room.boardFull))
  if (!room.demo) history.replaceState(null, '', `#room=${room.code}`)
  $('home').hidden = $('site-header').hidden = true
  $('meeting').hidden = false
  document.body.classList.add('in-room')
  window.scrollTo(0, 0)
  $('room-title').textContent = room.demo ? '深夜自习室 · 演示' : '松间会议'
  $('room-code').textContent = room.demo ? '演示房间' : formatCode(room.code)
  $('copy-code').disabled = room.demo
  $('invite').hidden = room.demo
  $('chat-list').replaceChildren()
  $('chat-input').value = ''
  $('room-side').hidden = false
  $('toggle-side').setAttribute('aria-pressed', 'true')
  for (const entry of chat) appendChat(entry)
  board.reset(strokes)
  changeSide(false)
  changeView(false)
  updateControls()
  renderPeople()
  renderScreens()
  refreshClock()
  clock = setInterval(refreshClock, 1000)
  $('room-title').tabIndex = -1
  $('room-title').focus({ preventScroll: true })
}

function refreshClock() {
  const total = Math.max(0, Math.floor((Date.now() - active.started) / 1000))
  $('room-clock').textContent = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60].map(n => String(n).padStart(2, '0')).join(':')
}

function exitRoom() {
  const room = active
  if (!room) return
  active = undefined
  clearInterval(clock)
  room.rtc?.close()
  room.signal?.stop()
  for (const stream of Object.values(room.media)) stream?.getTracks().forEach(track => track.stop())
  for (const entry of room.incoming.values()) entry.audio?.remove()
  for (const id of ['screen-grid', 'focus-view', 'people-list', 'chat-list']) $(id).replaceChildren()
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close()
  $('meeting').hidden = true
  $('home').hidden = $('site-header').hidden = false
  document.body.classList.remove('in-room')
  history.replaceState(null, '', location.pathname + location.search)
  $('create').focus({ preventScroll: true })
}

function renderPeople() {
  const room = active
  const host = room.players.get(room.id)?.host
  $('people-count').textContent = room.demo ? room.players.size : `${room.players.size}/${room.capacity}`
  $('lock').hidden = !host || room.demo
  $('lock').querySelector('span').textContent = room.locked ? '解锁会议' : '锁定会议'
  $('clear-board').hidden = !host && !room.demo
  avatar($('room-profile'), identity)
  const list = []
  for (const person of room.players.values()) {
    const item = element('li')
    const badge = element('span', 'avatar')
    avatar(badge, person)
    const name = element('span', 'member-name', person.name + (person.id === room.id ? ' (你)' : ''))
    name.title = person.name
    if (person.host) name.append(element('small', '', '房主'))
    else if (person.mutedByHost) name.append(element('small', '', '房主已静音'))
    else if (room.status.get(person.id) === 'failed') name.append(element('small', '', '媒体连接失败'))
    const indicators = element('span', 'member-media')
    for (const [key, label] of [['mic', '麦克风'], ['camera', '摄像头'], ['screen', '屏幕共享']]) {
      const indicator = icon(mediaLabels[key][person[key] ? 3 : 2])
      indicator.classList.toggle('enabled', Boolean(person[key]))
      indicator.title = `${label}${person[key] ? '已开启' : '已关闭'}`
      indicators.append(indicator)
    }
    item.append(badge, name, indicators)
    if (host && person.id !== room.id && !room.demo) {
      const mute = element('button', 'button quiet remove-member mute-member')
      mute.title = person.mutedByHost ? '允许打开麦克风' : '关闭该成员的麦克风'
      mute.setAttribute('aria-label', `${mute.title} · ${person.name}`)
      mute.setAttribute('aria-pressed', String(Boolean(person.mutedByHost)))
      mute.append(icon(person.mutedByHost ? 'mic-off' : 'mic'))
      mute.addEventListener('click', () => send({ type: 'moderate-mic', id: person.id, muted: !person.mutedByHost }))
      const remove = element('button', 'button quiet remove-member')
      remove.title = '移出会议'
      remove.setAttribute('aria-label', `移出 ${person.name}`)
      remove.append(icon('x'))
      remove.addEventListener('click', () => {
        if (window.confirm(`将「${person.name}」移出会议？`)) send({ type: 'remove', id: person.id })
      })
      item.append(mute, remove)
    }
    list.push(item)
  }
  $('people-list').replaceChildren(...list)
}

function peerStatus(id, status) {
  if (!active) return
  active.status.set(id, status)
  renderPeople()
}

function syncAudio(person) {
  const audio = person && active.incoming.get(`${person.id}:mic`)?.audio
  if (audio) audio.muted = !person.mic || Boolean(person.mutedByHost)
}

function receiveTrack(id, type, stream) {
  if (!active) return
  const key = `${id}:${type}`
  if (type === 'mic') {
    active.incoming.get(key)?.audio?.remove()
    const audio = element('audio')
    audio.autoplay = true
    audio.srcObject = stream
    document.body.append(audio)
    active.incoming.set(key, { stream, audio })
    audio.muted = true
    syncAudio(active.players.get(id))
    audio.play().catch(() => {
      // A click after autoplay is blocked also unlocks the meeting's audio tracks.
      document.addEventListener('click', () => audio.play().catch(() => {}), { once: true })
    })
  } else {
    active.incoming.set(key, { stream })
    renderScreens()
  }
}

function buildCard(key, large = false) {
  const button = element('button', 'screen-card')
  const placeholder = element('div', 'screen-placeholder', '正在接收画面…')
  const caption = element('span', 'tile-caption')
  const name = element('span')
  const expand = element('span', 'tile-expand')
  const visual = element('video')
  visual.autoplay = visual.playsInline = visual.muted = true
  expand.append(icon(large ? 'x' : 'expand'))
  caption.append(icon(key.endsWith(':screen') ? 'monitor' : 'video'), name)
  button.append(placeholder, visual, caption, expand)
  button.addEventListener('click', () => {
    active.focus = active.focus === key ? '' : key
    renderScreens()
    if (active.focus) $('focus-view').scrollIntoView({ block: 'nearest' })
  })
  return { button, name, visual, placeholder, large }
}

function fillCard(card, { key, type, person, stream }) {
  const title = `${person.name}的${type === 'screen' ? '屏幕' : '摄像头'}`
  card.name.textContent = title
  card.button.setAttribute('aria-label', card.large || active.focus === key ? `关闭${title}的专注视图` : `聚焦${title}`)
  card.button.classList.toggle('selected', active.focus === key)
  if (active.demo && person.id !== active.id) {
    const mock = document.querySelector(`[data-preview="${person.id}"] > div`)
    if (mock && !card.mock) {
      card.mock = mock.cloneNode(true)
      card.button.prepend(card.mock)
    }
    card.placeholder.hidden = card.visual.hidden = true
    return
  }
  if (card.visual.srcObject !== (stream ?? null)) {
    card.visual.srcObject = stream ?? null
    if (stream) card.visual.play().catch(() => {})
  }
  card.visual.classList.toggle('has-stream', Boolean(stream))
  card.visual.hidden = !stream
  card.placeholder.hidden = Boolean(stream)
}

function renderScreens() {
  const room = active
  const views = []
  for (const type of ['screen', 'camera']) {
    for (const person of room.players.values()) {
      if (!person[type]) continue
      const key = `${person.id}:${type}`
      const stream = person.id === room.id ? room.media[type] : room.incoming.get(key)?.stream
      views.push({ key, type, person, stream })
    }
  }
  const pinned = views.find(view => view.key === room.focus)
  room.focus = pinned?.key ?? ''
  const grid = $('screen-grid')
  for (const [key, card] of room.cards) {
    if (!views.some(view => view.key === key)) {
      card.button.remove()
      card.visual.srcObject = null
      room.cards.delete(key)
    }
  }
  for (const [index, view] of views.entries()) {
    const card = room.cards.get(view.key) ?? buildCard(view.key)
    room.cards.set(view.key, card)
    fillCard(card, view)
    if (grid.children[index] !== card.button) grid.insertBefore(card.button, grid.children[index] ?? null)
  }
  grid.classList.toggle('compact', Boolean(pinned))
  const focus = $('focus-view')
  focus.hidden = !pinned
  if (pinned) {
    if (room.big?.key !== pinned.key) {
      room.big = { ...buildCard(pinned.key, true), key: pinned.key }
      focus.replaceChildren(room.big.button)
    }
    fillCard(room.big, pinned)
  } else if (room.big) {
    room.big = null
    focus.replaceChildren()
  }
  $('empty').hidden = views.length !== 0
  $('screen-count').textContent = `${views.filter(view => view.type === 'screen').length} 路屏幕共享`
}

function changeView(whiteboard) {
  $('screens').hidden = whiteboard
  $('board').hidden = !whiteboard
  $('view-screens').setAttribute('aria-pressed', String(!whiteboard))
  $('view-board').setAttribute('aria-pressed', String(whiteboard))
}

function changeSide(chat) {
  $('chat').hidden = !chat
  $('people').hidden = chat
  $('tab-chat').setAttribute('aria-pressed', String(chat))
  $('tab-people').setAttribute('aria-pressed', String(!chat))
  if (chat) active.chatCount = 0
  $('chat-count').hidden = !active.chatCount
  if (chat) $('chat-list').scrollTop = $('chat-list').scrollHeight
}

function appendChat(entry) {
  const item = element('li')
  const stamp = new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  item.append(element('small', '', `${entry.name} · ${stamp}`), element('p', '', entry.body))
  const list = $('chat-list')
  list.append(item)
  while (list.children.length > 50) list.firstElementChild.remove()
  list.scrollTop = list.scrollHeight
}

const controls = { mic: 'mic', camera: 'camera', screen: 'share' }
function updateControls() {
  for (const [type, id] of Object.entries(controls)) {
    const node = $(id)
    const enabled = Boolean(active.media[type])
    const blocked = type === 'mic' && active.players.get(active.id)?.mutedByHost
    node.setAttribute('aria-pressed', String(enabled))
    node.querySelector('span').textContent = blocked ? '房主已静音' : mediaLabels[type][enabled ? 1 : 0]
    setIcon(node.querySelector('i'), mediaLabels[type][enabled ? 3 : 2])
    node.disabled = active.busy.has(type) || Boolean(blocked)
  }
  $('empty-share').disabled = active.busy.has('screen')
}

function updateMedia(room, type, stream) {
  const previous = room.media[type]
  room.media[type] = stream
  previous?.getTracks().forEach(track => track.stop())
  const track = stream?.getTracks()[0] ?? null
  track?.addEventListener('ended', () => {
    if (active === room && room.media[type] === stream) updateMedia(room, type, null)
  }, { once: true })
  if (room.demo) Object.assign(room.players.get(room.id), { [type]: Boolean(stream) })
  else {
    Object.assign(room.players.get(room.id), { [type]: Boolean(stream) })
    void room.rtc.replace(type, track)
    send({ type: 'media', [type]: Boolean(stream) })
  }
  updateControls()
  renderPeople()
  renderScreens()
}

async function toggleMedia(type) {
  const room = active
  if (!room || room.busy.has(type) || (type === 'mic' && room.players.get(room.id)?.mutedByHost)) return
  if (room.demo) {
    toast('演示使用示例画面。进入真实会议后可使用设备。')
    return
  }
  if (room.media[type]) {
    updateMedia(room, type, null)
    return
  }
  room.busy.add(type)
  updateControls()
  try {
    const devices = navigator.mediaDevices
    if (!devices) throw new DOMException('Unavailable', 'NotSupportedError')
    let stream
    if (type === 'screen') {
      if (typeof devices.getDisplayMedia !== 'function') throw new DOMException('Unavailable', 'NotSupportedError')
      stream = await devices.getDisplayMedia({ video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 12, max: 18 } }, audio: false })
    } else {
      stream = await devices.getUserMedia(type === 'mic' ? { audio: { echoCancellation: true, noiseSuppression: true } } :
        { video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 25 } } })
    }
    if (active !== room || (type === 'mic' && room.players.get(room.id)?.mutedByHost)) {
      stream.getTracks().forEach(track => track.stop())
      return
    }
    updateMedia(room, type, stream)
  } catch (failure) {
    if (active === room && failure.name !== 'AbortError') {
      toast(failure.name === 'NotAllowedError' ? '设备权限未授予，或已取消选择。' :
        failure.name === 'NotSupportedError' ? '此设备或浏览器暂不支持该功能。' : '无法开启设备，请检查系统权限和设备占用。')
    }
  } finally {
    room.busy.delete(type)
    if (active === room) updateControls()
  }
}

function showDemo(tile = '') {
  if (active || pending) return
  const self = { id: 'self', ...identity }
  openRoom(makeRoom({ id: self.id, demo: true, focus: tile ? `${tile}:screen` : '',
    players: new Map([...sample, self].map(person => [person.id, { ...person }]))
  }))
}

function showProfile() {
  draft = { ...identity }
  $('display-name').value = draft.name
  $('avatar-file').value = ''
  refreshDraft()
  $('profile-dialog').showModal()
}

function refreshDraft() {
  avatar($('avatar-preview'), { ...draft, name: $('display-name').value })
  for (const button of $('tones').children) button.setAttribute('aria-pressed', String(Number(button.dataset.tone) === draft.tone))
}

async function jpegAvatar(file) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 6 * 1024 * 1024) throw new Error('invalid file')
  const image = await createImageBitmap(file)
  try {
    const canvas = element('canvas')
    const side = Math.min(image.width, image.height)
    if (image.width * image.height > 24_000_000) throw new Error('image too large')
    for (const size of [96, 72, 48]) {
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#e8e1fb'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size)
      const url = canvas.toDataURL('image/jpeg', .72)
      if (url.length <= 7500) return url
    }
    throw new Error('image too large')
  } finally { image.close() }
}

function invitation() {
  const room = active
  if (room.demo) return ''
  const address = signalServer()
  const fallback = address?.protocol === 'ws:' && desktop ? `http://${address.host}/` : (!desktop ? location.href : '')
  const localHttps = address?.protocol === 'wss:' &&
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)[\d.]+$/.test(address.hostname) ? `https://${address.host}/` : ''
  const base = address?.protocol === 'ws:' ? fallback : localHttps || config.webUrl || fallback
  if (!base) return ''
  const url = new URL(base)
  url.hash = `room=${room.code}`
  return url.href
}

async function copy(text, message, fallback) {
  try {
    await navigator.clipboard.writeText(text)
    toast(message)
  } catch {
    const field = $(fallback)
    if (field) { field.hidden = false; field.value = text; field.select() }
    toast('无法访问剪贴板，可手动复制。')
  }
}

for (const node of document.querySelectorAll('i[data-i]')) setIcon(node, node.dataset.i)
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close())
for (const [tone, label] of ['紫色', '绿色', '珊瑚色', '蓝色', '粉色', '灰色'].entries()) {
  const button = element('button', 'tone')
  button.type = 'button'
  button.dataset.tone = tone
  button.setAttribute('aria-label', label)
  button.addEventListener('click', () => { draft.tone = tone; draft.avatar = ''; refreshDraft() })
  $('tones').append(button)
}
avatar($('profile'), identity)
for (const id of ['profile', 'room-profile']) $(id).addEventListener('click', showProfile)
$('display-name').addEventListener('input', refreshDraft)
$('avatar-reset').addEventListener('click', () => { draft.avatar = ''; $('avatar-file').value = ''; refreshDraft() })
$('avatar-file').addEventListener('change', async () => {
  const file = $('avatar-file').files[0]
  const editing = draft
  if (!file) return
  try {
    const normalized = await jpegAvatar(file)
    if (editing !== draft || !$('profile-dialog').open || $('avatar-file').files[0] !== file) return
    draft.avatar = normalized
    refreshDraft()
  } catch { toast('请选择不超过 6 MB 的常见图片格式。') }
})
$('profile-form').addEventListener('submit', event => {
  event.preventDefault()
  draft.name = $('display-name').value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim() || '访客'
  identity = { ...draft }
  store('study-profile', identity)
  avatar($('profile'), identity)
  if (active) {
    avatar($('room-profile'), identity)
    send({ type: 'profile', ...identity })
  }
  $('profile-dialog').close()
  toast('个人资料已保存')
})

$('show-network').addEventListener('click', () => {
  $('signal-url').value = localSignal
  $('signal-url').placeholder = config.signalUrl || (local ? `ws://${location.host}` : 'wss://你的会议服务')
  $('network-error').hidden = true
  $('network-dialog').showModal()
})
$('network-form').addEventListener('submit', event => {
  event.preventDefault()
  const value = $('signal-url').value.trim()
  const address = value && endpoint(value)
  if (value && !address) {
    $('network-error').textContent = '请输入有效的 WSS 地址或本机 WS 地址。'
    $('network-error').hidden = false
    return
  }
  localSignal = address ? address.href : ''
  store('study-signal', localSignal)
  $('network-dialog').close()
  error()
})
$('create').addEventListener('click', () => connect(''))
$('join-form').addEventListener('submit', event => {
  event.preventDefault()
  const code = normalizeCode($('meeting-code').value)
  if (!code) { error('请输入有效的 16 位会议码或松间邀请链接。'); return }
  connect(code)
})
$('open-demo').addEventListener('click', () => showDemo())
for (const button of document.querySelectorAll('[data-preview]')) button.addEventListener('click', () => showDemo(button.dataset.preview))
function loadInvitation() {
  if (active) return
  const linkedCode = normalizeCode(new URLSearchParams(location.hash.slice(1)).get('room') ?? '')
  if (linkedCode) {
    $('meeting-code').value = formatCode(linkedCode)
    $('join').focus({ preventScroll: true })
  }
}
loadInvitation()
window.addEventListener('hashchange', loadInvitation)
if (location.pathname.startsWith('/toolbox/')) {
  $('toolbox').hidden = false
  $('back-to-tools').hidden = false
}
if (!desktop && config.desktopUrl) {
  $('download').href = config.desktopUrl
  $('download').hidden = false
}

$('view-screens').addEventListener('click', () => changeView(false))
$('view-board').addEventListener('click', () => changeView(true))
$('tab-people').addEventListener('click', () => changeSide(false))
$('tab-chat').addEventListener('click', () => changeSide(true))
$('toggle-side').addEventListener('click', () => {
  $('room-side').hidden = !$('room-side').hidden
  $('toggle-side').setAttribute('aria-pressed', String(!$('room-side').hidden))
})
$('chat-form').addEventListener('submit', event => {
  event.preventDefault()
  const field = $('chat-input')
  const body = field.value.trim()
  if (!body || Date.now() - (active.lastChatAt ?? 0) < 600) return
  if (!send({ type: 'chat', body })) return
  active.lastChatAt = Date.now()
  field.value = ''
})
$('lock').addEventListener('click', () => send({ type: 'lock', locked: !active.locked }))
for (const [type, id] of Object.entries(controls)) $(id).addEventListener('click', () => void toggleMedia(type))
$('empty-share').addEventListener('click', () => void toggleMedia('screen'))
$('invite').addEventListener('click', () => {
  $('invite-code').textContent = formatCode(active.code)
  $('invite-url').hidden = true
  $('copy-link').disabled = !invitation()
  $('invite-dialog').showModal()
})
$('copy-link').addEventListener('click', () => void copy(invitation(), '邀请链接已复制', 'invite-url'))
$('copy-invite-code').addEventListener('click', () => void copy(formatCode(active.code), '会议码已复制', 'invite-url'))
$('copy-code').addEventListener('click', () => void copy(formatCode(active.code), '会议码已复制'))
$('leave').addEventListener('click', () => {
  if (active.demo) { exitRoom(); return }
  $('end-room').hidden = !active.players.get(active.id)?.host
  $('leave-dialog').showModal()
})
$('leave-room').addEventListener('click', exitRoom)
$('end-room').addEventListener('click', () => {
  send({ type: 'end' })
  exitRoom()
})
window.addEventListener('pagehide', () => {
  pending?.stop()
  active?.signal?.stop()
})

if (desktop) {
  let sourceToken
  desktop.onSources(({ token, sources }) => {
    if (!active || !sources.length) { desktop.chooseSource(token, ''); return }
    const buttons = sources.map(source => {
      const button = element('button', 'source-option')
      const image = new Image()
      image.alt = ''
      image.src = source.thumbnail
      button.append(image, element('span', '', source.name))
      button.title = source.name
      button.addEventListener('click', () => {
        desktop.chooseSource(token, source.id)
        sourceToken = undefined
        $('source-dialog').close()
      })
      return button
    })
    $('source-list').replaceChildren(...buttons)
    sourceToken = token
    if (!$('source-dialog').open) $('source-dialog').showModal()
  })
  $('source-dialog').addEventListener('close', () => {
    if (sourceToken) desktop.chooseSource(sourceToken, '')
    sourceToken = undefined
    $('source-list').replaceChildren()
  })
}
