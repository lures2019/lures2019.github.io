import {escape as e, normalized as norm, clock, safeLink, localDay, dayOffset, parseTimed, pairTimed, wordScore, listeningBlanks, wordTokens} from './core.js?v=1.3.0'
import {boards,sections,libraryView,paperView,gradePaper,nextExamPlan,planPanel} from './exam-ui.js?v=1.3.0'
import {highlightedVocabulary, transcriptHtml, transcriptText} from './transcript-export.js?v=1.3.0'

const $ = id => document.getElementById(id)
const page = $('page'), audio = $('audio'), modal = $('modal')
const native = window.EchoAndroid, profileKey = 'echo-field.profiles.v1'
const profiles = (() => {
  try {
    const data = JSON.parse(localStorage.getItem(profileKey))
    if (data?.people.some(person => person.id === data.active)) return data
  } catch {}
  return {active:'owner',people:[{id:'owner',name:'我的档案'}]}
})()
const person = profiles.people.find(profile => profile.id === profiles.active)
const storageKey = 'echo-field.v1' + (person.id === 'owner' ? '' : '.' + person.id)
const levels = {'4':'CET-4', '6':'CET-6', '65':'雅思 6.5'}
const icons = {
  home:'<path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/>',
  library:'<path d="M3 14v-2a9 9 0 0 1 18 0v2M3 13h4v7H5a2 2 0 0 1-2-2zm18 0h-4v7h2a2 2 0 0 0 2-2z"/>',
  practice:'<path d="m12 3 2 6 6 3-6 2-2 7-2-7-6-2 6-3zm7 13 1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>',
  exam:'<path d="M5 4h10l4 4v12H5zm10 0v5h4M8 12h8m-8 4h6"/>',
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
const navigation = [['home','首页'],['library','听力馆'],['exam','考试'],['practice','练习场'],['books','生词本'],['plan','学习计划']]
const defaults = () => ({
  level:'4', mode:'both', font:22, rate:1, goal:12, remind:'', minor:true, roadmap:null, examFilters:null, examResults:{},
  library:{cat:'all', kind:'all', level:'all', show:36}, history:{}, marks:{}, highlights:{}, favorites:{}, events:{}, wins:{},
  books:[{id:'words', name:'我的生词', items:[]}, {id:'phrases', name:'常用短语', items:[]}], last:''
})
function readState() {
  try { return {...defaults(), ...JSON.parse(localStorage.getItem(storageKey) || '{}')} } catch { return defaults() }
}
let s = readState()
let sources = {}, lessons = [], episodes = [], feedDates = {}, ready = false, search = ''
const feedAdditions = new Map(), examImports = new Map(), examDrafts = new Map(), examRetakes = new Set()
let examPapers = [], examSources = []
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
  s.events[localDay()] = {seconds:d.seconds + seconds, xp:d.xp + points, attempts:d.attempts + attempts, goal:d.goal || s.goal}
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
    '<div class="actions hero-actions">' + (next ? goBtn(icon('play') + (s.last && index.has(s.last) ? '继续收听' : '开始第一课'), 'episode', 'gold', next.id) : goBtn('进入听力馆','library','gold')) + goBtn('新手怎么学','guide','hero-guide') + '</div>' +
    '</section><section class="panel goal"><div class="goal-head"><h2>今日学习</h2>' + btn(icon('plan'),'checkins','quiet calendar-open','aria-label="查看学习打卡日历" title="查看学习打卡日历"') + '</div><div class="goal-numbers"><strong>' + mins + '</strong> / ' + s.goal + ' 分钟</div><progress aria-label="今日听力进度" max="' + s.goal + '" value="' + Math.min(mins,s.goal) + '"></progress><div class="goaltile">' + icon('practice') + '<span><strong>' + streak() + '</strong> 天连续学习 · <strong>' + xp() + '</strong> XP</span></div>' + goBtn('查看学习计划','plan','outline') + '</section></div>' +
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
  return heading('听力馆', e(source ? source[2] + ' · ' + source[3] : '双语精听课、完整节目和本地导入'), '<div class="actions">' + btn('更新听力源','feed-dialog','outline') + btn('导入音频','import-material','outline') + '</div>') +
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
  const words = Object.keys(current.vocab || {}).flatMap(phrase => norm(phrase).split(' '))
  const painted = s.highlights?.[current.id]?.[i] || {}
  const html = wordTokens(cue.en).map(({text:word,start,word:isWord})=>{
    if (!isWord) return e(word)
    const color=['gold','sage'].includes(painted[start]) ? ' highlight-'+painted[start] : ''
    return '<span role="button" tabindex="0" class="word'+(words.includes(norm(word))?' key':'')+(savedWord(word)?' saved':'')+color+
      '" data-action="word" data-word="'+e(word)+'" data-cue="'+i+'" data-offset="'+start+'">'+e(word)+'</span>'
  }).join('')
  return '<div class="cue" id="cue-' + i + '" style="--subtitle-size:' + Number(s.font) + 'px"><button class="timestamp" data-action="seek-cue" data-index="' + i + '">' + clock(cue.start) + '</button><div>' +
    (s.mode !== 'zh' && cue.en ? '<p class="english" lang="en" data-cue-index="'+i+'">' + html + '</p>' : '') +
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
    (cues.length ? btn('导出听力原文','transcript-export','outline') : '') +
    '</div><div class="player-tools">' +
    select('sub-mode','字幕',[['both','中英双语'],['en','仅英语'],['zh','仅中文'],['off','关闭字幕']],s.mode) +
    select('speed','速度',[.5,.65,.75,.85,1,1.1,1.25,1.5,1.75,2].map(n=>[n,n+'×']),s.rate) +
    select('subtitle-size','字号',[16,19,22,26,30,36].map(n=>[n,n+' px']),s.font) +
    (cues.length ? btn(loop ? '单句循环已开' : '单句循环','loop','outline','aria-pressed="' + loop + '"')  +
      '<label class="field">跟随播放 <input id="follow" type="checkbox" ' + (follow ? 'checked' : '') + '></label>' : '') +
    '</div>' + (cues.some(cue=>cue.en) && ['both','en'].includes(s.mode) ? highlightTools() : '') + subtitleBox + '</section><aside class="stack">' +
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
  if (item.kind === 'exam') queue = [item.id]
  else if (!queue.includes(item.id)) queue = allItems().filter(ep => ep.kind === item.kind && (item.kind === 'lesson' ? ep.level === item.level : ep.source === item.source)).map(ep => ep.id)
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
  if (current?.kind === 'exam' && route()[0] === 'exam-paper') return
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
    const request = indexedDB.open('echo-field-materials' + (person.id === 'owner' ? '' : '.' + person.id),1)
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
  if (data.id.startsWith('feed:')) { feedAdditions.set(data.id,data); return }
  if (data.kind === 'exam' && data.blob) {
    const {blob,...rest}=data
    const paper={...rest,audio:URL.createObjectURL(blob)}
    examImports.set(paper.id,paper)
    index.set(paper.id,paper)
    return
  }
  if (data.blob) {
    const added = {...data, audio:URL.createObjectURL(data.blob)}
    delete added.blob
    localMaterials.set(added.id,added)
    index.set(added.id,added)
  } else attachments.set(data.id,data)
}
function message(title, content) {
  $('modal-body').innerHTML = '<div class="modal-header"><h2 id="modal-title">' + title + '</h2>' + btn(icon('close'),'close','quiet','aria-label="关闭"') + '</div>' + content
  modal.classList.toggle('wide-dialog', title === '学习打卡日历')
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
  entry = entry || ['', []]
  const [ipa, meanings] = entry
  const oxford = 'https://www.oxfordlearnersdictionaries.com/search/english/?q=' + encodeURIComponent(word)
  const cambridge = 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/' + encodeURIComponent(term.replace(/ /g,'-'))
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
  const listening = kind === 'gap' || kind === 'dictation'
  const list = (episode && current?.id === episode.id ? cues : item?.cues || []).map((cue,i) => ({
    ...cue, i, blanks:listening ? listeningBlanks(cue.en,kind) : null
  })).filter(cue => cue.en && (kind !== 'translate' || cue.zh) && (!listening || cue.blanks.answers.length))
  const cue = list.find(c=>c.i===cueIndex) || list[Math.floor(Math.random()*list.length)]
  if (!cue) return toast('目前没有适合这项练习的字幕。')
  resetRecording()
  audio.pause()
  challenge = {kind,item,cue}
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
  const {kind,item,cue} = challenge
  const listening = kind === 'gap' || kind === 'dictation'
  const title = {gap:'听力填词',dictation:'整句听写',translate:'英译中',shadow:'跟读评分'}[kind]
  return intro + '<section class="panel stack" style="margin-top:16px"><h2>' + title + '</h2><p class="muted">' + e(item.zh || item.title) + '</p>' +
    '<div class="actions">' + btn(icon('play') + ' 播放原句','practice-audio','outline') + btn('再练一题','practice-start','outline','data-key="' + kind + '"') + '</div>' +
    (listening ? listeningAnswer(cue) : '<p class="q-prompt" lang="en">' + e(cue.en) + '</p>') +
    (kind === 'shadow' ? '<div class="recording"><div class="actions">' +
      btn(recorder?.state === 'recording' ? '结束录音' : '录音对比','record','primary') + btn('识别并评分','score-voice','outline') + '</div>' +
      (recording ? '<audio controls src="' + e(recording) + '"></audio>' : '') + '<p class="muted" id="record-status">' + e(recordingStatus || '识别评分根据词句匹配率计算。可单独录音并回放。') + '</p></div>' :
      kind === 'translate' && !result ? form('<label class="field">写下你的翻译<textarea required rows="3" maxlength="800" name="answer" autocomplete="off"></textarea></label>','对照参考译文','answer-form') : '') +
    (result ? '<p class="feedback">' + e(result.message) + '</p>' : '') +
    (result && kind === 'translate' ? '<div class="actions">' + btn('自评：已理解','translation-ok','primary',result.scored ? 'disabled' : '') + btn('收藏整句','save-practice','outline') + '</div>' : '') + '</section>'
}
function listeningAnswer(cue) {
  const sentence = cue.blanks.tokens.map(({text,blank}) => {
    if (blank === undefined) return e(text)
    if (result) return '<span class="blank-key ' + (result.correct[blank] ? 'right' : 'wrong') + '">' + e(text) + '</span>'
    const width = Math.min(18,Math.max(5,text.length + 2))
    return '<input class="blank-input" name="blank" aria-label="第 ' + (blank + 1) + ' 空" style="--characters:' + width +
      'ch" required maxlength="50" autocomplete="off" autocapitalize="none" spellcheck="false">'
  }).join('')
  const line = '<p class="q-prompt blank-sentence" lang="en">' + sentence + '</p>'
  return result ? line : form('<p class="muted">听原句，在空格中填写普通单词。</p>' + line,'检查答案','answer-form')
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
function finishAnswer(data) {
  const {kind,item,cue} = challenge
  if (kind === 'translate') {
    const answer = data.get('answer')?.trim()
    if (!answer) return
    result = {message:'你的翻译：' + answer + '　参考译文：' + cue.zh,scored:false}
  } else {
    const submitted = data.getAll('blank')
    if (submitted.some(answer => !answer.trim())) return toast('请填写所有空格。')
    const correct = cue.blanks.answers.map((word,i)=>norm(word) === norm(submitted[i]))
    const hits = correct.filter(Boolean).length
    const passed = hits === correct.length
    result = {correct,message:passed ? '全部正确！' : '答对 ' + hits + ' / ' + correct.length + ' 个空。已在原句标出需要复习的词。'}
    record(0,passed ? 10 : 0,1,kind + ':' + item.id + ':' + cue.i)
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
  return heading('学习计划','当前档案 · ' + e(person.name),'<div class="actions">' + goBtn('新手指南','guide','outline') + btn('学习档案','profiles','outline') + '</div>') + '<div class="grid-two">' +
    '<section class="panel stack"><h2>今日任务</h2><div class="stat-grid"><div class="stat"><strong>' + time + '/' + s.goal + '</strong> 听力分钟</div><div class="stat"><strong>' + today().attempts + '</strong> 练习次数</div><div class="stat"><strong>' + due + '</strong> 待复习词条</div></div>' +
    '<div class="actions">' + goBtn('去听力馆','library','primary') + goBtn('复习生词','books','outline') + '</div><p class="muted">建议每天 ' + suggestion + ' 分钟，根据近 7 天收听记录更新。</p>' +
    '<div class="actions">' + btn('采用建议时长','recommended-goal','outline') + btn('编辑目标与提醒','plan-dialog','outline') + '</div></section>' +
    '<section class="panel stack"><h2>' + rank() + '</h2><div class="stat-grid"><div class="stat"><strong>' + xp() + '</strong> 累计 XP</div><div class="stat"><strong>' + streak() + '</strong> 连续天数</div><div class="stat"><strong>' + e(levels[s.level]) + '</strong> 当前难度</div></div>' +
    '<div class="week" aria-label="最近七天听力分钟">' + week.map(d=>{
      const seconds = s.events[d]?.seconds || 0
      return '<div title="' + d + ' · ' + Math.floor(seconds/60) + ' 分钟"><span>' + Math.floor(seconds/60) + '</span><i style="--bar:' + Math.min(100,Math.round(seconds/60/s.goal*100)) + '%"></i><small>' + d.slice(-2) + '日</small></div>'
    }).join('') + '</div><p class="muted">首次听完精听课或答对一道题可获得 XP。</p></section></div>' +
    examPlanForProfile() + roadmapView() + '<div class="section-heading"><h2>设置与数据</h2></div><section class="panel stack"><p class="muted">学习数据保存在当前设备。导入备份可以在设备之间迁移生词本和进度。</p><div class="actions">' +
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
  const date = localDay().replace(/-/g,'')
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
  const view = ['library','episode','practice','books','plan','guide','exam','exam-paper'].includes(name) ? name : 'home'
  $('nav').innerHTML = navigation.map(([k,v])=>'<a class="side-item" href="#' + k + '"' + ((view === 'exam-paper' ? 'exam' : view === 'episode' ? 'library' : view === 'guide' ? 'home' : view) === k ? ' aria-current="page"' : '') + '>' + icon(k) + v + '</a>').join('')
  $('level-chip').textContent = levels[s.level]
  if (view === 'exam-paper') {
    const paper=index.get(key())
    if (!paper || paper.kind!=='exam') { page.innerHTML=heading('找不到这组考试材料')+goBtn('返回考试训练','exam','primary'); return }
    selectEpisode(paper)
    const result=examRetakes.has(paper.id) ? null : s.examResults[paper.id]?.latest
    page.innerHTML=paperView(paper,{result,draft:examDrafts.get(paper.id) || [],favorite:Boolean(s.favorites[paper.id]),
      paused:audio.paused,canExport:cues.length>0 && (Boolean(result) || !paper.questions.length),
      markerControls:cues.some(cue=>cue.en) && ['both','en'].includes(s.mode) ? highlightTools() : '',cueRows:(result || !paper.questions.length) && s.mode!=='off' ? cues.map(cueRow).join('') : ''})
    if (cues.length) updateCues(true)
    return
  }
  if (view === 'episode') {
    const item = index.get(key())
    if (item && (!s.minor || !item.explicit)) selectEpisode(item)
    page.innerHTML = detail(item && (!s.minor || !item.explicit) ? item : null)
    if (cues.length) updateCues(true)
    return
  }
  page.innerHTML = {home,library,practice,books:booksView,plan,guide,exam:showExamLibrary}[view]()
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
  'paint-selection':el=>paintSelection(el.dataset.color),
  'transcript-export':transcriptDialog,
  'transcript-pick':el=>{
    const yes=el.dataset.key==='all'
    for (const box of $('transcript-export-form').querySelectorAll('input[name="line"]')) box.checked=yes
    updateExportCount()
  },
  favorite:()=>{s.favorites[current.id]=!s.favorites[current.id];persist();render()},
  'seek-cue':el=>{seekTo(cues[Number(el.dataset.index)].start); playAudio()},
  word:el=>{if(!selectedWords().length)wordDialog(el.dataset.word, Number(el.dataset.cue))},
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
  'starter-plan':()=>{s.goal=10;persist();toast('已设置每天 10 分钟的听力目标。');go('plan')},
  'starter-travel':()=>{s.library={cat:'travel',kind:'lesson',level:'4',show:36};search=$('search-box').value='';persist();go('library')},
  'starter-lesson':()=>{const lesson=lessons.find(item=>item.id==='food-4');if(lesson){queue=[];go('episode',lesson.id)}},
  'feed-dialog':feedDialog, 'custom-feed':customFeedDialog,
  'exam-board':el=>{s.examFilters=examDefaults(el.dataset.key);persist();render()},
  'exam-import':examImportDialog,
  'exam-log':el=>manualExamDialog(el.dataset.key),
  'exam-favorite':el=>{const id=el.dataset.key;s.favorites[id]=!s.favorites[id];persist();render()},
  'exam-external-done':el=>{const id=el.dataset.key;if(s.examResults[id])delete s.examResults[id];else s.examResults[id]={manual:true};persist();render()},
  'exam-retake':()=>{examRetakes.add(current.id);examDrafts.delete(current.id);audio.pause();seekTo(0);render()},
  'exam-evidence':el=>{const line=cues[Number(el.dataset.index)];if(current?.kind==='exam'&&line)playCue(current,line)},
  'exam-word':el=>wordDialog(el.dataset.word,Number(el.dataset.index),el.dataset.meaning),
  checkins:()=>{flushProgress();const now=new Date();calendarAt=new Date(now.getFullYear(),now.getMonth(),1);calendarSelected=localDay(now);showCheckins()},
  'calendar-month':el=>{calendarAt=new Date(calendarAt.getFullYear(),calendarAt.getMonth()+Number(el.dataset.step),1);calendarSelected=calendarAt.getMonth()===new Date().getMonth() && calendarAt.getFullYear()===new Date().getFullYear() ? localDay() : localDay(calendarAt);showCheckins();modal.querySelector('[data-action="calendar-month"][data-step="'+el.dataset.step+'"]:not(:disabled)')?.focus()},
  'calendar-day':el=>{calendarSelected=el.dataset.key;showCheckins();modal.querySelector('[data-action="calendar-day"][aria-pressed="true"]')?.focus()},
  profiles:profilesDialog,'switch-profile':el=>switchProfile(el.dataset.key),
  roadmap:roadmapDialog,'milestone':el=>{const k=Number(el.dataset.key);const done=new Set(s.roadmap.done || []);if(done.has(k))done.delete(k);else done.add(k);s.roadmap.done=[...done];persist();render()},
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
    case 'exam-filters': { s.examFilters={...examSettings(),question:f.get('question') || ''};persist();render();break }
    case 'exam-answer-form': submitExam(f);break
    case 'exam-import-form': importExam(form,f);break
    case 'exam-log-form': logExamResult(f);break
    case 'transcript-export-form': exportTranscript(form,f,event.submitter?.value);break
    case 'feed-refresh-form': refreshTopics(form,f);break
    case 'custom-feed-form': addCustomFeed(form,f);break
    case 'profile-form': saveProfile(f.get('name'));break
    case 'roadmap-form': saveRoadmap(f);break
    case 'attach-form': importMaterial(form,true);break
    case 'word-form': bookForm(form);break
    case 'book-form': if(f.get('name').trim()){bookId=addBook(f.get('name').trim().slice(0,32)).id;reveal=false;flashIndex=0;persist();modal.close();render()}break
    case 'answer-form': finishAnswer(f);break
    case 'spell-form': {
      const w=itemFor(f.get('entry'));if (!w || !answer) break
      const ok=norm(answer)===norm(w.en);w.dictate++
      record(0,ok?6:0,1,'spell:'+w.id+':'+localDay());render()
      message('听写结果','<p class="feedback">'+(ok?'正确！':'参考答案：'+e(w.en))+'</p>'+btn('完成','close','primary'))
      break
    }
    case 'plan-form':
      s.level=$('plan-level').value;s.goal=Number(f.get('minutes'));s.remind=f.get('remind');s.minor=f.has('minor')
      if(native)syncReminders();persist();modal.close();render();maybeRemind();break
  }
})
document.addEventListener('change',event=>{
  const {id,value,checked}=event.target
  if (event.target.closest('#transcript-export-form')) updateExportCount()
  const examFilter={'exam-year':'year','exam-group':'group','exam-origin':'origin','exam-status':'status'}[id]
  if(examFilter){s.examFilters={...examSettings(),[examFilter]:value};persist();render();$(id)?.focus();return}
  if(id==='exam-import-board'){renderImportGroups(value);return}
  if(route()[0]==='exam-paper' && event.target.name?.startsWith('q-') && current?.kind==='exam'){
    const fields=examDrafts.get(current.id) || []
    fields[Number(event.target.name.slice(2))]=value
    examDrafts.set(current.id,fields)
  }
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
  if (v.examResults && (typeof v.examResults!=='object' || Array.isArray(v.examResults) ||
      !Object.values(v.examResults).every(entry=>entry && (entry.manual===true || Array.isArray(entry.latest?.correct) && Array.isArray(entry.latest?.answered))))) return false
  if (v.roadmap && (!/^\d{4}-\d{2}-\d{2}$/.test(v.roadmap.start) || !Number.isFinite(v.roadmap.minutes) || !Number.isFinite(v.roadmap.days) || !Array.isArray(v.roadmap.done))) return false
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
      if(native)syncReminders();persist();modal.close();render();toast('学习备份已恢复。')
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
  if (event.target.matches?.('.word') && ['Enter',' '].includes(event.key)) {
    event.preventDefault()
    wordDialog(event.target.dataset.word,Number(event.target.dataset.cue))
  }
  if(event.key==='/' && !modal.open && !['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)){event.preventDefault();$('search-box').focus()}
})
let baseline = []
function loadCatalog(batch) {
  if (!Array.isArray(batch?.items)) return
  feedDates=batch.feeds || {}
  baseline=batch.items
}
async function init() {
  $('search-icon').innerHTML=icon('search')
  if (native) { $('apk-link').hidden=true;document.querySelector('.side-foot a:last-child').href='https://lures2019.github.io/toolbox/' }
  const [config, local, catalog, imports, papers, references]=await Promise.allSettled([
    json('data/sources.json'),json('data/lessons.json'),json('data/podcasts.json'),materialTransaction('readonly',store=>store.getAll()),
    json('data/exam-papers.json'),json('data/exam-sources.json')
  ])
  if(config.status!=='fulfilled' || local.status!=='fulfilled'){
    page.innerHTML='<p class="notice">核心课程读取失败。请重新打开页面或使用最新版安装包。</p>';return
  }
  sources=config.value;lessons=local.value
  lessons.forEach(item=>index.set(item.id,item))
  if(catalog.status==='fulfilled') loadCatalog(catalog.value)
  if (papers.status==='fulfilled' && Array.isArray(papers.value)) { examPapers=papers.value; examPapers.forEach(paper=>index.set(paper.id,paper)) }
  if (references.status==='fulfilled' && Array.isArray(references.value)) examSources=references.value
  if(imports.status==='fulfilled') imports.value.forEach(ingestMaterial)
  ready=true;render();maybeRemind()
  if(native) json('https://lures2019.github.io/toolbox/echo-field/data/podcasts.json',5000).then(batch=>{loadCatalog(batch);if(['home','library',''].includes(route()[0]))render()}).catch(()=>{})
}

function foundation() {
  const finished = lessons.filter(item => item.level === '4' && s.wins['listen:' + item.id]).length
  const attempts = Object.values(s.events).reduce((sum, day) => sum + day.attempts, 0)
  const words = new Set(s.books.flatMap(book=>book.items.map(item=>norm(item.en)))).size
  if (!s.wins.foundation && finished >= 3 && attempts >= 3 && words >= 3) { s.wins.foundation=true; persist() }
  return {ready:Boolean(s.wins.foundation),finished,attempts,words}
}
function refreshVisibleFeeds() {
  const items = new Map(baseline.map(item=>[item.id,item]))
  for (const entry of feedAdditions.values()) {
    for (const item of entry.items) items.set(item.id,item)
  }
  episodes = [...items.values()].sort((a,b)=>b.date.localeCompare(a.date))
  episodes.forEach(item=>index.set(item.id,item))
}
function feedDialog() {
  const task = foundation()
  const topicRows = Object.entries(sources).map(([cat,source])=>{
    const saved = feedAdditions.get('feed:topic:' + cat)
    return '<label class="feed-choice"><input type="checkbox" name="topic" value="' + cat + '"' +
      (cat === 'news' ? ' checked' : '') + (task.ready ? '' : ' disabled') + '><span><strong>' + e(source[0]) + '</strong><small>' +
      e(saved ? '上次应用 ' + saved.at.slice(0,16).replace('T',' ') + (saved.checked ? ' · 源于 ' + new Date(saved.checked).toLocaleDateString('zh-CN') + ' 同步' : '') : source[3]) + '</small></span></label>'
  }).join('')
  const custom = [...feedAdditions.values()].filter(source=>source.custom)
  message('更新听力源', '<div class="foundation"><p><strong>' + (task.ready ? '入门目标已完成' : '完成入门目标即可更新') + '</strong></p>' +
    '<p class="muted">四级精听 ' + Math.min(task.finished,3) + '/3 · 练习 ' + Math.min(task.attempts,3) + '/3 · 生词 ' + Math.min(task.words,3) + '/3</p></div>' +
    (task.ready ? '<p class="muted">勾选你想更新的主题。新闻目录随博客定时同步，点击后将最新快照加入当前档案。</p>' :
      '<p class="muted">已有课程和节目现在就能听。完整播放三节四级课、完成三次练习并收藏三个词条后，可自行选择要更新的主题。</p>') +
    '<form id="feed-refresh-form" class="fields"><div class="feed-grid">' + topicRows + '</div><button class="btn primary" type="submit"' +
    (task.ready ? '' : ' disabled') + '>应用所选主题更新</button></form>' +
    (task.ready ? '<div class="actions">' + btn('添加自己的 RSS 源','custom-feed','outline') + '</div>' : '') +
    (custom.length ? '<div class="stack"><p class="muted">我的 RSS 源</p>' + custom.map(feed=>'<div class="book-row"><div class="book-entry"><strong>' + e(feed.name) +
      '</strong><p>' + feed.items.length + ' 集 · ' + e(sources[feed.cat]?.[0]) + '</p></div>' +
      btn('刷新','refresh-custom','outline','data-key="' + e(feed.id) + '"' + (task.ready ? '' : ' disabled')) + '</div>').join('') + '</div>' : ''))
}
const feedEndpoint = 'https://lures2019.github.io/toolbox/echo-field/data/podcasts-updates.json'
async function refreshTopics(form, data) {
  if (!foundation().ready) return
  const selected = data.getAll('topic').filter(topic => Object.prototype.hasOwnProperty.call(sources,topic))
  if (!selected.length) return toast('请至少勾选一个主题。')
  const button=form.querySelector('button')
  button.disabled=true
  button.textContent='正在读取最新快照…'
  try {
    const endpoint = native ? feedEndpoint : 'data/podcasts-updates.json'
    let response=await fetch(endpoint,{cache:'no-store',signal:signal(15000)})
    if (!response.ok && !native && ['localhost','127.0.0.1'].includes(location.hostname)) response=await fetch(feedEndpoint,{cache:'no-store',signal:signal(15000)})
    if (!response.ok) throw Error('最新快照暂时不可用。')
    const snapshot=await response.json()
    if (!Array.isArray(snapshot.items) || !snapshot.feeds) throw Error('最新快照格式异常。')
    const known=new Set(episodes.map(item=>item.id))
    let additions=0
    for (const topic of selected) {
      const updated = snapshot.items.filter(item=>item.cat===topic && validEpisode(item))
      const earlier = feedAdditions.get('feed:topic:'+topic)
      const merged = new Map((earlier?.items || []).map(item=>[item.id,item]))
      for (const item of updated) merged.set(item.id,item)
      const next={id:'feed:topic:'+topic,at:new Date().toLocaleString('sv-SE'),checked:Object.entries(snapshot.feeds).filter(([key])=>key===topic || key.startsWith(topic+'-')).map(([,v])=>v.at).sort().pop() || '',items:[...merged.values()]}
      for (const item of updated) if (!known.has(item.id) && (!s.minor || !item.explicit)) additions++
      await materialTransaction('readwrite',store=>store.put(next))
      feedAdditions.set(next.id,next)
    }
    refreshVisibleFeeds()
    if (modal.open && button.isConnected) modal.close()
    render()
    toast(additions ? '已加入 ' + additions + ' 集新节目。' : '所选主题已检查，目前没有新节目。')
  }catch(error){refreshVisibleFeeds();toast(error.message || '更新源失败，请稍后重试。')}
  finally{button.disabled=false;button.textContent='应用所选主题更新'}
}
function validEpisode(item) {
  return item && typeof item.id==='string' && typeof item.title==='string' && typeof item.date==='string' &&
    typeof item.source==='string' && Boolean(safeLink(item.audio))
}
function customFeedDialog() {
  if (!foundation().ready) return
  message('添加公开 RSS 源', form(
    '<label class="field">RSS 地址<input name="feed" type="url" placeholder="https://example.com/feed.xml"></label>' +
    select('feed-category','归入主题',Object.entries(sources).map(([k,v])=>[k,v[0]]),'news') +
    '<label class="field">或导入 RSS 文件<input name="rssFile" type="file" accept=".xml,.rss,application/rss+xml,text/xml"></label>' +
    '<p class="muted">支持含有 HTTPS 音频地址的公开 RSS。网站限制浏览器读取时，可下载 RSS 文件后导入。</p>','添加听力源','custom-feed-form'))
}
const rssNS='https://podcastindex.org/namespace/1.0', itunesNS='http://www.itunes.com/dtds/podcast-1.0.dtd'
const xmlText=(item,name)=>[...item.children].find(node=>node.localName===name)?.textContent.trim() || ''
async function rssId(text) {
  const sha=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))
  return [...new Uint8Array(sha).slice(0,12)].map(x=>x.toString(16).padStart(2,'0')).join('')
}
function rssUrl(value) {
  try { const url=new URL(value); return url.protocol==='https:' && !url.username && !url.password ? url.href : '' } catch { return '' }
}
async function readRss(feed, file) {
  if (file?.size) {
    if(file.size > 20*1024*1024) throw Error('RSS 文件需小于 20 MB。')
    return file.text()
  }
  if (!feed) throw Error('请输入 HTTPS 订阅地址。')
  let response
  try { response=await fetch(feed,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:signal(18000)}) }
  catch { throw Error('该源暂时不可达，或限制浏览器读取。可下载 RSS 文件后导入。') }
  if (!response.ok) throw Error('订阅源返回 ' + response.status + '。')
  const blob=await response.blob()
  if(blob.size > 20*1024*1024) throw Error('RSS 文件需小于 20 MB。')
  return blob.text()
}
async function saveRss(input, cat, feed, previous) {
  const xml = new DOMParser().parseFromString(input,'application/xml')
  const channel=xml.querySelector('channel')
  if(!channel || xml.querySelector('parsererror')) throw Error('没有读到有效的 RSS 节目。')
  const name=xmlText(channel,'title').slice(0,150)
  if(!name) throw Error('订阅源缺少节目标题。')
  const channelUrl=rssUrl(xmlText(channel,'link'))
  const sourceId=previous?.id || 'feed:user:' + await rssId(feed || (name+'|'+channelUrl))
  const known=previous || feedAdditions.get(sourceId)
  const existing=new Map((known?.items || []).map(item=>[item.id,item]))
  const parsed=await Promise.all([...channel.children].filter(node=>node.localName==='item').slice(0,5000).map(async item=>{
    const enclosure=[...item.children].find(node=>node.localName==='enclosure')
    if(!enclosure || !/^audio\/|application\/(ogg|octet-stream)/i.test(enclosure.getAttribute('type') || 'audio/mpeg')) return null
    const media=rssUrl(enclosure.getAttribute('url'))
    const title=xmlText(item,'title').slice(0,350)
    if(!media || !title) return null
    const guid=xmlText(item,'guid') || media
    const tracks=[...item.getElementsByTagNameNS(rssNS,'transcript')].flatMap(node=>{
      const url=rssUrl(node.getAttribute('url'))
      return url ? [{url,type:node.getAttribute('type') || '',lang:node.getAttribute('language') || 'en'}] : []
    })
    const date = new Date(xmlText(item,'pubDate'))
    return {id:'custom-'+await rssId(sourceId+'|'+guid),kind:'podcast',cat,title,source:name,audio:media,tracks,
      url:rssUrl(xmlText(item,'link')) || channelUrl,date:Number.isFinite(+date) ? date.toISOString().slice(0,10) : '',
      explicit:/^(true|yes|explicit)$/i.test(item.getElementsByTagNameNS(itunesNS,'explicit')[0]?.textContent.trim() || '')}
  }))
  const items=parsed.filter(Boolean)
  if(!items.length) throw Error('RSS 中没有可播放的 HTTPS 音频。')
  if (known && known.cat !== cat) existing.forEach(item=>{existing.set(item.id,{...item,cat})})
  let count=0
  for(const item of items){if(!existing.has(item.id) && (!s.minor || !item.explicit))count++;existing.set(item.id,item)}
  const data={id:sourceId,custom:true,feed,name,cat,items:[...existing.values()],at:new Date().toLocaleString('sv-SE')}
  await materialTransaction('readwrite',store=>store.put(data))
  feedAdditions.set(data.id,data)
  refreshVisibleFeeds()
  return count
}
async function addCustomFeed(form,data) {
  if(!foundation().ready) return
  const link=rssUrl(data.get('feed'))
  const cat=$('feed-category').value
  const button=form.querySelector('button')
  button.disabled=true
  try {
    const added=await saveRss(await readRss(link,data.get('rssFile')),cat,link)
    if(modal.open&&button.isConnected) modal.close()
    setLibrary(cat)
    toast('已保存听力源，加入 '+added+' 集。')
  } catch(error) { toast(error.message || '无法保存 RSS 源。') }
  finally {button.disabled=false}
}
actions['refresh-custom']=async el=>{
  if(!foundation().ready) return
  const source=feedAdditions.get(el.dataset.key)
  if(!source.feed) return toast('这是离线导入的来源。重新导入最新 RSS 文件即可更新。')
  el.disabled=true
  try {
    const added=await saveRss(await readRss(source.feed),source.cat,source.feed,source)
    render();if(modal.open&&el.isConnected)feedDialog()
    toast(added ? '已加入 '+added+' 集。' : '这个节目暂时没有新分集。')
  } catch(error){toast(error.message || '节目暂时无法刷新。')}
  finally {el.disabled=false}
}

