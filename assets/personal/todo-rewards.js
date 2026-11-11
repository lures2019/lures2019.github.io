import { formatFocus } from './todo-model.js?v=4'

const cards = [
  ['progress', '进度卡', [
    '你把一件重要的事往前推了一步。记下这一步，下次就能接着走。',
    '这段时间花在了你自己选的目标上。刚才最顺的一步是什么？',
    '一道终于讲清楚的题，一个第一次认出来的词，都算今天的进步。',
    '任务里最难开始的那一段，你已经做完了。站起来，换个视角。',
    '把今天弄懂的一个点写成一句话，留给下次复习的自己。',
    '你刚刚给长期目标留出了一段完整的时间。可以安心休息几分钟。'
  ]],
  ['poem', '诗笺', [
    ['潮平两岸阔，风正一帆悬。', '王湾《次北固山下》'],
    ['欲穷千里目，更上一层楼。', '王之涣《登鹳雀楼》'],
    ['山重水复疑无路，柳暗花明又一村。', '陆游《游山西村》'],
    ['纸上得来终觉浅，绝知此事要躬行。', '陆游《冬夜读书示子聿》'],
    ['会当凌绝顶，一览众山小。', '杜甫《望岳》'],
    ['海日生残夜，江春入旧年。', '王湾《次北固山下》']
  ]],
  ['quote', '书签', [
    ['学而不思则罔，思而不学则殆。', '《论语·为政》'],
    ['不积跬步，无以至千里。', '《荀子·劝学》'],
    ['博观而约取，厚积而薄发。', '苏轼《稼说送张琥》'],
    ['知之为知之，不知为不知，是知也。', '《论语·为政》'],
    ['业精于勤，荒于嬉；行成于思，毁于随。', '韩愈《进学解》'],
    ['虽有嘉肴，弗食，不知其旨也。', '《礼记·学记》']
  ]],
  ['music', '原创短旋律', [
    ['窗边小憩', [60, 64, 67, 72, 67, 64]],
    ['雨后树梢', [62, 65, 69, 72, 69, 74]],
    ['台灯与书页', [57, 60, 64, 67, 64, 60]],
    ['日落散步', [65, 69, 72, 76, 74, 72]],
    ['清晨的第一封信', [55, 59, 62, 67, 69, 71]],
    ['书桌上的星光', [60, 67, 69, 76, 74, 72]]
  ]]
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

async function play (notes) {
  audio ??= new AudioContext()
  await audio.resume()
  const start = audio.currentTime + .04
  notes.forEach((note, index) => {
    const sound = audio.createOscillator()
    const gain = audio.createGain()
    const at = start + index * .23
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

export function showReward (title, ms) {
  const dialog = get('focus-reward')
  const close = get('reward-close')
  const music = get('reward-play')
  try {
    const saved = Number(localStorage.getItem(key))
    if (Number.isSafeInteger(saved) && saved >= sequence) sequence = saved
  } catch { /* The session still rotates the cards. */ }
  const index = sequence++
  try { localStorage.setItem(key, String(sequence)) } catch { /* Optional storage. */ }
  const [style, label, deck] = cards[index % cards.length]
  const card = deck[Math.floor(index / cards.length) % deck.length]
  const group = /英语|雅思|托福|单词|English|IELTS|TOEFL/i.test(title) ? cues.english
    : /申博|专业|论文|刷题|复习|数学/i.test(title) ? cues.study : cues.general
  dialog.dataset.reward = style
  get('reward-kind').textContent = label
  get('reward-session').textContent = title + ' · ' + formatFocus(ms)
  get('reward-line').textContent = Array.isArray(card) ? card[0] : card
  get('reward-credit').textContent = style === 'poem' || style === 'quote' ? card[1] : ''
  get('reward-next').textContent = group[index % group.length]
  music.hidden = style !== 'music'
  music.textContent = '播放片刻'
  music.onclick = () => {
    music.disabled = true
    void play(card[1]).catch(() => { music.textContent = '当前浏览器无法播放' })
    setTimeout(() => { music.disabled = false }, 1700)
  }
  close.onclick = () => dialog.close()
  if (!dialog.open) dialog.showModal()
  close.focus()
}
