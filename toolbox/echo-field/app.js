import {escape as e, normalized as norm, clock, safeLink, localDay, dayOffset, parseTimed, pairTimed, wordScore} from './core.js'

const $ = id => document.getElementById(id)
const page = $('page'), audio = $('audio'), modal = $('modal')
const native = window.EchoAndroid, storageKey = 'echo-field.v1'
const levels = {'4':'CET-4', '6':'CET-6', '65':'雅思 6.5'}
const icons = {
  home:'<path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/>',
  library:'<path d="M3 14v-2a9 9 0 0 1 18 0v2M3 13h4v7H5a2 2 0 0 1-2-2zm18 0h-4v7h2a2 2 0 0 0 2-2z"/>',
  practice:'<path d="m12 3 2 6 6 3-6 2-2 7-2-7-6-2 6-3zm7 13 1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>',
  books:'<path d="M5 4h13v16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 13h13M8 8h6"/>',
  plan:'<path d="M5 5h14v15H5zm0 5h14M9 3v4m6-4v4m-6 8 2 2 4-4"/>',
  search:'<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  play:'<path d="m8 5 12 7-12 7z" fill="currentColor"/>',
  pause:'<path d="M8 5v14m8-14v14" stroke-width="3"/>',
  back:'<path d="M4 10a8 8 0 1 1 1 7M4 5v5h5"/>',
  forward:'<path d="M20 10a8 8 0 1 0-1 7m1-12v5h-5"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  food:'<path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18m12-18c-3 2-4 5-4 9h4m0-9v18"/>',
  travel:'<path d="m2 12 20-9-8 19-3-9zM11 13 22 3"/>',
  news:'<path d="M7 4h13v16H5a2 2 0 0 1-2-2V8h4v9m3-9h7m-7 4h7m-7 4h5"/>',
  tech:'<path d="M7 7h10v10H7zM10 10h4v4h-4zm-1-6v3m6-3v3M4 9h3m-3 6h3m10-6h3m-3 6h3M9 17v3m6-3v3"/>',
  history:'<path d="m3 8 9-5 9 5H3zm1 12h16M7 10v7m5-7v7m5-7v7"/>',
  film:'<path d="M3 9h18v11H3zm0 0 16-6 2 5M8 7l3 2m3-4 3 3m-7 5 5 2-5 2z"/>'
}
const icon = name => '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24">' + icons[name] + '</svg>'
const navigation = [['home','首页'],['library','听力馆'],['practice','练习场'],['books','生词本'],['plan','学习计划']]
const defaults = () => ({
  level:'4', mode:'both', font:22, rate:1, goal:12, remind:'', minor:true,
  library:{cat:'all', kind:'all', level:'all', show:36}, history:{}, marks:{}, favorites:{}, events:{}, wins:{},
  books:[{id:'words', name:'我的生词', items:[]}, {id:'phrases', name:'常用短语', items:[]}], last:''
})
function readState() {
  try { return {...defaults(), ...JSON.parse(localStorage.getItem(storageKey) || '{}')} } catch { return defaults() }
}
let s = readState()
let sources = {}, lessons = [], episodes = [], feedDates = {}, ready = false, search = ''
const index = new Map(), localMaterials = new Map(), attachments = new Map(), dictionaries = new Map()
let current = null, cues = [], active = -1, loop = false, follow = true, transcriptLabel = ''
let started = 0, lastMediaTime = 0, checkpoint = 0, pendingTime = 0, resumeAt = 0, mediaGeneration = 0
let bookId = s.books[0]?.id || '', flashIndex = 0, reveal = false
let challenge = null, result = null, recorder = null, recognition = null, recording = '', recordingStatus = '', recordingGeneration = 0
const external = ' target="_blank" rel="noopener noreferrer"'
function signal(ms = 12000) {
  if (AbortSignal.timeout) return AbortSignal.timeout(ms)
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}
const json = (path, timeout = 12000) => fetch(path, {signal:signal(timeout)}).then(response => {
  if (!response.ok) throw Error('读取失败')
  return response.json()
})
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(s)) } catch { toast('本机存储空间不足，当前改动可能无法保存。') }
}
let toastTimer = 0
function toast(message) {
  $('toast').textContent = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { $('toast').textContent = '' }, 4800)
}
const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)
const route = () => location.hash.slice(1).split('/')
function key() { try { return decodeURIComponent(route()[1] || '') } catch { return '' } }
function go(view, arg) {
  const target = '#' + view + (arg ? '/' + encodeURIComponent(arg) : '')
  if (location.hash === target) render()
  else location.hash = target
}
const today = () => s.events[localDay()] || {seconds:0, xp:0, attempts:0}
function record(seconds = 0, points = 0, attempts = 0, unique) {
  if (unique && s.wins[unique]) points = 0
  else if (unique && points) s.wins[unique] = true
  const d = today()
  s.events[localDay()] = {seconds:d.seconds + seconds, xp:d.xp + points, attempts:d.attempts + attempts}
  persist()
}
function streak() {
  let i = today().seconds || today().attempts ? 0 : 1
  let count = 0
  while (s.events[dayOffset(-i)]?.seconds || s.events[dayOffset(-i)]?.attempts) { count++; i++ }
  return count
}
const xp = () => Object.values(s.events).reduce((sum, day) => sum + day.xp, 0)
const rank = () => xp() >= 700 ? '远航者' : xp() >= 350 ? '领航员' : xp() >= 120 ? '采声者' : '初听者'
const art = cat => '<span class="art" data-cat="' + e(cat) + '">' + icon(icons[cat] ? cat : 'library') + '</span>'
const btn = (label, action, classes = '', extra = '') => '<button class="btn ' + classes + '" data-action="' + action + '" ' + extra + '>' + label + '</button>'
const goBtn = (label, view, classes = '', arg = '') => '<button class="btn ' + classes + '" data-go="' + view + '" data-key="' + e(arg) + '">' + label + '</button>'
const option = (key, title, at) => '<option value="' + e(key) + '"' + (String(at) === String(key) ? ' selected' : '') + '>' + e(title) + '</option>'
const select = (field, label, options, current) => '<label class="field">' + label + '<select id="' + field + '">' + options.map(([k,v]) => option(k,v,current)).join('') + '</select></label>'
const heading = (title, sub = '', actions = '') => '<div class="headrow"><div><h1 class="page-title">' + title + '</h1>' + (sub ? '<p class="page-sub">' + sub + '</p>' : '') + '</div>' + actions + '</div>'
const allItems = () => [...lessons, ...episodes.filter(item => !s.minor || !item.explicit), ...localMaterials.values()]
const grade = item => item.level ? levels[item.level] : item.kind === 'local' ? '已导入' : '原速播客'
const type = item => item.kind === 'lesson' ? '双语字幕' : item.kind === 'local' ? (item.cues?.length ? '本地字幕' : '本地音频') : item.tracks?.length ? '节目字幕' : '公开播客'
const episodeCard = item => '<button class="card episode" data-go="episode" data-key="' + e(item.id) + '"><span class="ep-top">' + art(item.cat) + '<span class="tag">' + type(item) + '</span></span><span class="ep-title" lang="' + (item.zh ? 'zh' : 'en') + '">' + e(item.zh || item.title) + '</span><small>' + e(item.zh ? item.title : item.source) + ' · ' + e(item.kind === 'lesson' ? grade(item) : item.duration ? clock(item.duration) : '音频') + '</small></button>'
function home() {
  const next = index.get(s.last) || lessons.find(item => item.cat === 'food' && item.level === s.level) || lessons[0]
  const mins = Math.floor(today().seconds / 60)
  return '<div class="dashboard"><section class="hero"><span class="eyebrow">ECHO FIELD · 英语听力</span><h1>让英语落进<br>日常的声音里。</h1><p>从一句听得懂的英语开始。听完整段，也可以停下来，一句一句练。</p>' +
    (next ? goBtn(icon('play') + (s.last && index.has(s.last) ? '继续收听' : '开始第一课'), 'episode', 'gold', next.id) : goBtn('进入听力馆','library','gold')) +
    '</section><section class="panel goal"><div class="goal-head"><h2>今日学习</h2>' + icon('plan') + '</div><div class="goal-numbers"><strong>' + mins + '</strong> / ' + s.goal + ' 分钟</div><progress aria-label="今日听力进度" max="' + s.goal + '" value="' + Math.min(mins,s.goal) + '"></progress><div class="goaltile">' + icon('practice') + '<span><strong>' + streak() + '</strong> 天连续学习 · <strong>' + xp() + '</strong> XP</span></div>' + goBtn('查看学习计划','plan','outline') + '</section></div>' +
    '<section><div class="section-heading"><div><h2>按主题听</h2><p class="section-sub">找到你愿意反复听的内容</p></div><button class="text-btn" data-action="all-library">全部资源</button></div><div class="categories">' +
    Object.entries(sources).map(([cat, source]) => '<button class="card category" data-action="category" data-key="' + cat + '">' + art(cat) + '<span><strong>' + e(source[0]) + '</strong><small>' + allItems().filter(item => item.cat === cat).length + ' 集</small></span></button>').join('') +
    '</div></section><section><div class="section-heading"><div><h2>先听这几课</h2><p class="section-sub">' + e(levels[s.level]) + ' · 双语逐句精听</p></div><button class="text-btn" data-action="lesson-library">全部精听课</button></div><div class="episode-grid">' +
    lessons.filter(item => item.level === s.level).map(episodeCard).join('') + '</div></section>'
}
function library() {
  const f = s.library, needle = search.trim().toLowerCase(), source = sources[f.cat]
  const available = allItems().filter(item =>
    (f.cat === 'all' || item.cat === f.cat) &&
    (f.kind === 'all' || (f.kind === 'fav' ? s.favorites[item.id] : f.kind === 'cc' ? item.cues?.length || item.tracks?.length || attachments.has(item.id) : item.kind === f.kind)) &&
    (f.level === 'all' || item.level === f.level) &&
    (!needle || [item.title,item.zh,item.source,sources[item.cat]?.[0],item.date].some(x => String(x || '').toLowerCase().includes(needle))))
  libraryQueue = available.map(item => item.id)
  return heading('听力馆', e(source ? source[2] + ' · ' + source[3] : '双语精听课、完整节目和本地导入'), btn('导入音频','import-material','outline')) +
    '<div class="filters"><select id="filter-cat" aria-label="主题">' + option('all','全部主题',f.cat) + Object.entries(sources).map(([k,v])=>option(k,v[0],f.cat)).join('') + '</select><select id="filter-kind" aria-label="资源类型">' +
    [['all','全部资源'],['lesson','双语精听课'],['cc','带时间轴字幕'],['podcast','公开播客'],['fav','收藏'],['local','本地导入']].map(([k,v])=>option(k,v,f.kind)).join('') +
    '</select><select id="filter-level" aria-label="难度">' + option('all','全部难度',f.level) + Object.entries(levels).map(([k,v])=>option(k,v,f.level)).join('') + '</select>' +
    (source ? '<a class="btn outline" href="' + safeLink(source[5]) + '"' + external + '>节目官网</a>' : '') + '<span class="btn quiet">' + available.length + ' 集</span></div>' +
    (available.length ? '<div class="episode-grid">' + available.slice(0, f.show).map(episodeCard).join('') + '</div>' +
      (available.length > f.show ? '<div class="section-heading">' + btn('显示更多','more','outline') + '</div>' : '') : '<p class="empty">没有匹配的资源。可以调整筛选条件。</p>')
}
let queue = [], sleepUntil = 0, sleepEnd = false, sleepClock = 0
const playModes = [['sequence','顺序播放'],['list','列表循环'],['one','单曲循环'],['stop','播完停止']]
const savedWord = word => s.books.some(book => book.items.some(item => norm(item.en) === norm(word)))
function cueRow(cue, i) {
  const marked = Boolean(s.marks[current.id + ':' + i])
  const words = Object.keys(current.vocab || {}).flatMap(phrase => norm(phrase).split(' '))
  const tokens = cue.en.split(/([a-zA-Z]+(?:['’\-][a-zA-Z]+)*)/g).map((word, n) =>
    n % 2 ? '<button class="word' + (words.includes(norm(word)) ? ' key' : '') + (savedWord(word) ? ' saved' : '') + '" data-action="word" data-word="' + e(word) + '" data-cue="' + i + '">' + e(word) + '</button>' : e(word)).join('')
  return '<div class="cue' + (marked ? ' marked' : '') + '" id="cue-' + i + '" style="--subtitle-size:' + Number(s.font) + 'px"><button class="timestamp" data-action="seek-cue" data-index="' + i + '">' + clock(cue.start) + '</button><div>' +
    (s.mode !== 'zh' && cue.en ? '<p class="english" lang="en">' + tokens + '</p>' : '') +
    (s.mode !== 'en' && cue.zh ? '<p class="zh">' + e(cue.zh) + '</p>' : '') +
    (s.mode === 'zh' && !cue.zh ? '<p class="zh">此句暂无中文字幕</p>' : '') + '</div></div>'
}
function detail(item) {
  if (!item) return heading('找不到这集') + goBtn('返回听力馆','library','primary')
  const favorite = Boolean(s.favorites[item.id]), sourcePage = safeLink(item.url)
  const tracks = (item.tracks || []).filter(track => safeLink(track.url))
  const trackInfo = item.kind === 'lesson' ? '原创双语稿 · Kokoro 合成朗读 · 逐句按音频切分' : transcriptLabel || '连接节目方的原始音频。字幕以节目公开信息为准。'
  const subtitleBox = s.mode === 'off' ? '<p class="notice">字幕已关闭。可继续盲听或打开字幕。</p>' :
    cues.length ? '<div id="transcript" class="transcript" aria-label="逐句字幕">' + cues.map(cueRow).join('') + '</div>' :
    '<p class="notice">' + e(transcriptLabel || (tracks.length ? '正在读取节目字幕…' : '这集暂无时间轴字幕。支持导入本地 SRT 或 VTT。')) + '</p>'
  return '<div class="detail-head">' + art(item.cat) + '<div><h1 class="page-title">' + e(item.zh || item.title) + '</h1><div class="detail-meta"><span>' + e(item.zh ? item.title : item.source) + '</span><span class="tag">' + e(grade(item)) + '</span>' + (item.date ? '<time>' + e(item.date) + '</time>' : '') + '</div></div></div>' +
    '<div class="detail-body"><section class="panel"><div class="section-heading" style="margin-top:0"><h2>逐句精听</h2>' + btn(favorite ? '已收藏' : '收藏','favorite','outline','aria-pressed="' + favorite + '"') + '</div>' +
    '<div class="actions">' + btn(icon(audio.paused ? 'play' : 'pause') + '<span>' + (audio.paused ? '播放' : '暂停') + '</span>', 'toggle','primary','id="detail-play"') +
    (sourcePage ? '<a class="btn outline" href="' + sourcePage + '"' + external + '>原站节目</a>' : '') +
    (safeLink(item.transcript) ? '<a class="btn outline" href="' + safeLink(item.transcript) + '"' + external + '>原站英文文稿</a>' : '') +
    (item.kind !== 'lesson' ? btn('导入字幕','attach','outline') : '') +
    '</div><div class="player-tools">' +
    select('sub-mode','字幕',[['both','中英双语'],['en','仅英语'],['zh','仅中文'],['off','关闭字幕']],s.mode) +
    select('speed','速度',[.5,.65,.75,.85,1,1.1,1.25,1.5,1.75,2].map(n=>[n,n+'×']),s.rate) +
    select('subtitle-size','字号',[16,19,22,26,30,36].map(n=>[n,n+' px']),s.font) +
    (cues.length ? btn(loop ? '单句循环已开' : '单句循环','loop','outline','aria-pressed="' + loop + '"') + btn('高亮本句','mark','outline') +
      '<label class="field">跟随播放 <input id="follow" type="checkbox" ' + (follow ? 'checked' : '') + '></label>' : '') +
    '</div>' + subtitleBox + '</section><aside class="stack">' +
    '<section class="panel stack"><h2>播放方式</h2><div class="player-tools playback">' + select('play-mode','队列',playModes,s.playMode || 'sequence') +
    btn('定时停止','sleep','outline') + '</div><p class="muted" id="playback-status">' + e(playbackStatus()) + '</p><div class="actions">' +
    btn('上一集','previous','outline') + btn('下一集','next','outline') + '</div></section>' +
    '<section class="panel stack"><h2>跟读与听写</h2><p class="muted">先听原音，再录下自己的版本。语音识别可用时给出词句匹配分。</p>' +
    btn('练习当前句','practice-current','outline',cues.some(c=>c.en) ? '' : 'disabled') + '</section>' +
    '<section class="panel stack"><h2>字幕来源</h2><p class="muted">' + e(trackInfo) + '</p>' +
    tracks.map(track => '<a class="text-btn" href="' + safeLink(track.url) + '"' + external + '>' + e(track.lang) + ' 原站字幕文件</a>').join('') + '</section></aside></div>'
}
function playbackStatus() {
  const position = queue.indexOf(current?.id)
  const status = position >= 0 ? '播放列表 ' + (position + 1) + ' / ' + queue.length : '当前节目'
  return status + (sleepEnd ? ' · 本集结束时暂停' : sleepUntil ? ' · 剩余 ' + clock(Math.ceil((sleepUntil - Date.now()) / 1000)) : '')
}
function checkSleep() {
  if (sleepUntil && Date.now() >= sleepUntil) {
    sleepUntil = 0
    audio.pause()
    flushProgress()
    clearInterval(sleepClock)
    toast('定时结束，已暂停播放。')
    updateDock()
    if (native) native.clearSleep()
  }
  if ($('playback-status')) $('playback-status').textContent = playbackStatus()
}
window.echoSleepExpired = () => { if (sleepUntil) { sleepUntil = Date.now(); checkSleep() } }
function setSleep(minutes) {
  sleepUntil = Number(minutes) > 0 ? Date.now() + Number(minutes) * 60000 : 0
  sleepEnd = minutes === 'end'
  clearInterval(sleepClock)
  if (native) { if (sleepUntil) native.setSleep(Number(minutes)); else native.clearSleep() }
  if (sleepUntil) sleepClock = setInterval(checkSleep, 1000)
  checkSleep()
  updateDock()
}
function moveEpisode(step, manual = false) {
  if (!current || !queue.length) return
  const at = queue.indexOf(current.id)
  const position = at + step
  if (!manual && s.playMode !== 'list' && (position < 0 || position >= queue.length)) return
  const next = index.get(queue[(position + queue.length) % queue.length])
  if (!next) return
  if (next.id === current.id) { seekTo(0); playAudio(); return }
  selectEpisode(next, true)
  go('episode', next.id)
  playAudio()
}
function updateCues(force = false) {
  const old = active
  if (loop && active >= 0 && audio.currentTime >= cues[active]?.end && !audio.paused) audio.currentTime = cues[active].start
  let left = 0, right = cues.length
  while (left < right) {
    const middle = (left + right) >> 1
    if (cues[middle].start <= audio.currentTime + .025) left = middle + 1
    else right = middle
  }
  active = Math.max(0,left - 1)
  if (active === old && !force) return
  $('cue-' + old)?.classList.remove('active')
  const line = $('cue-' + active), box = $('transcript')
  if (!line) return
  line.classList.add('active')
  if (follow && box.scrollHeight > box.clientHeight) box.scrollTop += line.getBoundingClientRect().top - box.getBoundingClientRect().top - 26
}
function updateDock() {
  if (!current) return
  $('dock').hidden = false
  $('dock-art').dataset.cat = current.cat
  $('dock-art').innerHTML = icon(icons[current.cat] ? current.cat : 'library')
  $('dock-name').textContent = current.zh || current.title
  $('dock-source').textContent = current.source + (sleepUntil || sleepEnd ? ' · 定时已开' : '')
  const symbol = icon(audio.paused ? 'play' : 'pause')
  $('dock-controls').innerHTML = btn(icon('back'),'skip','outline','data-step="-10" aria-label="后退十秒"') +
    btn(symbol,'toggle','primary', 'aria-label="' + (audio.paused ? '播放' : '暂停') + '"') +
    btn(icon('forward'),'skip','outline','data-step="10" aria-label="前进十秒"') + btn('定时','sleep','outline','aria-label="定时停止"')
  if ($('detail-play')) $('detail-play').innerHTML = symbol + '<span>' + (audio.paused ? '播放' : '暂停') + '</span>'
}
function selectEpisode(item, fromStart = false) {
  if (!item || current?.id === item.id) return
  flushProgress()
  audio.pause()
  current = item
  lastMediaTime = started = checkpoint = 0
  resumeAt = fromStart ? 0 : s.history[item.id]?.time || 0
  const attached = attachments.get(item.id)
  cues = attached?.cues || item.cues || []
  transcriptLabel = attached?.label || ''
  active = -1
  loop = false
  if (!queue.includes(item.id)) queue = allItems().filter(ep => ep.kind === item.kind && (item.kind === 'lesson' ? ep.level === item.level : ep.source === item.source)).map(ep => ep.id)
  audio.src = item.audio
  audio.playbackRate = s.rate
  s.last = item.id
  persist()
  updateDock()
  const generation = ++mediaGeneration
  if (!cues.length && item.tracks?.length) loadTracks(item).then(track => {
    if (generation !== mediaGeneration || attachments.has(item.id)) return
    cues = track
    transcriptLabel = track.length ? '节目方提供的时间轴字幕' : '节目字幕暂时不可读取。可打开原站字幕文件或导入字幕。'
    if (track.length) attachments.set(item.id,{cues, label:transcriptLabel})
    if (route()[0] === 'episode') render()
  })
}
async function loadTracks(item) {
  const timed = item.tracks.filter(track => /vtt|srt|subrip/i.test(track.type + track.url))
  const en = timed.find(track => /^en/i.test(track.lang)) || timed.find(track => !/^zh/i.test(track.lang))
  const zh = timed.find(track => /^zh/i.test(track.lang))
  const read = async (track, lang) => {
    if (!track || !safeLink(track.url)) return []
    try {
      const r = await fetch(track.url, {signal:signal(8500)})
      return r.ok ? parseTimed(await r.text(),lang) : []
    } catch { return [] }
  }
  return pairTimed(...await Promise.all([read(en,'en'),read(zh,'zh')]))
}
function seekTo(time) {
  if (!current) return
  audio.currentTime = Math.max(0,Math.min(Number.isFinite(audio.duration) ? audio.duration : Infinity,time))
  updateCues(true)
}
function playAudio() {
  if (!current) return
  checkSleep()
  if (audio.error) audio.load()
  audio.play().catch(() => toast('这集暂时无法播放。请重试，或打开原站节目。'))
}
function flushProgress() {
  if (!current || audio.readyState < 1) return
  s.history[current.id] = {time:audio.ended ? 0 : audio.currentTime,touched:Date.now()}
  const sec = Math.floor(pendingTime)
  pendingTime -= sec
  if (sec) record(sec)
  else persist()
}
audio.addEventListener('loadedmetadata', () => {
  if (resumeAt && audio.duration > resumeAt + 2) seekTo(resumeAt)
  resumeAt = 0
  audio.playbackRate = s.rate
  tick()
})
function tick() {
  const duration = Number.isFinite(audio.duration) ? audio.duration : current?.duration || 0
  $('played').textContent = clock(audio.currentTime)
  $('duration').textContent = clock(duration)
  if (document.activeElement !== $('seek')) $('seek').value = duration ? Math.min(100,100 * audio.currentTime / duration) : 0
  const now = performance.now(), diff = (now - started) / 1000
  if (started && diff < 4 && !audio.seeking && audio.currentTime > lastMediaTime && audio.currentTime - lastMediaTime < 9) pendingTime += diff
  started = audio.paused || audio.seeking ? 0 : now
  lastMediaTime = audio.currentTime
  if (now - checkpoint > 7000) { flushProgress(); checkpoint = now }
  if (cues.length) updateCues()
  if (sleepUntil) checkSleep()
}
audio.addEventListener('timeupdate',tick)
audio.addEventListener('play', () => { started = performance.now(); lastMediaTime = audio.currentTime; updateDock() })
audio.addEventListener('pause', () => { started = 0; flushProgress(); updateDock() })
audio.addEventListener('seeking', () => { started = 0 })
audio.addEventListener('ended', () => {
  flushProgress()
  updateDock()
  if (current?.kind === 'lesson') record(0,15,0,'listen:' + current.id)
  if (sleepEnd) { setSleep('off'); toast('本集播完，已停止。'); return }
  if (s.playMode === 'one' || loop) { seekTo(loop ? cues[active]?.start || 0 : 0); playAudio(); return }
  if (s.playMode !== 'stop') moveEpisode(1)
})
audio.addEventListener('error', () => current && toast('音频源暂时不可用，请稍后重试。'))
$('seek').addEventListener('input', () => { if (Number.isFinite(audio.duration)) seekTo(Number($('seek').value) * audio.duration / 100) })
window.addEventListener('pagehide', flushProgress)
document.addEventListener('visibilitychange', () => { if (document.hidden) flushProgress(); else checkSleep() })
let dbPromise
function materialsDB() {
  if (!dbPromise) dbPromise = new Promise((resolve,reject) => {
    const request = indexedDB.open('echo-field-materials',1)
    request.onupgradeneeded = () => request.result.createObjectStore('materials',{keyPath:'id'})
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}
async function materialTransaction(mode, callback) {
  const db = await materialsDB()
  return new Promise((resolve,reject) => {
    const tx = db.transaction('materials',mode)
    const request = callback(tx.objectStore('materials'))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
}
function ingestMaterial(data) {
  if (data.blob) {
    const added = {...data, audio:URL.createObjectURL(data.blob)}
    delete added.blob
    localMaterials.set(added.id,added)
    index.set(added.id,added)
  } else attachments.set(data.id,data)
}
function message(title, content) {
  $('modal-body').innerHTML = '<div class="modal-header"><h2 id="modal-title">' + title + '</h2>' + btn(icon('close'),'close','quiet','aria-label="关闭"') + '</div>' + content
  if (!modal.open) modal.showModal()
}
function form(contents, label, submitId) {
  return '<form class="fields" id="' + submitId + '">' + contents + '<button class="btn primary" type="submit">' + label + '</button></form>'
}
const field = (label, name, value = '', required = false) => '<label class="field">' + label + '<input maxlength="250" name="' + name + '" value="' + e(value) + '"' + (required ? ' required' : '') + '></label>'
function fileForm(attach) {
  message(attach ? '导入时间轴字幕' : '导入自己的音频', form(
    (!attach ? field('标题（可选）','title') + '<label class="field">音频文件<input type="file" name="media" accept="audio/*,video/mp4,.m4a,.mp3,.wav,.ogg,.opus,.flac" required></label>' +
      select('import-category','主题',Object.entries(sources).map(([k,v])=>[k,v[0]]),'food') : '') +
    '<label class="field">' + (attach ? '英文或双语字幕' : '英文或双语字幕（可选）') + '<input type="file" name="subtitle" accept=".srt,.vtt,text/vtt"></label>' +
    '<label class="field">独立中文字幕（可选）<input type="file" name="chinese" accept=".srt,.vtt,text/vtt"></label>' +
    '<p class="muted">接受 SRT 和 WebVTT，文件保存在当前设备上。</p>','导入',attach ? 'attach-form' : 'material-form'))
}
async function importMaterial(f, attach) {
  const fields = new FormData(f), target = current
  const first = fields.get('subtitle'), second = fields.get('chinese'), media = fields.get('media')
  const cat = $('import-category')?.value || 'food'
  const button = f.querySelector('button[type=submit]')
  button.disabled = true
  try {
    if ([first,second].some(x=>x?.size > 5 * 1024 * 1024)) throw Error('每个字幕文件需小于 5 MB。')
    const merged = pairTimed(first?.size ? parseTimed(await first.text(), second?.size ? 'en' : 'auto') : [],
      second?.size ? parseTimed(await second.text(),'zh') : [])
    if ((first?.size || second?.size || attach) && !merged.length) throw Error('没有读到有效时间轴。请检查字幕格式。')
    const data = {id:attach ? target.id : 'local-' + uid(), cues:merged, label:'已导入的本地字幕'}
    if (!attach) Object.assign(data,{blob:media,cat,kind:'local',title:fields.get('title').trim() || media.name,source:'本地导入'})
    await materialTransaction('readwrite', store => store.put(data))
    ingestMaterial(data)
    modal.close()
    if (attach && current?.id === target.id) { cues = merged; transcriptLabel = data.label; render() }
    if (!attach) { queue = []; go('episode',data.id) }
    toast('已导入并保存在本机。')
  } catch (error) { toast(error.message || '导入失败。请检查设备存储。') }
  finally { button.disabled = false }
}

async function definition(word) {
  const first = word[0]?.toLowerCase()
  if (!/^[a-z]$/.test(first || '')) return null
  if (!dictionaries.has(first)) dictionaries.set(first, json('data/dict/' + first + '.json').catch(() => {
    dictionaries.delete(first)
    return {}
  }))
  return (await dictionaries.get(first))[word.toLowerCase()] || null
}
async function wordDialog(word = '', cueNumber = -1, wordMeaning = '', editing = '') {
  const item = current
  const cue = cues[cueNumber]
  const term = word.toLowerCase()
  const phraseMatch = Object.keys(item?.vocab || {}).filter(phrase => phrase.includes(' ') && norm(cue?.en).includes(norm(phrase)) && norm(phrase).split(' ').includes(norm(term)))
  const editBook = editing ? s.books.find(book => book.id === bookId) : null
  message(e(word || '添加单词或短语'), '<div id="word-definition">' + (word ? '<p class="muted">查询中文释义…</p>' : '') + '</div>' +
    (phraseMatch.length ? '<div class="actions">' + phraseMatch.map(phrase => btn(e(phrase),'word','outline','data-word="' + e(phrase) + '" data-cue="' + cueNumber + '"')).join('') + '</div>' : '') +
    form(field('单词或短语','word',word,true) + field('中文意思','meaning',wordMeaning,true) +
      '<label class="field">生词本<select name="book">' + s.books.map(book => option(book.id,book.name,editBook?.id || (word.includes(' ') ? 'phrases' : bookId))).join('') + option('new','新建生词本','') + '</select></label>' +
      field('新本名称（选择新建时填写）','newbook') +
      '<input type="hidden" name="entry" value="' + e(editing) + '"><input type="hidden" name="example" value="' + e(cue?.en || editBook?.items.find(x=>x.id===editing)?.example || '') + '">',editing ? '保存更改' : '加入生词本','word-form'))
  const box = $('word-definition')
  const exact = item?.vocab?.[term]
  let entry = exact ? ['', [exact]] : await definition(term)
  if (!box.isConnected || !modal.open || !word) return
  entry ||= ['', []]
  const [ipa, meanings] = entry
  const oxford = 'https://www.oxfordlearnersdictionaries.com/search/english/?q=' + encodeURIComponent(word)
  const cambridge = 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/' + encodeURIComponent(term.replaceAll(' ','-'))
  box.innerHTML = (ipa ? '<p class="muted">/' + e(ipa) + '/</p>' : '') +
    (meanings.length ? '<p class="common">' + e(meanings[0]) + '</p>' + (meanings.length > 1 ? '<p class="muted">' + e(meanings.slice(1).join(' · ')) + '</p>' : '') +
      '<p class="muted">' + (exact ? '课文语境释义' : '离线释义 · ECDICT') + '</p>' : '<p class="muted">未找到离线释义，可查询原站或填写自己的翻译。</p>') +
    '<div class="actions">' + btn('朗读','say','outline','data-word="' + e(word) + '"') +
    '<a class="text-btn" href="' + oxford + '"' + external + '>牛津词典</a><a class="text-btn" href="' + cambridge + '"' + external + '>剑桥词典</a></div>'
  const meaning = $('word-form').elements.meaning
  if (!meaning.value && meanings.length) meaning.value = meanings[0].slice(0,250)
}
function bookForm(f) {
  const d = new FormData(f)
  const word = d.get('word').trim(), meaning = d.get('meaning').trim(), target = d.get('book')
  if (!word || !meaning) return toast('请填写英文和中文释义。')
  let book = s.books.find(x=>x.id === target)
  if (target === 'new') {
    const name = d.get('newbook').trim().slice(0,32)
    if (!name) return toast('请输入新生词本的名称。')
    book = addBook(name)
  }
  if (!book) return toast('请选择生词本。')
  const previousBook = s.books.find(b=>b.items.some(x=>x.id===d.get('entry')))
  const previous = previousBook?.items.find(x=>x.id===d.get('entry'))
  const existing = book.items.find(x=>x.id!==previous?.id && norm(x.en)===norm(word))
  if (existing) return toast('这本生词本已有这个词。')
  if (previous) previousBook.items = previousBook.items.filter(x=>x.id !== previous.id)
  book.items.push({...previous, id:previous?.id || uid(), en:word, zh:meaning, example:d.get('example'), due:previous?.due || localDay(), reviews:previous?.reviews || 0,speak:previous?.speak || 0,dictate:previous?.dictate || 0,interval:previous?.interval || 0})
  bookId = book.id
  persist()
  modal.close()
  render()
  toast('已保存到「' + book.name + '」。')
}
function addBook(name) {
  const same = s.books.find(book=>book.name === name)
  if (same) return same
  const book = {id:uid(),name,items:[]}
  s.books.push(book)
  return book
}
const openedBook = () => s.books.find(book=>book.id===bookId) || s.books[0]
function flashItems(book) {
  return [...book.items].sort((a,b)=>a.due.localeCompare(b.due))
}
function booksView() {
  const book = openedBook(), all = flashItems(book)
  flashIndex = all.length ? flashIndex % all.length : 0
  const flash = all[flashIndex]
  return heading('生词本','收集单词与短语，按记忆间隔安排复习。',btn('新建生词本','new-book','outline')) +
    '<div class="filters">' + select('book-select','当前生词本',s.books.map(b=>[b.id,b.name]),book.id) + btn('添加词条','new-word','outline') + btn('导出 PDF','print-dialog','outline',all.length ? '' : 'disabled') + '</div>' +
    '<div class="grid-two"><section class="panel stack"><h2>翻卡复习</h2><p class="muted">' + all.filter(x=>x.due<=localDay()).length + ' 个今日到期</p>' +
    (flash ? '<article class="flash"><h3 class="q-prompt" lang="en">' + e(flash.en) + '</h3><p>' + (reveal ? e(flash.zh) : '想想它的中文意思') + '</p>' +
    (reveal ? '<div class="actions" style="justify-content:center">' + btn('还不熟','flash-rate','outline','data-step="0"') + btn('已记住','flash-rate','primary','data-step="1"') + '</div>' : btn('翻到背面','reveal','primary')) +
    '</article><div class="actions">' + btn('下一张','flash-next','outline') + '</div>' : '<p class="notice">点击字幕里的词即可收藏，也可以手动添加。</p>') +
    '</section><section class="panel stack"><h2>' + e(book.name) + '</h2><p class="muted">' + all.length + ' 个词条</p>' +
    book.items.map(w=>'<div class="book-row"><div class="book-entry"><strong lang="en">' + e(w.en) + '</strong><p>' + e(w.zh) + '</p><p>翻卡 ' + w.reviews + ' · 听写 ' + w.dictate + ' · 朗读 ' + w.speak + '</p></div><div class="actions">' +
       btn('朗读','book-say','outline','data-key="' + e(w.id) + '"') + btn('听写','book-spell','outline','data-key="' + e(w.id) + '"') + btn('编辑','book-edit','quiet','data-key="' + e(w.id) + '"') + '</div></div>').join('') +
    '</section></div>'
}
function say(text) {
  if (native) { native.say(text); return }
  if (!window.speechSynthesis) { toast('这台设备暂不支持朗读。'); return }
  const voice = new SpeechSynthesisUtterance(text)
  voice.lang = 'en-US'; voice.rate = .91
  speechSynthesis.cancel()
  speechSynthesis.speak(voice)
}
function printBook(blank) {
  const book = openedBook()
  $('print-sheet').innerHTML = '<header class="print-header"><p>回声岛 · ECHO FIELD</p><h1>' + e(book.name) + '</h1><p>' + localDay() + ' · ' + book.items.length + ' 个词条' + (blank ? ' · 听写与默写练习' : ' · 英汉对照') +
    '</p></header><table class="print-table"><thead><tr><th style="width:26%">英文</th><th style="width:29%">' + (blank ? '中文默写' : '中文释义') + '</th><th>' + (blank ? '例句默写' : '例句') + '</th></tr></thead><tbody>' +
    book.items.map(w=>'<tr><td>' + e(w.en) + '</td><td class="' + (blank ? 'practice' : '') + '">' + (blank ? '' : e(w.zh)) + '</td><td>' + (blank ? '' : e(w.example)) + '</td></tr>').join('') + '</tbody></table>'
  modal.close()
  setTimeout(() => { if (native) native.printSheet(); else window.print() },90)
}
const wordTest = [
 ['4','accurate','准确的','宽敞的','积极的','偶然的'],['4','arrange','安排','争论','归还','收集'],['4','reduce','减少','重复','承认','测量'],
 ['4','polite','礼貌的','诚实的','粗心的','严厉的'],['4','average','平均的','传统的','罕见的','直接的'],['4','depend','依赖','扩展','推迟','限制'],
 ['4','complain','抱怨','完成','庆祝','道歉'],['4','benefit','益处','负担','边界','证据'],
 ['6','inevitable','不可避免的','不切实际的','不可见的','不稳定的'],['6','allocate','分配','定位','加速','证实'],['6','sufficient','足够的','高效的','坚固的','相似的'],
 ['6','consequence','后果','共识','竞争','概念'],['6','negotiate','谈判','否定','提名','忽略'],['6','retain','保留','获取','限制','替代'],
 ['6','substantial','大量的','暂时的','类似的','分开的'],['6','reluctant','不情愿的','不相关的','很轻松的','很慷慨的'],
 ['65','ambiguous','模棱两可的','雄心勃勃的','严肃的','可信的'],['65','plausible','貌似合理的','可塑造的','易碎的','含糊的'],['65','mitigate','减轻','激励','测量','模仿'],
 ['65','discrepancy','差异','谨慎','分心','部署'],['65','scrutinize','细查','报废','照亮','夸大'],['65','resilient','有韧性的','无关的','静止的','草率的'],
 ['65','inference','推断','干涉','引荐','主张'],['65','contingent','取决于条件的','持续不断的','同时发生的','明确无疑的']
]
function shuffled(values) {
  const list = [...values]
  for (let i=list.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1))
    ;[list[i],list[j]] = [list[j],list[i]]
  }
  return list
}
function resetRecording() {
  recordingGeneration++
  if (recognition) recognition.abort()
  recognition = null
  if (recorder?.state === 'recording') recorder.stop()
  recorder = null
  if (recording) URL.revokeObjectURL(recording)
  recording = ''
  recordingStatus = ''
}
function exerciseItem() {
  const list = lessons.filter(item=>item.level === s.level)
  return list[Math.floor(Math.random()*list.length)] || lessons[0]
}
function startExercise(kind, episode, cueIndex = -1) {
  const item = episode || exerciseItem()
  const list = (episode && current?.id === episode.id ? cues : item?.cues || []).map((cue,i)=>({...cue,i})).filter(cue=>cue.en && (kind !== 'translate' || cue.zh))
  const cue = list.find(c=>c.i===cueIndex) || list[Math.floor(Math.random()*list.length)]
  if (!cue) return toast('目前没有适合这项练习的字幕。')
  resetRecording()
  audio.pause()
  let answer = cue.en, prompt = cue.en
  if (kind === 'gap') {
    const words = [...cue.en.matchAll(/[a-zA-Z]{4,}/g)]
    const hit = words.sort((a,b)=>b[0].length-a[0].length)[0]
    if (!hit) return toast('请选择另一句用于填词。')
    answer = hit[0]
    prompt = cue.en.slice(0,hit.index) + ' ______ ' + cue.en.slice(hit.index + hit[0].length)
  }
  challenge = {kind,item,cue,prompt,answer}
  result = null
  go('practice')
}
let exerciseClip = null
function playCue(item, cue) {
  audio.pause()
  if (exerciseClip) exerciseClip.pause()
  const clip = new Audio(item.audio)
  exerciseClip = clip
  const timer = () => { if (clip.currentTime >= cue.end) { clip.pause(); clip.removeEventListener('timeupdate',timer) } }
  clip.addEventListener('loadedmetadata', () => { clip.currentTime = cue.start }, {once:true})
  clip.addEventListener('timeupdate',timer)
  clip.play().catch(() => toast('原音播放失败，请稍后再试。'))
}
function practice() {
  const nav = '<div class="actions">' + [['gap','听力填词'],['dictation','整句听写'],['translate','英译中'],['shadow','跟读评分'],['test','词汇测试']].map(([k,v])=>btn(v,'practice-start',challenge?.kind===k ? 'primary' : 'outline','data-key="' + k + '"')).join('') + '</div>'
  const intro = heading('练习场','用同一句英语训练听、写、译和跟读。') + nav
  if (!challenge) return intro + '<div class="section-heading"><p class="muted">选一种练习开始。难度跟随你的学习计划，也可以从字幕直接练习某一句。</p></div>'
  if (challenge.kind === 'test') return intro + quiz()
  const {kind,item,prompt,cue} = challenge
  const title = {gap:'听力填词',dictation:'整句听写',translate:'英译中',shadow:'跟读评分'}[kind]
  return intro + '<section class="panel stack" style="margin-top:16px"><h2>' + title + '</h2><p class="muted">' + e(item.zh || item.title) + '</p>' +
    '<div class="actions">' + btn(icon('play') + ' 播放原句','practice-audio','outline') + btn('再练一题','practice-start','outline','data-key="' + kind + '"') + '</div>' +
    (kind !== 'dictation' || result ? '<p class="q-prompt" lang="en">' + e(result && kind === 'dictation' ? cue.en : prompt) + '</p>' : '<p class="muted">先听原句，再写出你听到的内容。</p>') +
    (kind === 'shadow' ? '<div class="recording"><div class="actions">' +
      btn(recorder?.state === 'recording' ? '结束录音' : '录音对比','record','primary') + btn('识别并评分','score-voice','outline') + '</div>' +
      (recording ? '<audio controls src="' + e(recording) + '"></audio>' : '') + '<p class="muted" id="record-status">' + e(recordingStatus || '识别评分根据词句匹配率计算。可单独录音并回放。') + '</p></div>' :
      result ? '<p class="feedback">' + e(result.message) + '</p>' : form('<label class="field">' + (kind === 'translate' ? '写下你的翻译' : '写下你听到的内容') + '<textarea required rows="3" maxlength="800" name="answer" autocomplete="off"></textarea></label>',kind === 'translate' ? '对照参考译文' : '检查答案','answer-form')) +
    (result && kind === 'translate' ? '<div class="actions">' + btn('自评：已理解','translation-ok','primary',result.scored ? 'disabled' : '') + btn('收藏整句','save-practice','outline') + '</div>' :
      result && kind === 'shadow' ? '<p class="feedback">' + e(result.message) + '</p>' : '') + '</section>'
}
function quiz() {
  const {items,answers} = challenge
  const position = answers.length
  if (position === items.length) {
    const bands = Object.entries(levels).map(([k,v]) => {
      const hits = items.map((row,i)=>row[0]===k && row[2]===answers[i]).filter(Boolean).length
      return [k,v,hits]
    })
    const suggested = bands[2][2] >= 6 && bands[1][2] >= 6 ? '65' : bands[1][2] >= 6 ? '6' : '4'
    return '<section class="panel stack" style="margin-top:16px"><h2>词汇抽测结果</h2><div class="stat-grid">' + bands.map(([,v,hits])=>'<div class="stat"><strong>' + hits + ' / 8</strong>' + v + '</div>').join('') +
      '</div><p class="muted">共 24 个样本词。结果用于推荐课程难度，无法精确估计你的总词汇量。</p>' + btn('采用建议难度 ' + levels[suggested],'recommend-level','primary','data-key="' + suggested + '"') + '</section>'
  }
  const q = items[position]
  return '<section class="panel stack" style="margin-top:16px"><h2>词汇抽测</h2><p class="muted">第 ' + (position+1) + ' / ' + items.length + ' 题 · 选择最常见的意思</p><p class="q-prompt" lang="en">' + e(q[1]) + '</p><div class="actions">' +
    q[6].map(value=>btn(e(value),'test-answer','outline','data-key="' + e(value) + '"')).join('') + btn('不认识','test-answer','quiet') + '</div></section>'
}
function finishAnswer(answer) {
  const {kind,prompt,answer:expected,item,cue} = challenge
  if (kind === 'translate') result = {message:'你的翻译：' + answer + '　参考译文：' + cue.zh,scored:false}
  else {
    const score = wordScore(expected,answer)
    const correct = norm(expected) === norm(answer)
    result = {message:(correct ? '正确！' : '匹配 ' + score + '%。参考答案：' + (kind === 'gap' ? prompt.replace('______',expected) : expected))}
    record(0,correct ? 10 : 0,1,kind + ':' + item.id + ':' + cue.i)
  }
  render()
}
async function recordVoice() {
  if (recorder?.state === 'recording') { recorder.stop(); return }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('当前环境不支持直接录音。可使用 HTTPS 网页或安卓应用。')
  const token = ++recordingGeneration
  if (recording) { URL.revokeObjectURL(recording); recording = '' }
  recordingStatus = '请求麦克风权限…'
  render()
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio:true})
    if (token !== recordingGeneration) { stream.getTracks().forEach(t=>t.stop()); return }
    try { recorder = new MediaRecorder(stream) } catch (error) { stream.getTracks().forEach(t=>t.stop()); throw error }
    const chunks = [], r = recorder
    r.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    r.onstop = () => {
      stream.getTracks().forEach(track=>track.stop())
      if (token !== recordingGeneration) return
      recording = URL.createObjectURL(new Blob(chunks,{type:r.mimeType}))
      recordingStatus = '录音已完成，点击播放对比。'
      recorder = null
      render()
    }
    audio.pause()
    exerciseClip?.pause()
    r.start()
    recordingStatus = '正在录音…'
    render()
    setTimeout(() => { if (r.state === 'recording') r.stop() },60000)
  } catch { if (token === recordingGeneration) { recordingStatus = '无法使用麦克风，请检查系统和应用权限。'; render() } }
}
function receiveScore(text) {
  if (route()[0] !== 'practice' || challenge?.kind !== 'shadow') return
  if (!text) { recordingStatus = '未识别到英语语音。可以重试或使用录音对比。'; render(); return }
  const {item,cue} = challenge
  const score = wordScore(cue.en,text)
  recordingStatus = ''
  result = {message:'匹配 ' + score + '/100 · 识别结果：' + text}
  record(0,score >= 80 ? 10 : 0,1,'voice:' + item.id + ':' + cue.i)
  render()
}
window.echoVoiceResult = receiveScore
function scoreVoice() {
  if (recorder?.state === 'recording') return toast('请先结束录音。')
  audio.pause(); exerciseClip?.pause()
  if (native) { native.recognize(); return }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Recognition) return toast('当前浏览器没有可用的语音识别服务。可以录音对比。')
  if (recognition) recognition.abort()
  const r = new Recognition(), token = recordingGeneration
  recognition = r
  r.lang = 'en-US'
  r.onstart = () => { recordingStatus = '正在识别，请读出原句。'; render() }
  r.onresult = event => { if (token === recordingGeneration && recognition === r) receiveScore(event.results[0][0].transcript) }
  r.onerror = () => { if (token === recordingGeneration && recognition === r) receiveScore('') }
  r.onend = () => { if (recognition === r) recognition = null }
  try { r.start() } catch { receiveScore('') }
}
function planned() {
  const samples = Array.from({length:7},(_,i) => s.events[dayOffset(-i-1)]?.seconds || 0).filter(Boolean)
  const mean = samples.length ? samples.reduce((sum,v)=>sum+v,0)/samples.length/60 : 11
  return Math.max(8,Math.min(35,Math.round(mean + (samples.length >= 4 ? 3 : 1))))
}
function plan() {
  const due = s.books.flatMap(b=>b.items).filter(x=>x.due <= localDay()).length
  const time = Math.floor(today().seconds/60)
  const suggestion = planned()
  const week = Array.from({length:7},(_,i) => dayOffset(i-6))
  return heading('学习计划','每天听一点，按自己的节奏提高难度。') + '<div class="grid-two">' +
    '<section class="panel stack"><h2>今日任务</h2><div class="stat-grid"><div class="stat"><strong>' + time + '/' + s.goal + '</strong> 听力分钟</div><div class="stat"><strong>' + today().attempts + '</strong> 练习次数</div><div class="stat"><strong>' + due + '</strong> 待复习词条</div></div>' +
    '<div class="actions">' + goBtn('去听力馆','library','primary') + goBtn('复习生词','books','outline') + '</div><p class="muted">建议每天 ' + suggestion + ' 分钟，根据近 7 天收听记录更新。</p>' +
    '<div class="actions">' + btn('采用建议时长','recommended-goal','outline') + btn('编辑目标与提醒','plan-dialog','outline') + '</div></section>' +
    '<section class="panel stack"><h2>' + rank() + '</h2><div class="stat-grid"><div class="stat"><strong>' + xp() + '</strong> 累计 XP</div><div class="stat"><strong>' + streak() + '</strong> 连续天数</div><div class="stat"><strong>' + e(levels[s.level]) + '</strong> 当前难度</div></div>' +
    '<div class="week" aria-label="最近七天听力分钟">' + week.map(d=>{
      const seconds = s.events[d]?.seconds || 0
      return '<div title="' + d + ' · ' + Math.floor(seconds/60) + ' 分钟"><span>' + Math.floor(seconds/60) + '</span><i style="--bar:' + Math.min(100,Math.round(seconds/60/s.goal*100)) + '%"></i><small>' + d.slice(-2) + '日</small></div>'
    }).join('') + '</div><p class="muted">首次听完精听课或答对一道题可获得 XP。</p></section></div>' +
    '<div class="section-heading"><h2>设置与数据</h2></div><section class="panel stack"><p class="muted">学习数据保存在当前设备。导入备份可以在设备之间迁移生词本和进度。</p><div class="actions">' +
    btn('导出备份','backup','outline') + btn('导入备份','restore','outline') + btn('资源来源','sources','outline') +
    (!native ? '<a class="btn outline" href="echo-field.apk" download>安卓安装包</a>' : '<a class="btn outline" href="https://lures2019.github.io/toolbox/echo-field/"' + external + '>打开网页版</a>') +
    '<a class="btn quiet" href="' + (native ? 'https://lures2019.github.io/toolbox/' : '/toolbox/') + '">返回百宝箱</a></div></section>'
}
function planDialog() {
  message('目标与提醒', form(
    select('plan-level','课程难度',Object.entries(levels),s.level) +
    '<label class="field">每日听力分钟<input name="minutes" type="number" min="3" max="120" value="' + Number(s.goal) + '" required></label>' +
    '<label class="field">每日提醒时间<input name="remind" type="time" value="' + e(s.remind) + '"></label>' +
    '<label class="field"><span><input name="minor" type="checkbox" ' + (s.minor ? 'checked' : '') + '> 隐藏节目方标为成人内容的资源</span></label>' +
    '<p class="muted">' + (native ? '提醒由安卓通知发送。' : '网页在打开时会提醒。关闭页面也想收到提醒，可下载日历事件。') + '</p>' +
    (s.remind && !native ? btn('下载日历提醒','calendar','outline','type="button"') : ''),'保存计划','plan-form'))
}
let lastReminder = ''
function maybeRemind() {
  if (!s.remind || native) return
  const day = localDay(), now = new Date()
  const minute = now.getHours()*60 + now.getMinutes()
  const [hr,min] = s.remind.split(':').map(Number)
  if (lastReminder !== day && minute >= hr*60 + min && today().seconds < s.goal*60) {
    lastReminder = day
    toast('到听力时间了。今天还差 ' + Math.ceil(s.goal - today().seconds / 60) + ' 分钟。')
  }
}
function saveFile(filename, content, type) {
  if (native && type === 'application/json') { native.saveBackup(content); return }
  const file = new Blob([content], {type})
  const link = document.createElement('a')
  link.href = URL.createObjectURL(file)
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href),3000)
}
function calendar() {
  const date = localDay().replaceAll('-','')
  const time = s.remind.replace(':','')
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'')
  saveFile('echo-field-reminder.ics',['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Echo Field//Learning reminders//ZH','BEGIN:VEVENT','UID:'+uid()+'@echo-field','DTSTAMP:'+stamp,'DTSTART:'+date+'T'+time+'00','RRULE:FREQ=DAILY','SUMMARY:回声岛英语学习','BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:PT0M','DESCRIPTION:每日英语听力练习','END:VALARM','END:VEVENT','END:VCALENDAR',''].join('\r\n'),'text/calendar;charset=utf-8')
}
function sourceDialog() {
  message('资源来源', '<p class="muted">完整分集通过节目方公开订阅源收听。订阅源可见的历史范围由节目方维护。识别字幕的来源在播放页显示。</p>' +
    Object.entries(sources).map(([cat,v]) => '<div class="book-row"><div class="book-entry"><strong>' + e(v[0]) + '</strong><p>' + e(v[3]) + (cat==='news' ? '、NPR Up First' : cat==='tech' ? '、VOA Science & Technology' : '') + '</p></div><a class="btn outline" href="' + safeLink(v[5]) + '"' + external + '>官网</a></div>').join('') +
    '<p class="muted">最近一次成功同步 ' + e(Object.values(feedDates).map(d=>d.at).sort().pop()?.slice(0,10) || '暂无记录') +
    ' · <a href="data/dict/LICENSE.txt">ECDICT 许可证</a> · <a href="https://huggingface.co/hexgrad/Kokoro-82M"' + external + '>Kokoro</a></p>')
}
function render() {
  if (!ready) return
  const [name] = route()
  const view = ['library','episode','practice','books','plan'].includes(name) ? name : 'home'
  $('nav').innerHTML = navigation.map(([k,v])=>'<a class="side-item" href="#' + k + '"' + ((view === 'episode' ? 'library' : view) === k ? ' aria-current="page"' : '') + '>' + icon(k) + v + '</a>').join('')
  $('level-chip').textContent = levels[s.level]
  if (view === 'episode') {
    const item = index.get(key())
    if (item && (!s.minor || !item.explicit)) selectEpisode(item)
    page.innerHTML = detail(item && (!s.minor || !item.explicit) ? item : null)
    if (cues.length) updateCues(true)
    return
  }
  page.innerHTML = {home,library,practice,books:booksView,plan}[view]()
}
function setLibrary(cat, kind = 'all') {
  s.library = {cat,kind,level:'all',show:36}
  search = $('search-box').value = ''
  persist()
  go('library')
}
function itemFor(id) { return openedBook().items.find(w => w.id === id) }
function sleepDialog() {
  if (!current) return
  message('定时停止','<p class="muted">' + e(playbackStatus()) + '</p><div class="actions">' +
    [5,10,15,25,30,45,60,90].map(n=>btn(n+' 分钟','set-sleep','outline','data-key="' + n + '"')).join('') +
    btn('本集结束后停止','set-sleep','outline','data-key="end"') + btn('取消定时','set-sleep','quiet','data-key="off"') + '</div>')
}
const actions = {
  close:()=>modal.close(),
  category:el=>setLibrary(el.dataset.key),
  'all-library':()=>setLibrary('all'),
  'lesson-library':()=>setLibrary('all','lesson'),
  more:()=>{ s.library.show += 36; render() },
  'open-current':()=>current && go('episode',current.id),
  toggle:()=>audio.paused ? playAudio() : audio.pause(),
  skip:el=>seekTo(audio.currentTime + Number(el.dataset.step)),
  previous:()=>moveEpisode(-1,true), next:()=>moveEpisode(1,true),
  sleep:sleepDialog, 'set-sleep':el=>{setSleep(el.dataset.key);modal.close()},
  loop:()=>{loop=!loop;if(loop && cues[active]) seekTo(cues[active].start);render()},
  mark:()=>{ if (!current || !cues[active]) return; const id = current.id+':'+active; s.marks[id]=!s.marks[id];persist();render() },
  favorite:()=>{s.favorites[current.id]=!s.favorites[current.id];persist();render()},
  'seek-cue':el=>{seekTo(cues[Number(el.dataset.index)].start); playAudio()},
  word:el=>wordDialog(el.dataset.word, Number(el.dataset.cue)),
  say:el=>say(el.dataset.word),
  'import-material':()=>fileForm(false), attach:()=>fileForm(true),
  'practice-current':()=>message('练习当前句','<div class="actions">'+[['gap','听力填词'],['dictation','整句听写'],['translate','英译中'],['shadow','跟读评分']].map(([k,v])=>btn(v,'practice-from','outline','data-key="'+k+'"')).join('')+'</div>'),
  'practice-from':el=>{modal.close();startExercise(el.dataset.key,current,active)},
  'practice-start':el=>{
    if (el.dataset.key !== 'test') return startExercise(el.dataset.key)
    resetRecording();audio.pause();exerciseClip?.pause()
    challenge={kind:'test',items:shuffled(wordTest).map(row=>[...row,shuffled(row.slice(2))]),answers:[]}
    result=null;render()
  },
  'practice-audio':()=>playCue(challenge.item,challenge.cue),
  'test-answer':el=>{challenge.answers.push(el.dataset.key || '');if(challenge.answers.length===wordTest.length) record(0,25,1,'vocab-test:'+localDay());render()},
  'recommend-level':el=>{s.level=el.dataset.key;persist();go('plan');toast('课程难度已更新。')},
  record:recordVoice,'score-voice':scoreVoice,
  'translation-ok':()=>{result.scored=true;record(0,8,1,'translate:'+challenge.item.id+':'+challenge.cue.i);render()},
  'save-practice':()=>wordDialog(challenge.cue.en,-1,challenge.cue.zh),
  'new-book':()=>message('新建生词本',form(field('名称','name','',true),'创建','book-form')),
  'new-word':()=>wordDialog(),
  reveal:()=>{reveal=true;render()}, 'flash-next':()=>{flashIndex++;reveal=false;render()},
  'flash-rate':el=>{
    const item = flashItems(openedBook())[flashIndex]
    const remembered = el.dataset.step==='1'
    item.interval = remembered ? Math.min(60,item.interval ? item.interval*2 : 1) : 0
    item.due=dayOffset(item.interval);item.reviews++
    record(0,4,1,'review:'+item.id+':'+localDay());reveal=false;flashIndex=0;render()
  },
  'book-say':el=>{const w=itemFor(el.dataset.key);w.speak++;persist();say(w.en);render()},
  'book-edit':el=>{const w=itemFor(el.dataset.key);wordDialog(w.en,-1,w.zh,w.id)},
  'book-spell':el=>{
    const w=itemFor(el.dataset.key)
    message('生词听写',form(btn('朗读英文','say','outline','type="button" data-word="'+e(w.en)+'"')+field('听到的英文','answer','',true)+'<input type="hidden" name="entry" value="'+e(w.id)+'">','检查','spell-form'))
    say(w.en)
  },
  'print-dialog':()=>message('导出生词本 PDF','<p class="muted">打印时选择 A4，然后用系统的「另存为 PDF」。</p><div class="actions">'+btn('英汉对照版','print','primary')+btn('默写练习版','print','outline','data-key="blank"')+'</div>'),
  print:el=>printBook(el.dataset.key==='blank'),
  'recommended-goal':()=>{s.goal=planned();persist();render()},
  'plan-dialog':planDialog, calendar, sources:sourceDialog,
  backup:()=>saveFile('echo-field-'+localDay()+'.json',JSON.stringify({version:1,state:s},null,2),'application/json'),
  restore:()=>$('import-backup').click()
}
let libraryQueue = []
document.addEventListener('click', event => {
  const el = event.target.closest('[data-action],[data-go]')
  if (!el || el.disabled) return
  if (el.dataset.go) {
    if (el.dataset.go==='episode' && el.closest('.episode-grid')) queue = route()[0]==='library' ? [...libraryQueue] : []
    go(el.dataset.go,el.dataset.key)
  } else actions[el.dataset.action]?.(el)
})
document.addEventListener('submit', event => {
  event.preventDefault()
  const form = event.target, f = new FormData(form)
  const answer = f.get('answer')?.trim()
  switch(form.id) {
    case 'search': search=$('search-box').value;s.library={cat:'all',kind:'all',level:'all',show:36};go('library');break
    case 'material-form': importMaterial(form,false);break
    case 'attach-form': importMaterial(form,true);break
    case 'word-form': bookForm(form);break
    case 'book-form': if(f.get('name').trim()){bookId=addBook(f.get('name').trim().slice(0,32)).id;reveal=false;flashIndex=0;persist();modal.close();render()}break
    case 'answer-form': if(answer) finishAnswer(answer);break
    case 'spell-form': {
      const w=itemFor(f.get('entry'));if (!w || !answer) break
      const ok=norm(answer)===norm(w.en);w.dictate++
      record(0,ok?6:0,1,'spell:'+w.id+':'+localDay());render()
      message('听写结果','<p class="feedback">'+(ok?'正确！':'参考答案：'+e(w.en))+'</p>'+btn('完成','close','primary'))
      break
    }
    case 'plan-form':
      s.level=$('plan-level').value;s.goal=Number(f.get('minutes'));s.remind=f.get('remind');s.minor=f.has('minor')
      if(native)native.setReminder(s.remind);persist();modal.close();render();maybeRemind();break
  }
})
document.addEventListener('change',event=>{
  const {id,value,checked}=event.target
  const filter={'filter-cat':'cat','filter-kind':'kind','filter-level':'level'}[id]
  if(filter){s.library[filter]=value;s.library.show=36;persist();render();return}
  switch(id) {
    case 'speed':s.rate=audio.playbackRate=Number(value);break
    case 'sub-mode':s.mode=value;break
    case 'subtitle-size':s.font=Number(value);break
    case 'play-mode':s.playMode=value;break
    case 'follow':follow=checked;break
    case 'book-select':bookId=value;flashIndex=0;reveal=false;break
    default:return
  }
  persist();render();$(id)?.focus()
})
function validateBackup(data) {
  const v = data?.state
  if (data?.version !== 1 || !v || !Array.isArray(v.books) || v.books.length < 1 || v.books.length > 150) return false
  if (!v.books.every(b=>typeof b.id==='string' && typeof b.name==='string' && Array.isArray(b.items) && b.items.every(w=>
    ['id','en','zh','due'].every(k=>typeof w[k]==='string') && ['reviews','speak','dictate','interval'].every(k=>Number.isFinite(w[k]))))) return false
  if (!levels[v.level] || !['both','en','zh','off'].includes(v.mode) || typeof v.goal !== 'number' || v.goal<3 || v.goal>120) return false
  if (!Number.isFinite(v.font) || !Number.isFinite(v.rate) || v.rate<.5 || v.rate>2) return false
  return ['history','marks','favorites','events','wins','library'].every(k=>v[k] && typeof v[k]==='object' && !Array.isArray(v[k])) &&
    Object.values(v.events).every(day=>day && [day.seconds,day.xp,day.attempts].every(Number.isFinite))
}
$('import-backup').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return
  try{
    if(file.size>8*1024*1024) throw Error()
    const data=JSON.parse(await file.text())
    if(!validateBackup(data)) throw Error()
    message('恢复学习备份','<p class="notice">将用这个备份替换当前设备的生词本和学习记录。</p>'+btn('恢复备份','confirm-backup','primary'))
    actions['confirm-backup']=()=>{
      s={...defaults(),...data.state};audio.playbackRate=s.rate;bookId=s.books[0].id;flashIndex=0;reveal=false
      if(native)native.setReminder(s.remind);persist();modal.close();render();toast('学习备份已恢复。')
      delete actions['confirm-backup']
    }
  }catch{toast('备份格式无效，原有学习数据已保留。')}
})
window.addEventListener('hashchange',()=>{
  if(route()[0]!=='practice'){resetRecording();exerciseClip?.pause()}
  render()
  window.scrollTo(0,0)
  page.focus({preventScroll:true})
})
document.addEventListener('keydown',event=>{
  if(event.key==='/' && !modal.open && !['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)){event.preventDefault();$('search-box').focus()}
})
function loadCatalog(batch) {
  if (!Array.isArray(batch?.items)) return
  feedDates=batch.feeds || {}
  episodes=batch.items
  episodes.forEach(item=>index.set(item.id,item))
}
async function init() {
  $('search-icon').innerHTML=icon('search')
  if (native) { $('apk-link').hidden=true;document.querySelector('.side-foot a:last-child').href='https://lures2019.github.io/toolbox/' }
  const [config, local, catalog, imports]=await Promise.allSettled([
    json('data/sources.json'),json('data/lessons.json'),json('data/podcasts.json'),materialTransaction('readonly',store=>store.getAll())
  ])
  if(config.status!=='fulfilled' || local.status!=='fulfilled'){
    page.innerHTML='<p class="notice">核心课程读取失败。请重新打开页面或使用最新版安装包。</p>';return
  }
  sources=config.value;lessons=local.value
  lessons.forEach(item=>index.set(item.id,item))
  if(catalog.status==='fulfilled') loadCatalog(catalog.value)
  if(imports.status==='fulfilled') imports.value.forEach(ingestMaterial)
  ready=true;render();maybeRemind()
  if(native) json('https://lures2019.github.io/toolbox/echo-field/data/podcasts.json',5000).then(batch=>{loadCatalog(batch);if(['home','library',''].includes(route()[0]))render()}).catch(()=>{})
}
setInterval(maybeRemind,30000)
init()