function profilesDialog() {
  message('学习档案','<p class="muted">每个人的目标、进度、生词本和听力源设置按档案保存。现在使用本机档案，换设备时可以导出学习备份。</p>' +
    profiles.people.map(p=>'<div class="book-row"><div class="book-entry"><strong>' + e(p.name) + '</strong></div>' +
    (p.id===person.id ? '<span class="tag">正在使用</span>' : btn('切换','switch-profile','outline','data-key="'+e(p.id)+'"'))+'</div>').join('') +
    form(field('新档案名称','name','',true),'新建档案','profile-form'))
}
function switchProfile(key) {
  if(key===person.id||!profiles.people.some(p=>p.id===key))return
  flushProgress()
  try {
    localStorage.setItem(profileKey,JSON.stringify({...profiles,active:key}))
    if(native) {
      const target=JSON.parse(localStorage.getItem('echo-field.v1'+(key==='owner'?'':'.'+key)) || '{}')
      native.setReminder(target.remind || '')
    }
    history.replaceState(null,'',location.pathname+location.search+'#home')
    location.reload()
  } catch { toast('无法切换档案，请检查本机存储。') }
}
function saveProfile(name) {
  const clean=String(name || '').trim().slice(0,24)
  if(!clean)return
  if(profiles.people.some(p=>p.name===clean))return toast('已有这个名称的档案。')
  if(profiles.people.length>=20)return toast('当前设备已达到 20 个档案。')
  const next={id:uid(),name:clean}
  profiles.people.push(next)
  switchProfile(next.id)
}
function syncReminders() { native.setReminder(s.remind) }

