import { formatFocus } from './todo-model.js?v=4'

const cards = [
  ['progress', '进度卡', [
    '你把一件重要的事往前推了一步。记下这一步，下次就能接着走。',
    '这段时间花在了你自己选的目标上。刚才最顺的一步是什么？',
    '一道终于讲清楚的题，一个第一次认出来的词，都算今天的进步。',
    '任务里最难开始的那一段，你已经做完了。站起来，换个视角。',
    '把今天弄懂的一个点写成一句话，留给下次复习的自己。',
    '你刚刚给长期目标留出了一段完整的时间。可以安心休息几分钟。',
    '今天做出来的这一小块，已经可以放进你的学习记录里。',
    '愿意坐下来做这一轮，就已经把计划变成了行动。'
  ]],
  ['poem', '诗笺', [
    ['潮平两岸阔，风正一帆悬。', '王湾《次北固山下》'],
    ['欲穷千里目，更上一层楼。', '王之涣《登鹳雀楼》'],
    ['山重水复疑无路，柳暗花明又一村。', '陆游《游山西村》'],
    ['纸上得来终觉浅，绝知此事要躬行。', '陆游《冬夜读书示子聿》'],
    ['会当凌绝顶，一览众山小。', '杜甫《望岳》'],
    ['海日生残夜，江春入旧年。', '王湾《次北固山下》'],
    ['长风破浪会有时，直挂云帆济沧海。', '李白《行路难·其一》'],
    ['千磨万击还坚劲，任尔东西南北风。', '郑燮《竹石》']
  ]],
  ['quote', '书签', [
    ['学而不思则罔，思而不学则殆。', '《论语·为政》'],
    ['不积跬步，无以至千里。', '《荀子·劝学》'],
    ['博观而约取，厚积而薄发。', '苏轼《稼说送张琥》'],
    ['知之为知之，不知为不知，是知也。', '《论语·为政》'],
    ['业精于勤，荒于嬉；行成于思，毁于随。', '韩愈《进学解》'],
    ['虽有嘉肴，弗食，不知其旨也。', '《礼记·学记》'],
    ['温故而知新，可以为师矣。', '《论语·为政》'],
    ['锲而不舍，金石可镂。', '《荀子·劝学》']
  ]],
  ['music', '原创短旋律', [
    ['窗边小憩', [60, 64, 67, 72, 67, 64]],
    ['雨后树梢', [62, 65, 69, 72, 69, 74]],
    ['台灯与书页', [57, 60, 64, 67, 64, 60]],
    ['日落散步', [65, 69, 72, 76, 74, 72]],
    ['清晨的第一封信', [55, 59, 62, 67, 69, 71]],
    ['书桌上的星光', [60, 67, 69, 76, 74, 72]],
    ['最后一页的晚风', [64, 67, 69, 71, 69, 67]],
    ['从这里出发', [57, 62, 65, 69, 67, 62]]
  ]]
]
const reflections = [
  '把一件事想清楚，比匆匆翻过几页更有用。',
  '能说出哪里卡住了，本身就是进展。',
  '读到陌生的地方时停一停，给自己一点理解的时间。',
  '先把今天这一小段走完，明天会更容易接上。',
  '理解有时发生在第二遍，第一遍留下的问题也有价值。',
  '如果今天状态一般，能完成这一轮就值得肯定。',
  '你刚才认真处理的是一个真实的问题，它比打勾本身更重要。',
  '有了写下来的线索，下次可以从半途继续。',
  '遇到难题时慢下来，往往能看清哪个条件在起作用。',
  '每一次能独立复述，都在检验自己掌握到了哪里。',
  '记住今天用得顺手的方法，下一次还可以用。',
  '把题目做错再改对，是一次完整的学习过程。',
  '复习做过的例子，也能找到之前漏掉的细节。',
  '如果一个概念变清楚了，今天就有一项成果。',
  '给自己留点休息的时间，下一轮还有精力去思考。',
  '把任务拆成清晰的小步骤，能让开始这件事简单一点。'
]
const actions = [
  '记下一条刚刚弄懂的内容。',
  '标出下一次打开材料时要从哪里开始。',
  '合上笔记，用一句话复述这轮的重点。',
  '留下一个下一轮要解决的小问题。',
  '把刚才最难的一步圈出来，留到回顾时看。',
  '记一个具体例子来帮助自己记住刚才的概念。',
  '把这轮最有用的一条笔记移到容易找到的位置。',
  '先起来活动一下，再决定接下来做什么。',
  '在任务旁写一句话，说明现在做到哪一步。',
  '给今天用到的一个术语写一句自己的解释。',
  '回看最初的目标，找出现在已经能独立做的部分。',
  '给下一轮留一个五分钟就能动手的任务。',
  '记下一个还需要查资料的地方。',
  '把原本模糊的地方改写成一个明确的问题。',
  '拿两分钟回看错题或划过的句子。',
  '喝口水，把刚才做好的事记进今天的记录。'
]
const cues = {
  english: ['合上材料，用一句英文复述刚才读到的内容。', '下一次从复习刚才遇到的三个词开始。', '标一句想模仿的英文表达，给自己留个轻松的开头。'],
  study: ['写下刚才解开的一个疑问，下一轮从它的下一步开始。', '试着不看笔记，给自己讲一遍刚才的关键概念。', '标记一道还没做完的题，休息后可以直接接上。'],
  general: ['喝口水，看看远处。下一轮可以从一个五分钟的小目标开始。', '留一句「下次从这里开始」，然后休息片刻。', '记下刚才做成的一件事，下一段时间由你安排。']
}
const key = 'treehouse-focus-reward'
const get = id => document.getElementById(id)
let sequence = 0
let audio

