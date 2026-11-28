import {escape as e, normalized as norm, clock, localDay, dayOffset, parseTimed, pairTimed, wordTokens} from './core.js?v=1.4.0'
import {boards,sections,libraryView} from './exam-ui.js?v=1.4.0'
import {highlightedVocabulary, transcriptHtml, transcriptText} from './transcript-export.js?v=1.4.0'

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
const navigation = [['home','首页'],['library','听力馆'],['exam','考试听力'],['books','生词本'],['plan','学习计划']]
const defaults = () => ({
  level:'4', mode:'both', font:22, rate:1, goal:12, remind:'', minor:true, roadmap:null, examFilters:null, examResults:{},
  library:{cat:'all', kind:'all', level:'all', show:36}, history:{}, marks:{}, highlights:{}, favorites:{}, events:{}, wins:{},
  books:[{id:'words', name:'我的生词', items:[]}, {id:'phrases', name:'常用短语', items:[]}], last:''
})
function readState() {
  try { return {...defaults(), ...JSON.parse(localStorage.getItem(storageKey) || '{}')} } catch { return defaults() }
}
let s = readState()
let sources = {}, lessons = [], ready = false, search = ''
const examImports = new Map()
let examPapers = [], clips = []
const index = new Map(), localMaterials = new Map(), attachments = new Map(), dictionaries = new Map()
let current = null, cues = [], active = -1, loop = false, follow = true, transcriptLabel = ''
let started = 0, lastMediaTime = 0, checkpoint = 0, pendingTime = 0, resumeAt = 0, mediaGeneration = 0
let bookId = s.books[0]?.id || '', flashIndex = 0, reveal = false
let packedUrl = '', packedPending = null, packedController = null
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
const art = cat => '<span class="art" data-cat="' + e(cat) + '">' + icon(icons[cat] ? cat : 'library') + '</span>'
const btn = (label, action, classes = '', extra = '') => '<button class="btn ' + classes + '" data-action="' + action + '" ' + extra + '>' + label + '</button>'
const goBtn = (label, view, classes = '', arg = '') => '<button class="btn ' + classes + '" data-go="' + view + '" data-key="' + e(arg) + '">' + label + '</button>'
const option = (key, title, at) => '<option value="' + e(key) + '"' + (String(at) === String(key) ? ' selected' : '') + '>' + e(title) + '</option>'
const select = (field, label, options, current) => '<label class="field">' + label + '<select id="' + field + '">' + options.map(([k,v]) => option(k,v,current)).join('') + '</select></label>'
const heading = (title, sub = '', actions = '') => '<div class="headrow"><div><h1 class="page-title">' + title + '</h1>' + (sub ? '<p class="page-sub">' + sub + '</p>' : '') + '</div>' + actions + '</div>'
const allItems = () => [...lessons, ...clips, ...examPapers, ...examImports.values(), ...localMaterials.values()]
const grade = item => item.kind==='clip' ? '真人短句' : item.kind==='exam' ? boards[item.board]?.[0] || '考试听力' : item.kind==='local' ? '本机音频' : '双语短课'
const type = item => (attachments.get(item.id)?.cues || item.cues)?.some(cue=>cue.en && cue.zh) ? '双语字幕' : '可附字幕'
const episodeCard = item => '<button class="card episode" data-go="episode" data-key="' + e(item.id) + '"><span class="ep-top">' + art(item.cat) + '<span class="tag">' + type(item) + '</span></span><span class="ep-title" lang="' + (item.zh ? 'zh' : 'en') + '">' + e(item.zh || item.title) + '</span><small>' + e(item.zh ? item.title : grade(item)) + ' · ' + e(item.duration ? clock(item.duration) : grade(item)) + '</small></button>'
function home() {
  const next = index.get(s.last) || lessons.find(item => item.cat === 'food' && item.level === s.level) || lessons[0]
  const mins = Math.floor(today().seconds / 60)
  return '<div class="dashboard"><section class="hero"><span class="eyebrow">ECHO FIELD · 英语听力</span><h1>让英语落进<br>日常的声音里。</h1><p>从一句听得懂的英语开始。听完整段，也可以停下来，一句一句练。</p>' +
    '<div class="actions hero-actions">' + (next ? goBtn(icon('play') + (s.last && index.has(s.last) ? '继续收听' : '开始第一课'), 'episode', 'gold', next.id) : goBtn('进入听力馆','library','gold')) + goBtn('新手怎么学','guide','hero-guide') + '</div>' +
    '</section><section class="panel goal"><div class="goal-head"><h2>今日学习</h2>' + btn(icon('plan'),'checkins','quiet calendar-open','aria-label="查看学习打卡日历" title="查看学习打卡日历"') + '</div><div class="goal-numbers"><strong>' + mins + '</strong> / ' + s.goal + ' 分钟</div><progress aria-label="今日听力进度" max="' + s.goal + '" value="' + Math.min(mins,s.goal) + '"></progress><div class="goaltile">' + icon('practice') + '<span><strong>' + streak() + '</strong> 天连续收听</span></div>' + goBtn('查看学习计划','plan','outline') + '</section></div>' +
    '<section><div class="section-heading"><div><h2>按主题听</h2><p class="section-sub">找到你愿意反复听的内容</p></div><button class="text-btn" data-action="all-library">全部资源</button></div><div class="categories">' +
    Object.entries(sources).map(([cat, source]) => '<button class="card category" data-action="category" data-key="' + cat + '">' + art(cat) + '<span><strong>' + e(source[0]) + '</strong><small>' + allItems().filter(item => item.cat === cat).length + ' 集</small></span></button>').join('') +
    '</div></section><section><div class="section-heading"><div><h2>先听这几课</h2><p class="section-sub">' + e(levels[s.level]) + ' · 双语逐句精听</p></div><button class="text-btn" data-action="lesson-library">全部精听课</button></div><div class="episode-grid">' +
    lessons.filter(item => item.level === s.level).map(episodeCard).join('') + '</div></section>'
}
function library() {
  const f=s.library, needle=search.trim().toLowerCase()
  const kinds={all:'全部材料',clip:'真人短句',lesson:'双语短课',exam:'考试听力',local:'本机导入',fav:'收藏'}
  if (!(f.kind in kinds)) f.kind='all'
  const available=allItems().filter(item=>
    (f.cat==='all'||item.cat===f.cat) &&
    (f.kind==='all'||(f.kind==='fav'?s.favorites[item.id]:item.kind===f.kind || f.kind==='local'&&item.examOrigin==='local')) &&
    (!f.level||f.level==='all'||item.level===f.level) &&
    (!needle||[item.title,item.zh,sources[item.cat]?.[0],item.date,item.year].some(x=>String(x||'').toLowerCase().includes(needle))))
  libraryQueue=available.map(item=>item.id)
  return heading('听力馆','选一段音频，边听边看中英字幕。',btn('导入音频','import-material','outline'))+
    '<div class="filters"><select id="filter-cat" aria-label="主题">'+option('all','全部主题',f.cat)+Object.entries(sources).map(([k,v])=>option(k,v[0],f.cat)).join('')+
    '</select><select id="filter-kind" aria-label="材料类型">'+Object.entries(kinds).map(([k,v])=>option(k,v,f.kind)).join('')+
    '</select><span class="btn quiet">'+available.length+' 段</span></div>'+
    (available.length?'<div class="episode-grid">'+available.slice(0,f.show).map(episodeCard).join('')+'</div>'+
    (available.length>f.show?'<div class="section-heading">'+btn('显示更多','more','outline')+'</div>':''):'<p class="empty">没有匹配的听力。请调整筛选条件。</p>')
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
  const favorite = Boolean(s.favorites[item.id])
  const subtitleBox = s.mode === 'off' ? '<p class="notice">字幕已关闭。可继续盲听或打开字幕。</p>' :
    cues.length ? '<div id="transcript" class="transcript" aria-label="逐句字幕">' + cues.map(cueRow).join('') + '</div>' :
    '<p class="notice">' + e(transcriptLabel || '这段暂无字幕。可导入已有的 SRT 或 VTT。') + '</p>'
  return '<div class="detail-head">' + art(item.cat) + '<div><h1 class="page-title">' + e(item.zh || item.title) + '</h1><div class="detail-meta"><span>' + e(item.zh ? item.title : grade(item)) + '</span><span class="tag">' + e(grade(item)) + '</span>' + (item.date ? '<time>' + e(item.date) + '</time>' : '') + '</div></div></div>' +
    '<div class="detail-body"><section class="panel"><div class="section-heading" style="margin-top:0"><h2>逐句精听</h2>' + btn(favorite ? '已收藏' : '收藏','favorite','outline','aria-pressed="' + favorite + '"') + '</div>' +
    '<div class="actions">' + btn(icon(audio.paused ? 'play' : 'pause') + '<span>' + (audio.paused ? '播放' : '暂停') + '</span>', 'toggle','primary','id="detail-play"') +
    (item.kind === 'local' || item.examOrigin === 'local' ? btn('导入字幕','attach','outline') : '') +
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
    btn('上一段','previous','outline') + btn('下一段','next','outline') + '</div></section></aside></div>'
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
  $('dock-source').textContent = grade(current) + (sleepUntil || sleepEnd ? ' · 定时已开' : '')
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
  if (!queue.includes(item.id)) {
    queue=allItems().filter(ep=>ep.kind===item.kind && (item.kind==='exam'?ep.board===item.board:ep.cat===item.cat)).map(ep=>ep.id)
  }
  packedController?.abort()
  packedPending=null
  audio.removeAttribute('src')
  audio.load()
  if (packedUrl) URL.revokeObjectURL(packedUrl)
  packedUrl=''
  const generation = ++mediaGeneration
  if (item.bytes) preparePackedAudio(item,generation)
  else audio.src=item.audio
  audio.playbackRate = s.rate
  s.last = item.id
  persist()
  updateDock()
}
function preparePackedAudio(item,generation) {
  const abort = new AbortController()
  packedController=abort
  const timer=setTimeout(()=>abort.abort(),18000)
  const [offset,length]=item.bytes
  const path=native?'https://lures2019.github.io/toolbox/echo-field/'+item.audio:item.audio
  const parsed=fetch(path,{headers:{Range:'bytes='+offset+'-'+(offset+length-1)},signal:abort.signal}).then(async response=>{
    if(!response.ok) throw Error('Audio unavailable')
    const received=await response.arrayBuffer()
    const bytes=response.status===206?received:received.slice(offset,offset+length)
    if(bytes.byteLength!==length) throw Error('Invalid audio range')
    if(generation!==mediaGeneration) return false
    packedUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'}))
    audio.src=packedUrl
    packedPending=null
    return true
  }).catch(()=>{
    if(generation===mediaGeneration) packedPending=null
    return false
  }).finally(()=>clearTimeout(timer))
  packedPending=parsed
  return parsed
}
function seekTo(time) {
  if (!current) return
  audio.currentTime = Math.max(0,Math.min(Number.isFinite(audio.duration) ? audio.duration : Infinity,time))
  updateCues(true)
}
async function playAudio() {
  if (!current) return
  const item=current, generation=mediaGeneration
  checkSleep()
  if (item.bytes && !packedUrl) {
    const playable=await (packedPending || preparePackedAudio(item,generation))
    if(!playable){
      if(generation===mediaGeneration)toast('音频暂时无法播放，请重试。')
      return
    }
  }
  if(generation!==mediaGeneration)return
  if(audio.error) audio.load()
  audio.play().catch(()=>{if(generation===mediaGeneration)toast('音频暂时无法播放，请重试。')})
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
  if (data.id.startsWith('feed:')) return
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
  box.innerHTML = (ipa ? '<p class="muted">/' + e(ipa) + '/</p>' : '') +
    (meanings.length ? '<p class="common">' + e(meanings[0]) + '</p>' + (meanings.length > 1 ? '<p class="muted">' + e(meanings.slice(1).join(' · ')) + '</p>' : '') +
      '<p class="muted">' + (exact ? '课文语境释义' : '离线释义') + '</p>' : '<p class="muted">未找到离线释义，可以填写自己的释义。</p>') +
    '<div class="actions">' + btn('朗读','say','outline','data-word="' + e(word) + '"') + '</div>'
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
    book.items.map(w=>'<div class="book-row"><div class="book-entry"><strong lang="en">' + e(w.en) + '</strong><p>' + e(w.zh) + '</p><p>翻卡 ' + w.reviews + ' · 朗读 ' + w.speak + '</p></div><div class="actions">' +
       btn('朗读','book-say','outline','data-key="' + e(w.id) + '"') + btn('编辑','book-edit','quiet','data-key="' + e(w.id) + '"') + '</div></div>').join('') +
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
  $('print-sheet').innerHTML = '<header class="print-header"><p>回声岛 · ECHO FIELD</p><h1>' + e(book.name) + '</h1><p>' + localDay() + ' · ' + book.items.length + ' 个词条' + (blank ? ' · 默写练习' : ' · 英汉对照') +
    '</p></header><table class="print-table"><thead><tr><th style="width:26%">英文</th><th style="width:29%">' + (blank ? '中文默写' : '中文释义') + '</th><th>' + (blank ? '例句默写' : '例句') + '</th></tr></thead><tbody>' +
    book.items.map(w=>'<tr><td>' + e(w.en) + '</td><td class="' + (blank ? 'practice' : '') + '">' + (blank ? '' : e(w.zh)) + '</td><td>' + (blank ? '' : e(w.example)) + '</td></tr>').join('') + '</tbody></table>'
  modal.close()
  setTimeout(() => { if (native) native.printSheet(); else window.print() },90)
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
    '<section class="panel stack"><h2>今日任务</h2><div class="stat-grid"><div class="stat"><strong>' + time + '/' + s.goal + '</strong> 听力分钟</div><div class="stat"><strong>' + streak() + '</strong> 连续收听</div><div class="stat"><strong>' + due + '</strong> 待复习词条</div></div>' +
    '<div class="actions">' + goBtn('去听力馆','library','primary') + goBtn('复习生词','books','outline') + '</div><p class="muted">建议每天 ' + suggestion + ' 分钟，根据近 7 天收听记录更新。</p>' +
    '<div class="actions">' + btn('采用建议时长','recommended-goal','outline') + btn('编辑目标与提醒','plan-dialog','outline') + '</div></section>' +
    '<section class="panel stack"><h2>最近七天</h2>' +
    '<div class="week" aria-label="最近七天听力分钟">' + week.map(d=>{
      const seconds = s.events[d]?.seconds || 0
      return '<div title="' + d + ' · ' + Math.floor(seconds/60) + ' 分钟"><span>' + Math.floor(seconds/60) + '</span><i style="--bar:' + Math.min(100,Math.round(seconds/60/s.goal*100)) + '%"></i><small>' + d.slice(-2) + '日</small></div>'
    }).join('') + '</div></section></div>' +
    roadmapView() + '<div class="section-heading"><h2>设置与数据</h2></div><section class="panel stack"><p class="muted">学习数据保存在当前设备。导入备份可以在设备之间迁移生词本和进度。</p><div class="actions">' +
    btn('导出备份','backup','outline') + btn('导入备份','restore','outline') +
    (!native ? '<a class="btn outline" href="echo-field.apk" download>安卓安装包</a>' : '<a class="btn outline" href="https://lures2019.github.io/toolbox/echo-field/"' + external + '>打开网页版</a>') +
    '<a class="btn quiet" href="' + (native ? 'https://lures2019.github.io/toolbox/' : '/toolbox/') + '">返回百宝箱</a></div></section>'
}
function planDialog() {
  message('目标与提醒', form(
    select('plan-level','课程难度',Object.entries(levels),s.level) +
    '<label class="field">每日听力分钟<input name="minutes" type="number" min="3" max="120" value="' + Number(s.goal) + '" required></label>' +
    '<label class="field">每日提醒时间<input name="remind" type="time" value="' + e(s.remind) + '"></label>' +
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
function render() {
  if (!ready) return
  const [name] = route()
  if(name==='exam-paper'){go('episode',key());return}
  const view=name==='practice'?'library':['library','episode','books','plan','guide','exam'].includes(name)?name:'home'
  const item=view==='episode'?index.get(key()):null
  const selected=view==='episode'?(item?.kind==='exam'?'exam':'library'):view==='guide'?'home':view
  $('nav').innerHTML=navigation.map(([k,v])=>'<a class="side-item" href="#'+k+'"'+(selected===k?' aria-current="page"':'')+'>'+icon(k)+v+'</a>').join('')
  $('level-chip').textContent=levels[s.level]
  if(view==='episode'){
    if(item) selectEpisode(item)
    page.innerHTML=detail(item)
    if(item && cues.length) updateCues(true)
  } else page.innerHTML={home,library,books:booksView,plan,guide,exam:showExamLibrary}[view]()
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
  'print-dialog':()=>message('导出生词本 PDF','<p class="muted">打印时选择 A4，然后用系统的「另存为 PDF」。</p><div class="actions">'+btn('英汉对照版','print','primary')+btn('默写练习版','print','outline','data-key="blank"')+'</div>'),
  print:el=>printBook(el.dataset.key==='blank'),
  'recommended-goal':()=>{s.goal=planned();persist();render()},
  'plan-dialog':planDialog, calendar,
  'starter-plan':()=>{s.goal=10;persist();toast('已设置每天 10 分钟的听力目标。');go('plan')},
  'starter-travel':()=>{s.library={cat:'travel',kind:'lesson',level:'4',show:36};search=$('search-box').value='';persist();go('library')},
  'starter-lesson':()=>{const lesson=lessons.find(item=>item.id==='food-4');if(lesson){queue=[];go('episode',lesson.id)}},
  'exam-board':el=>{s.examFilters=examDefaults(el.dataset.key);persist();render()},
  'exam-import':examImportDialog,
  'exam-favorite':el=>{const id=el.dataset.key;s.favorites[id]=!s.favorites[id];persist();render()},
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
    if (el.dataset.go==='episode' && el.closest('.episode-grid,.exam-grid')) {
      queue = ['library','exam'].includes(route()[0]) ? [...libraryQueue] : []
    }
    go(el.dataset.go,el.dataset.key)
  } else actions[el.dataset.action]?.(el)
})
document.addEventListener('submit', event => {
  event.preventDefault()
  const form = event.target, f = new FormData(form)
  switch(form.id) {
    case 'search': search=$('search-box').value;s.library={cat:'all',kind:'all',level:'all',show:36};go('library');break
    case 'material-form': importMaterial(form,false);break
    case 'exam-import-form': importExam(form,f);break
    case 'transcript-export-form': exportTranscript(form,f,event.submitter?.value);break
    case 'profile-form': saveProfile(f.get('name'));break
    case 'roadmap-form': saveRoadmap(f);break
    case 'attach-form': importMaterial(form,true);break
    case 'word-form': bookForm(form);break
    case 'book-form': if(f.get('name').trim()){bookId=addBook(f.get('name').trim().slice(0,32)).id;reveal=false;flashIndex=0;persist();modal.close();render()}break
    case 'plan-form':
      s.level=$('plan-level').value;s.goal=Number(f.get('minutes'));s.remind=f.get('remind')
      if(native)syncReminders();persist();modal.close();render();maybeRemind();break
  }
})
document.addEventListener('change',event=>{
  const {id,value,checked}=event.target
  if (event.target.closest('#transcript-export-form')) updateExportCount()
  const examFilter={'exam-year':'year','exam-group':'group','exam-kind':'kind'}[id]
  if(examFilter){s.examFilters={...examSettings(),[examFilter]:value};persist();render();$(id)?.focus();return}
  if(id==='exam-import-board'){renderImportGroups(value);return}
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
async function init() {
  $('search-icon').innerHTML=icon('search')
  if(native){$('apk-link').hidden=true;document.querySelector('.side-foot a:last-child').href='https://lures2019.github.io/toolbox/'}
  const [config,local,recorded,papers,imports]=await Promise.allSettled([
    json('data/listening-topics.json'),json('data/lessons.json'),json('data/listening-clips.json'),json('data/exam-papers.json'),
    materialTransaction('readonly',store=>store.getAll())
  ])
  if(config.status==='fulfilled') sources=config.value
  if(local.status==='fulfilled') lessons=local.value
  if(recorded.status==='fulfilled') clips=recorded.value
  if(papers.status==='fulfilled') examPapers=papers.value
  if(imports.status==='fulfilled') imports.value.forEach(ingestMaterial)
  allItems().forEach(item=>index.set(item.id,item))
  if(!allItems().length){page.innerHTML='<p class="notice">听力库暂时未加载，请刷新后重试。</p>';return}
  ready=true;render();maybeRemind()
}

function profilesDialog() {
  message('学习档案','<p class="muted">每个人的目标、进度、生词本按档案保存。现在使用本机档案，换设备时可以导出学习备份。</p>' +
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
  {months:'第 1–2 月',title:'打好听辨基础',learn:'短课先盲听，再开字幕对照。每周做两次逐句精听，录下同一段话比较节奏。',test:'听完一段 2–3 分钟的慢速材料，能用英文说出主题和三个细节，再对照稿件。',level:'4',cat:'food'},
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
    '</section>'
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
    '</div>'+
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
    card('晚上 · 5–10 分钟','<p>重听早上的短段，翻两三张生词卡。周末有空时，找同伴练一轮真实对话，或录一段自我介绍回听。</p>')+'</div>'+
    '<div class="section-heading"><h2>怎么坚持下来</h2></div><section class="panel stack guide-card"><ul class="guide-list"><li><strong>忙到只剩 5 分钟：</strong> 重听一分钟，跟读两句，复习一个词。今天做到这里就算完成。</li><li><strong>漏了一天：</strong> 第二天接着原计划做。打开上次那一课，先听一分钟。</li><li><strong>太难想放弃：</strong> 换同主题更短的音频，降到 0.75×，再开英文字幕。连续几次能说出主题后，回到正常速度。</li><li><strong>感觉进步慢：</strong> 每两周录一次同主题的 60 秒复述。对比自己是否更少停顿、能多讲几个细节。</li></ul></section>'+
    '<div class="section-heading"><h2>每个阶段能检验什么</h2></div><div class="grid-two">'+
    card('入门 · 先能开口','<p>拿日常短课练到不看稿也能自我介绍、点餐、问路。跟伙伴模拟一次，遇到没听清会用 <span lang="en">Could you say that again?</span> 请对方重复。</p>',btn('练旅行对话','starter-travel','outline'))+
    card('实用 · 旅行能处理变化','<p>练听懂登机口改动、酒店入住和路线说明。试着完成一次酒店角色扮演，主动确认日期、价格或地点，再复述关键信息。</p>')+
    card('进阶 · 聊熟悉的话题更从容','<p>每周至少两次对话练习。试着围绕一个话题聊 10–20 分钟，说出观点、给例子、接两三个追问。请对方指出哪里最难听懂，下一周只改一两处。</p>',goBtn('制定 12 个月路线','plan','outline'))+
    card('考试 · 冲刺雅思口语 6','<p>按真实题型练 Part 1–3。试着在 Part 2 围绕题目讲满两分钟，用例子把意思说清楚。至少做一次完整口语模考，拿到对流利度、词汇、语法和发音的反馈。总分 6.5 由听、说、读、写四项综合计算。</p><p class="muted">实际进度取决于练习、起点和反馈。</p>')+'</div>'
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
  return {board,year:'all',group:'all',kind:'all'}
}
function examSettings() {
  const previous=s.examFilters
  const board=previous?.board && Object.prototype.hasOwnProperty.call(boards,previous.board)?previous.board:({'4':'cet4','6':'cet6','65':'ielts'}[s.level] || 'cet4')
  if(previous?.board!==board) return examDefaults(board)
  const hasYear=[...examImports.values()].some(item=>item.board===board && item.year===previous.year)
  return {board,year:hasYear?previous.year:'all',group:Object.prototype.hasOwnProperty.call(sections[board],previous.group)?previous.group:'all',kind:previous.kind==='fav'?'fav':'all'}
}
function showExamLibrary() {
  const view=libraryView({items:[...examImports.values(),...examPapers],settings:examSettings(),favorites:s.favorites})
  libraryQueue=view.ids
  return view.html
}
function examImportDialog() {
  const board=examSettings().board
  message('导入历年听力资料',form(
    select('exam-import-board','考试',Object.entries(boards).map(([k,v])=>[k,v[0]]),board) +
    '<div class="grid-two"><label class="field">年份<input type="number" min="1987" max="2100" name="year" value="'+new Date().getFullYear()+'" required></label>' +
    '<label class="field">月份（可选）<input type="number" min="1" max="12" name="month"></label></div>' +
    field('套号或版本（可选）','number')+field('材料名称','title','',true)+
    '<label class="field">题型<select id="exam-import-group"></select></label>' +
    '<label class="field">音频文件<input name="audio" type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg" required></label>' +
    '<label class="field">英文或双语字幕（SRT／VTT）<input name="transcript" type="file" accept=".srt,.vtt"></label>'+
    '<label class="field">单独中文字幕（可选）<input name="chinese" type="file" accept=".srt,.vtt"></label>'+
    '<p class="muted">导入后可直接收听、看原文和点词。文件保存在当前档案。</p>','导入听力','exam-import-form'))
  renderImportGroups($('exam-import-board').value)
}
function renderImportGroups(board) {
  const box=$('exam-import-group')
  box.innerHTML=option('','整套听力','')+Object.entries(sections[board] || {}).map(([k,v])=>option(k,v,'')).join('')
}
async function importExam(form,data) {
  const button=form.querySelector('button[type=submit]')
  const board=$('exam-import-board').value, group=$('exam-import-group').value
  const audioFile=data.get('audio'), transcript=data.get('transcript'), chinese=data.get('chinese')
  const title=data.get('title').trim(), year=data.get('year')
  if (!title || !audioFile?.size || !/^\d{4}$/.test(year)) return toast('请填写名称并选择有效音频。')
  button.disabled=true
  try {
    if (audioFile.size>150*1024*1024) throw Error('单个音频需小于 150 MB。')
    if (transcript?.size>5*1024*1024 || chinese?.size>5*1024*1024) throw Error('每个字幕文件需小于 5 MB。')
    const english=transcript?.size ? parseTimed(await transcript.text(),chinese?.size?'en':'auto') : []
    const translation=chinese?.size ? parseTimed(await chinese.text(),'zh') : []
    const attachment=pairTimed(english,translation)
    if ((transcript?.size || chinese?.size) && !attachment.length) throw Error('无法读取字幕时间轴。')
    const paper={id:'exam-local-'+uid(),board,group,kind:'exam',cat:'news',examOrigin:'local',source:'本机资料',
      title,year,month:String(data.get('month') || ''),number:String(data.get('number') || '').trim().slice(0,24),
      cues:attachment,blob:audioFile}
    await materialTransaction('readwrite',store=>store.put(paper))
    ingestMaterial(paper)
    s.examFilters=examDefaults(board);persist()
    if (button.isConnected&&modal.open) modal.close()
    go('episode',paper.id)
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