const stages=[
  {months:'第 1–2 月',title:'打好听辨基础',learn:'短课先盲听，再开字幕对照。每周做两次逐句听写，录下同一段话比较节奏。',test:'听完一段 2–3 分钟的慢速材料，能用英文说出主题和三个细节，再对照稿件。',level:'4',cat:'food'},
  {months:'第 3–5 月',title:'过渡到自然语速',learn:'练 5–10 分钟的访谈或慢速新闻。每周两次和伙伴练习，每次 10 分钟。',test:'不看中文字幕听一段 5–8 分钟的材料，做两分钟复述，并用原文检查三个关键信息。',level:'6',cat:'news'},
  {months:'第 6–9 月',title:'扩展题材和口音',learn:'轮换新闻、科技、文化播客，每周练一次不同口音。把常用搭配带进 20 分钟的对话。',test:'听一段 15 分钟常速材料，能概括立场与证据，并在对话中回答两个追问。',level:'65',cat:'tech'},
  {months:'第 10–12 月',title:'持续交流与独立复盘',learn:'听完整访谈或电影评论。每月请老师或伙伴按流利度、准确度和表达清晰度给一次反馈。',test:'为一段陌生材料做四分钟复述和评论，并连续进行 30 分钟英语交流。记录仍需要练的场景。',level:'65',cat:'film'}
]
function roadmapView() {
  if(!s.roadmap) return '<div class="section-heading"><h2>12 个月听说路线</h2></div><section class="panel stack"><p class="muted">从四级材料起步，用阶段任务检验理解与表达。可选择投入时长和想优先练的场景。</p>' + btn('制定一年计划','roadmap','primary')+'</section>'
  const plan=s.roadmap
  const elapsed=Math.max(0,Math.floor((Date.now()-new Date(plan.start+'T00:00:00').getTime())/86400000))
  const stage=elapsed<61?0:elapsed<153?1:elapsed<274?2:3
  const hours=Math.round(plan.minutes*plan.days*52/60)
  return '<div class="section-heading"><div><h2>12 个月听说路线</h2><p class="section-sub">'+e(plan.start)+' 开始 · '+e(plan.focus)+' · 每周 '+plan.days+' 天 / 每天 '+plan.minutes+' 分钟 · 年度约 '+hours+' 小时</p></div>'+btn('编辑路线','roadmap','outline')+'</div>'+
    '<section class="panel stack"><p class="muted">目标是把新学的英语用进真实对话。年度时数是投入计划，能力以每阶段实际表现和反馈为准。</p>' +
    stages.map((item,i)=>'<article class="stage'+(i===stage?' stage-current':'')+'"><p class="muted">' + item.months+(i===stage?' · 当前阶段':'') + '</p><h3>' + item.title + '</h3><p>' + item.learn + '</p><p><strong>验收</strong> ' + item.test +
      '</p><div class="actions">' + btn('听本阶段材料','stage-listen','outline','data-key="'+i+'"') +
      btn(plan.done.includes(i) ? '已自评完成' : '自评完成','milestone','quiet','data-key="'+i+'" aria-pressed="'+plan.done.includes(i)+'"') + '</div></article>').join('') +
    '<p class="muted"><a href="https://www.coe.int/en/web/common-european-framework-reference-languages/table-1-cefr-3.3-common-reference-levels-global-scale"' + external +
    '>欧洲语言等级能力描述</a> · <a href="https://support.cambridgeenglish.org/hc/en-gb/articles/202838506-Guided-learning-hours"' + external + '>剑桥英语学习时数说明</a></p></section>'
}
function roadmapDialog() {
  const r=s.roadmap || {start:localDay(),minutes:60,days:6,focus:'日常交流'}
  message('制定 12 个月听说计划',form(
    '<label class="field">开始时间<input type="date" name="start" value="'+e(r.start)+'" required></label>'+
    select('road-focus','优先场景',['日常交流','旅行社交','工作交流','原声影视','新闻与访谈'].map(m=>[m,m]),r.focus)+
    '<div class="grid-two"><label class="field">每次训练（分钟）<input type="number" name="minutes" min="15" max="120" value="'+r.minutes+'" required></label>'+
    '<label class="field">每周训练（天）<input type="number" name="days" min="2" max="7" value="'+r.days+'" required></label></div>'+
    '<p class="muted">总时长包含听力、跟读、复述和真实对话。通过阶段自测调节难度。</p>','保存一年计划','roadmap-form'))
}
function saveRoadmap(f) {
  const start=f.get('start'), minutes=Number(f.get('minutes')), days=Number(f.get('days'))
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start) || minutes<15 || minutes>120 || days<2 || days>7) return
  s.roadmap={start,minutes,days,focus:$('road-focus').value,done:s.roadmap?.done || []}
  s.goal=Math.max(8,Math.round(minutes*.5))
  persist();modal.close();render();toast('已保存路线，听力目标调整为每天 '+s.goal+' 分钟。')
}
actions['stage-listen']=el=>{
  const step=stages[Number(el.dataset.key)]
  if(!step)return
  s.library=step.cat==='food'?{cat:'all',kind:'lesson',level:'4',show:36}:{cat:step.cat,kind:'all',level:'all',show:36}
  search=$('search-box').value=''
  persist();go('library')
}