export const rewardCount = cards.length * cards[0][2].length * reflections.length * actions.length

export function rewardAt (index) {
  const styleIndex = index % cards.length
  const [style, label, deck] = cards[styleIndex]
  const round = Math.floor(index / cards.length)
  const item = round % deck.length
  const variation = Math.floor(round / deck.length)
  const reflection = (variation + item * 3 + styleIndex * 5) % reflections.length
  const action = (Math.floor(variation / reflections.length) + reflection * 3 + item * 7) % actions.length
  const card = deck[item]
  return {
    style, label, line: Array.isArray(card) ? card[0] : card,
    credit: style === 'poem' || style === 'quote' ? card[1] : '',
    reflection: reflections[reflection], action: actions[action],
    notes: style === 'music' ? card[1].map(note => note + [-5, -2, 0, 2, 5][reflection % 5]) : null,
    beat: .20 + (action % 5) * .025
  }
}

export function dailyQuote (day) {
  const index = Math.floor(Date.parse(day + 'T00:00:00Z') / 86_400_000) % reflections.length
  return reflections[index]
}

function takeReward () {
  try {
    const saved = Number(localStorage.getItem(key))
    if (Number.isSafeInteger(saved) && saved >= sequence) sequence = saved
  } catch { /* The session still rotates the cards. */ }
  const index = sequence++
  try { localStorage.setItem(key, String(sequence)) } catch { /* Optional storage. */ }
  return index
}

async function play (notes, beat) {
  audio ??= new AudioContext()
  await audio.resume()
  const start = audio.currentTime + .04
  notes.forEach((note, index) => {
    const sound = audio.createOscillator()
    const gain = audio.createGain()
    const at = start + index * beat
    sound.type = 'sine'
    sound.frequency.value = 440 * 2 ** ((note - 69) / 12)
    gain.gain.setValueAtTime(.001, at)
    gain.gain.exponentialRampToValueAtTime(.13, at + .025)
    gain.gain.exponentialRampToValueAtTime(.001, at + .45)
    sound.connect(gain).connect(audio.destination)
    sound.start(at)
    sound.stop(at + .46)
  })
}

export async function showReward (title, ms) {
  const dialog = get('focus-reward')
  const close = get('reward-close')
  const music = get('reward-play')
  const index = navigator.locks ? await navigator.locks.request(key, takeReward).catch(takeReward) : takeReward()
  const reward = rewardAt(index)
  const group = /英语|雅思|托福|单词|English|IELTS|TOEFL/i.test(title) ? cues.english
    : /申博|专业|论文|刷题|复习|数学/i.test(title) ? cues.study : cues.general
  dialog.dataset.reward = reward.style
  get('reward-kind').textContent = reward.label
  get('reward-session').textContent = title + ' · ' + formatFocus(ms)
  get('reward-line').textContent = reward.line
  get('reward-credit').textContent = reward.credit
  get('reward-reflection').textContent = reward.reflection
  get('reward-next').textContent = reward.action + ' ' + group[Math.floor(index / cards.length) % group.length]
  music.hidden = !reward.notes
  music.textContent = '播放片刻'
  music.onclick = () => {
    music.disabled = true
    void play(reward.notes, reward.beat).catch(() => { music.textContent = '当前浏览器无法播放' })
    setTimeout(() => { music.disabled = false }, 1700)
  }
  close.onclick = () => dialog.close()
  if (!dialog.open) dialog.showModal()
  close.focus()
}