let calendarAt, calendarSelected
function showCheckins() {
  const year=calendarAt.getFullYear(), month=calendarAt.getMonth(), end=new Date(year,month+1,0).getDate()
  const start=(calendarAt.getDay()+6)%7
  const todayDate=localDay()
  const selected=s.events[calendarSelected]
  const days=Array.from({length:end},(_,i)=>({
    n:i+1,date:localDay(new Date(year,month,i+1))
  })).map(day=>({...day,value:s.events[day.date]}))
  const learned=days.filter(day=>day.value?.seconds || day.value?.attempts)
  const hit=learned.filter(day=>day.value.goal && day.value.seconds>=60*day.value.goal)
  const cells=days.map(({n,date,value})=>{
    const study=Boolean(value?.seconds || value?.attempts)
    const goal=value?.goal && value.seconds>=60*value.goal
    const status=goal?'听力目标已达成':study?'有学习记录':'无学习记录'
    return '<button class="calendar-day'+(goal?' calendar-goal':study?' calendar-study':'')+(date===todayDate?' calendar-today':'')+
      '" data-action="calendar-day" data-key="'+date+'" aria-pressed="'+(date===calendarSelected)+'" aria-label="'+date+' · '+status+'"'+
      (date>todayDate?' disabled':'')+'>'+n+(study?'<i aria-hidden="true"></i>':'')+'</button>'
  })
  const reached=selected?.goal && selected.seconds>=60*selected.goal
  const dateNote=selected && (selected.seconds || selected.attempts) ?
    '<div class="stat-grid"><div class="stat"><strong>'+Math.floor(selected.seconds/60)+' 分 '+selected.seconds%60+' 秒</strong>听力时长</div>'+
    '<div class="stat"><strong>'+selected.attempts+'</strong>练习次数</div><div class="stat"><strong>'+selected.xp+'</strong>获得 XP</div></div>'+
    (selected.goal ? '<p class="muted">当天目标 '+selected.goal+' 分钟 · '+(reached?'已达成':'未达成')+'</p>':'') :
    '<p class="muted">这一天还没有学习记录。</p>'
  message('学习打卡日历','<div class="calendar-month"><div class="actions">'+btn('上个月','calendar-month','outline','data-step="-1"')+
    btn('下个月','calendar-month','outline','data-step="1" '+(new Date(year,month+1,1)>new Date() ? 'disabled':''))+
    '</div><strong>'+year+' 年 '+(month+1)+' 月</strong></div><div class="calendar-grid" aria-label="当月打卡">'+
    ['一','二','三','四','五','六','日'].map(d=>'<span class="weekday">周'+d+'</span>').join('')+
    '<span aria-hidden="true"></span>'.repeat(start)+cells.join('')+'</div>'+
    '<div class="calendar-legend"><span><i class="calendar-study"></i>已学习 '+learned.length+' 天</span>'+
    '<span><i class="calendar-goal"></i>达成听力目标 '+hit.length+' 天</span><span>连续 '+streak()+' 天</span></div>'+
    '<section class="calendar-detail stack"><h3>'+calendarSelected+(calendarSelected===todayDate?' · 今天':'')+'</h3>'+dateNote+'</section>')
}

function guide() {
  const card = (title,body,action) => '<article class="panel stack guide-card"><h2>'+title+'</h2>'+body+(action || '')+'</article>'
  return heading('新手怎么学','每天留一小段时间，练到能听懂，也能开口。',goBtn('返回首页','home','outline')) +
    '<section class="panel stack guide-intro"><h2>今天就这么练</h2><p>挑一段你有兴趣、能听懂一点的短音频。第一遍关字幕，听出大概在聊什么。第二遍打开英文字幕，找出两处刚才没听出来的地方，必要时再看中文。最后挑一两句跟着说，合上字幕用自己的话讲一遍。</p><div class="actions">'+
    btn(icon('play')+' 试一节四级精听','starter-lesson','primary')+btn('设为每日 10 分钟','starter-plan','outline')+'</div></section>'+
    '<div class="section-heading"><h2>一天怎么安排</h2></div><div class="guide-three">'+
    card('早上 · 8–12 分钟','<p>起床后、出门前都可以。听一段，挑两句出声读。别急着查每个词，先抓住是谁、在做什么。</p>')+
    card('通勤 · 5–10 分钟','<p>坐车或走路时重听早上的片段。试着在心里复述一句，空下来后再查词。开车时只听音频。</p>')+
    card('晚上 · 5–10 分钟','<p>做一次填词或听写，翻两三张生词卡。周末有空时，找同伴练一轮真实对话，或录一段自我介绍回听。</p>')+'</div>'+
    '<div class="section-heading"><h2>怎么坚持下来</h2></div><section class="panel stack guide-card"><ul class="guide-list"><li><strong>忙到只剩 5 分钟：</strong> 重听一分钟，跟读两句，复习一个词。今天做到这里就算完成。</li><li><strong>漏了一天：</strong> 第二天接着原计划做。打开上次那一课，先听一分钟。</li><li><strong>太难想放弃：</strong> 换同主题更短的音频，降到 0.75×，再开英文字幕。连续几次能说出主题后，回到正常速度。</li><li><strong>感觉进步慢：</strong> 每两周录一次同主题的 60 秒复述。对比自己是否更少停顿、能多讲几个细节。</li></ul></section>'+
    '<div class="section-heading"><h2>每个阶段能检验什么</h2></div><div class="grid-two">'+
    card('入门 · 先能开口','<p>拿日常短课练到不看稿也能自我介绍、点餐、问路。跟伙伴模拟一次，遇到没听清会用 <span lang="en">Could you say that again?</span> 请对方重复。</p>',btn('练旅行对话','starter-travel','outline'))+
    card('实用 · 旅行能处理变化','<p>练听懂登机口改动、酒店入住和路线说明。试着完成一次酒店角色扮演，主动确认日期、价格或地点，再复述关键信息。</p>')+
    card('进阶 · 聊熟悉的话题更从容','<p>每周至少两次对话练习。试着围绕一个话题聊 10–20 分钟，说出观点、给例子、接两三个追问。请对方指出哪里最难听懂，下一周只改一两处。</p>',goBtn('制定 12 个月路线','plan','outline'))+
    card('考试 · 冲刺雅思口语 6','<p>按真实题型练 Part 1–3。试着在 Part 2 围绕题目讲满两分钟，用例子把意思说清楚。至少做一次完整口语模考，拿到对流利度、词汇、语法和发音的反馈。总分 6.5 由听、说、读、写四项综合计算。</p><p class="muted"><a href="https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail"'+external+'>查看雅思官方评分说明</a>。实际进度取决于练习、起点和反馈。</p>')+'</div>'
}

function highlightTools() {
  return '<div class="highlight-tools" id="highlight-tools"><span class="muted">拖选英文字幕后高亮</span><div class="actions">' +
    btn('黄色','paint-selection','outline tint-gold','data-color="gold" disabled aria-label="用黄色高亮所选单词"') +
    btn('绿色','paint-selection','outline tint-sage','data-color="sage" disabled aria-label="用绿色高亮所选单词"') +
    btn('取消高亮','paint-selection','quiet','data-color="clear" disabled') + '</div></div>'
}
function selectedWords() {
  const selection=window.getSelection()
  const container=$('transcript')
  if (!container || !selection || selection.isCollapsed || !selection.rangeCount) return []
  const range=selection.getRangeAt(0)
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return []
  const count=(line,node,offset)=>{
    const prefix=document.createRange()
    prefix.selectNodeContents(line)
    prefix.setEnd(node,offset)
    return prefix.toString().length
  }
  return [...container.querySelectorAll('.english')].flatMap(line=>{
    if (!range.intersectsNode(line)) return []
    const start=line.contains(range.startContainer) ? count(line,range.startContainer,range.startOffset) : 0
    const end=line.contains(range.endContainer) ? count(line,range.endContainer,range.endOffset) : line.textContent.length
    return [...line.querySelectorAll('.word')].flatMap(word=>{
      const at=Number(word.dataset.offset)
      return end>start && at<end && at+word.textContent.length>start ? [{i:line.dataset.cueIndex,at}] : []
    })
  })
}
function syncHighlightTools() {
  const buttons=$('highlight-tools')?.querySelectorAll('button')
  if (!buttons) return
  const words=selectedWords()
  const marks=s.highlights?.[current?.id] || {}
  buttons.forEach(button=>{
    button.disabled=!words.length || button.dataset.color==='clear' && !words.some(({i,at})=>marks[i]?.[at])
  })
}
function paintSelection(color) {
  const words=selectedWords()
  if (!words.length || !current) return
  s.highlights=s.highlights || {}
  const episode=s.highlights[current.id] || {}
  for (const {i,at} of words) {
    const line=episode[i] || {}
    if (color==='clear') delete line[at]
    else line[at]=color
    if(Object.keys(line).length) episode[i]=line
    else delete episode[i]
  }
  if(Object.keys(episode).length) s.highlights[current.id]=episode
  else delete s.highlights[current.id]
  const top=$('transcript')?.scrollTop || 0
  window.getSelection()?.removeAllRanges()
  persist()
  render()
  if ($('transcript')) $('transcript').scrollTop=top
  toast(color==='clear'?'已取消所选词的高亮。':'已高亮所选单词。')
}
document.addEventListener('selectionchange',syncHighlightTools)
document.addEventListener('pointerdown',event=>{
  if (event.target.closest('#highlight-tools button:not(:disabled)')) event.preventDefault()
})

function examDefaults(board) {
  return {board,year:'all',group:'all',origin:'all',status:'all',question:''}
}
function examSettings() {
  return s.examFilters && Object.prototype.hasOwnProperty.call(boards,s.examFilters.board) ? s.examFilters :
    examDefaults({'4':'cet4','6':'cet6','65':'ielts'}[s.level] || 'cet4')
}
const localExamBank=()=>[...examImports.values(),...examPapers]
function showExamLibrary() {
  const settings=examSettings()
  return libraryView({items:[...localExamBank(),...examSources],settings,progress:s.examResults,favorites:s.favorites,
    plan:nextExamPlan(localExamBank(),s.examResults,settings.board,examSources)})
}
function examPlanForProfile() {
  const target=examSettings().board
  return planPanel(target,nextExamPlan(localExamBank(),s.examResults,target,examSources))
}
function submitExam(form) {
  const paper=current
  if(paper?.kind!=='exam' || key()!==paper.id || !paper.questions.length) return
  const values=paper.questions.map((_,i)=>String(form.get('q-'+i) || '').trim())
  if (!values.some(Boolean)) return toast('请至少作答一道题。')
  const score=gradePaper(paper,values)
  const previous=s.examResults[paper.id]
  s.examResults[paper.id]={latest:score,attempts:(previous?.attempts || 0)+1}
  examRetakes.delete(paper.id)
  examDrafts.delete(paper.id)
  audio.pause()
  record(0,score.correct.filter(Boolean).length*5,1,'exam:'+paper.id)
  render()
}
function manualExamDialog(id) {
  const source=examSources.find(item=>item.id===id)
  if(!source || !source.month || source.group==='legacy' || !['cet4','cet6'].includes(source.board)) return
  const old=s.examResults[id]?.sections || {}
  message('记录真题成绩', form('<p class="muted">'+e(source.title)+' · 填写已做题型的正确题数。</p>'+
    Object.entries(sections[source.board]).map(([group,[label,first,last]])=>{
      const total=last-first+1
      return '<label class="field">'+e(label)+'（共 '+total+' 题）<input type="number" min="0" max="'+total+'" name="'+group+'" value="'+e(old[group]?.correct ?? '')+'"></label>'
    }).join('')+'<input type="hidden" name="paper" value="'+e(id)+'">','保存真题成绩','exam-log-form'))
}
function logExamResult(form) {
  const source=examSources.find(item=>item.id===form.get('paper'))
  if(!source) return
  const rows={}
  for (const [group,[,first,last]] of Object.entries(sections[source.board])) {
    const raw=form.get(group), total=last-first+1, correct=Number(raw)
    if(raw!==null && raw!=='' && Number.isInteger(correct) && correct>=0 && correct<=total) rows[group]={correct,total}
  }
  if(!Object.keys(rows).length) return toast('请至少填写一个题型的正确题数。')
  s.examResults[source.id]={manual:true,sections:rows}
  record(0,0,1)
  modal.close()
  render()
  toast('成绩已记录，专项计划会优先推荐薄弱题型。')
}
function examImportDialog() {
  const board=examSettings().board
  message('导入历年听力资料',form(
    select('exam-import-board','考试',Object.entries(boards).filter(([k])=>k!=='kaoyan').map(([k,v])=>[k,v[0]]),board) +
    '<div class="grid-two"><label class="field">年份<input type="number" min="1987" max="2100" name="year" value="'+new Date().getFullYear()+'" required></label>' +
    '<label class="field">月份（可选）<input type="number" min="1" max="12" name="month"></label></div>' +
    field('套号或版本（可选）','number')+field('材料名称','title','',true)+
    '<label class="field">题型<select id="exam-import-group"></select></label>' +
    '<label class="field">音频文件<input name="audio" type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg" required></label>' +
    '<label class="field">双语或英文 SRT／VTT（可选）<input name="transcript" type="file" accept=".srt,.vtt"></label>' +
    '<label class="field">标准答案（可选）<textarea name="keys" rows="4" placeholder="1=A&#10;2=C&#10;31=notebook | note book" maxlength="5000"></textarea></label>' +
    '<p class="muted">每行写题号=答案。多种拼法用 | 分开。题干请配合自己的题册查看。文件保存在当前档案。</p>','导入考试资料','exam-import-form'))
  renderImportGroups($('exam-import-board').value)
}
function renderImportGroups(board) {
  const box=$('exam-import-group')
  box.innerHTML=option('','整套听力','')+Object.entries(sections[board] || {}).map(([k,v])=>option(k,v[0],'')).join('')
}
async function importExam(form,data) {
  const button=form.querySelector('button[type=submit]')
  const board=$('exam-import-board').value, group=$('exam-import-group').value
  const audioFile=data.get('audio'), transcript=data.get('transcript')
  const title=data.get('title').trim(), year=data.get('year')
  if (!title || !audioFile?.size || !/^\d{4}$/.test(year)) return toast('请填写名称并选择有效音频。')
  button.disabled=true
  try {
    if (audioFile.size>150*1024*1024) throw Error('单个音频需小于 150 MB。')
    if (transcript?.size>5*1024*1024) throw Error('字幕文件需小于 5 MB。')
    const rows=String(data.get('keys') || '').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)
    const questions=[]
    const nums=new Set()
    for (const row of rows) {
      const match=row.match(/^(\d{1,2})\s*[=＝]\s*(.+)$/)
      if (!match || !Number(match[1]) || nums.has(Number(match[1]))) throw Error('请检查每行的题号与答案，题号需要唯一。')
      const n=Number(match[1]), answer=match[2].trim(), range=sections[board]?.[group]
      if (n>(board==='ielts'?40:25) || range && (n<range[1] || n>range[2])) throw Error('第 '+n+' 题不在所选考试或题型的题号范围内。')
      nums.add(n)
      const multiple=/^[a-d]$/i.test(answer) && board!=='ielts'
      const answers=multiple?[String(answer.toUpperCase().charCodeAt(0)-65)]:answer.split('|').map(x=>x.trim()).filter(Boolean)
      if (!answers.length) throw Error('答案栏不能为空。')
      questions.push({number:n,prompt:'请对照原题册作答',answers,...(multiple?{options:['选项 A','选项 B','选项 C','选项 D']}:{})})
    }
    questions.sort((a,b)=>a.number-b.number)
    const attachment=transcript?.size ? parseTimed(await transcript.text(),'auto') : []
    if (transcript?.size && !attachment.length) throw Error('无法读取字幕时间轴。')
    const paper={id:'exam-local-'+uid(),board,group,kind:'exam',cat:'news',examOrigin:'local',source:'本机资料',
      title,year,month:String(data.get('month') || ''),number:String(data.get('number') || '').trim().slice(0,24),
      cues:attachment,questions,terms:[],blob:audioFile}
    await materialTransaction('readwrite',store=>store.put(paper))
    ingestMaterial(paper)
    s.examFilters=examDefaults(board);persist()
    if (button.isConnected&&modal.open) modal.close()
    go('exam-paper',paper.id)
    toast('已导入考试资料。')
  } catch(error){toast(error.message || '考试资料导入失败。')}
  finally{button.disabled=false}
}

let exportSnapshot
function transcriptDialog() {
  if (!current || !cues.length) return
  const rows=cues.map((cue,index)=>({cue,index})).filter(({cue})=>cue.en || cue.zh)
  if (!rows.length) return toast('没有可导出的字幕。')
  const item=current, marks=s.highlights?.[current.id] || {}
  exportSnapshot={item,rows,marks,byIndex:new Map(rows.map(({index,cue})=>[index,cue]))}
  const paired=rows.filter(({cue})=>cue.en && cue.zh).length
  const hasEnglish=rows.some(({cue})=>cue.en)
  const hasChinese=rows.some(({cue})=>cue.zh)
  const seenWords=highlightedVocabulary(rows,marks).length
  const languages=[...(hasEnglish && hasChinese ? [['both','中英双语']] : []), ...(hasEnglish ? [['en','仅英文']] : []), ...(hasChinese ? [['zh','仅中文']] : [])]
  message('导出听力原文','<p class="muted">'+e(item.zh || item.title)+'</p>'+
    (paired<rows.length ? '<p class="notice">'+(hasChinese ? '这份稿件有 '+paired+' / '+rows.length+' 句同时含中英文。' : '当前只有英文稿，可以导入中文字幕后再导出双语。')+'</p>' : '')+
    '<form class="fields" id="transcript-export-form">'+select('export-language','导出语言',languages,languages[0][0])+
    '<div class="actions export-options"><label><input type="checkbox" name="timestamps" checked> 保留时间戳</label>'+
    '<label><input type="checkbox" name="vocab" checked> 文末附高亮词汇'+(seenWords?'（'+seenWords+' 个）':'')+'</label></div>'+
    '<div class="export-selection-head"><strong id="export-count"></strong><div class="actions">'+
    btn('全选','transcript-pick','quiet','type="button" data-key="all"')+
    btn('清空','transcript-pick','quiet','type="button" data-key="none"')+'</div></div>'+
    '<div class="export-lines" aria-label="选择导出的字幕">'+
    rows.map(({index,cue})=>'<label class="export-line"><input type="checkbox" name="line" value="'+index+'" checked>'+
      '<time>'+clock(cue.start)+'</time><span>'+e(cue.en || cue.zh)+'</span></label>').join('')+'</div>'+
    '<div class="actions"><button class="btn primary" type="submit" value="pdf">导出 A4 PDF</button>'+
    '<button class="btn outline" type="submit" value="text">导出 TXT</button></div></form>')
  updateExportCount()
}
function updateExportCount() {
  const f=$('transcript-export-form')
  if (!f) return
  const boxes=f.querySelectorAll('input[name="line"]')
  const language=$('export-language').value
  let picked=0
  boxes.forEach(box=>{
    const cue=exportSnapshot.byIndex.get(Number(box.value))
    box.disabled=language==='en' && !cue.en || language==='zh' && !cue.zh
    if (box.checked && !box.disabled) picked++
  })
  $('export-count').textContent='已选 '+picked+' / '+boxes.length+' 句'
  for (const button of f.querySelectorAll('button[type="submit"]')) button.disabled=picked===0 || f.dataset.exporting==='true'
}
async function exportTranscript(form, data, format) {
  const snapshot=exportSnapshot
  const chosen=new Set(data.getAll('line').map(Number))
  const rows=snapshot.rows.filter(row=>chosen.has(row.index))
  if (!rows.length) return toast('请选择至少一句字幕。')
  if (form.dataset.exporting==='true') return
  form.dataset.exporting='true'
  updateExportCount()
  const language=$('export-language').value
  const marks=snapshot.marks
  const vocabulary=data.has('vocab') ? highlightedVocabulary(rows,marks) : []
  try {
    const words=await Promise.all(vocabulary.map(async word=>{
      const key=word.term.toLowerCase()
      const savedMeaning=s.books.flatMap(book=>book.items).find(item=>norm(item.en)===norm(key))?.zh
      const meaning=snapshot.item.vocab?.[key] || savedMeaning || (await definition(key))?.[1]?.[0] || ''
      return {...word,meaning}
    }))
    if (!form.isConnected || !modal.open || exportSnapshot!==snapshot) return
    const options={...snapshot,rows,marks,words,language,timestamps:data.has('timestamps')}
    const base=String(snapshot.item.zh || snapshot.item.title).replace(/[\\/:*?"<>|]+/g,' ').trim().slice(0,70) || '回声岛'
    if (format==='text') {
      const content=transcriptText(options)
      if (native?.saveText) native.saveText(base+' - 听力原文.txt',content)
      else saveFile(base+' - 听力原文.txt',content,'text/plain;charset=utf-8')
      modal.close()
      return
    }
    $('print-sheet').innerHTML=transcriptHtml(options)
    modal.close()
    if (native?.printTranscript) native.printTranscript(base+' - 听力原文')
    else if (native) native.printSheet()
    else window.print()
  } catch { toast('导出未完成，请重试。') }
  finally { delete form.dataset.exporting; if (form.isConnected) updateExportCount() }
}

setInterval(maybeRemind,30000)
init()
