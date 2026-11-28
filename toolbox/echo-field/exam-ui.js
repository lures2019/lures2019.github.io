import {escape as e, normalized as norm, safeLink, clock} from './core.js?v=1.2.0'

export const boards = {
  cet4:['四级 CET-4','短篇新闻、长对话和听力篇章'],
  cet6:['六级 CET-6','长对话、听力篇章与讲话／报道／讲座'],
  ielts:['雅思 IELTS','从日常对话到学术独白'],
  kaoyan:['考研英语','英语一、英语二资料索引']
}
export const sections = {
  cet4:{news:['短篇新闻',1,7],conversation:['长对话',8,15],passage:['听力篇章',16,25]},
  cet6:{conversation:['长对话',1,8],passage:['听力篇章',9,15],report:['讲话／报道／讲座',16,25]},
  ielts:{part1:['Part 1 日常对话',1,10],part2:['Part 2 日常独白',11,20],part3:['Part 3 学术对话',21,30],part4:['Part 4 学术独白',31,40]},
  kaoyan:{}
}
const needs = {
  news:'预读选项，圈出时间、原因和措施。听到 but 或 however 时，记下改变后的信息。',
  conversation:'按“提议、否定、最终决定”记三行关键词。复听时对照是谁提出、谁确认。',
  passage:'第一遍用一句话说出主旨。第二遍只抓举例、结果和原因，检查哪些细节改写进了选项。',
  report:'给笔记留出“主题、证据、限制”三栏。跟着转折词定位研究结论和局限。',
  part1:'作答前先判断空格要填姓名、数字还是名词。复听修正、价格与拼写。',
  part2:'先看起点和方位词。听地点说明时记录经过的地标。',
  part3:'区分初步提议和最终共识，留意 I agree、instead 与 actually。',
  part4:'预判每个空需要的词性，顺着讲述顺序找主题和术语，提交前检查单复数。'
}
const ext = ' target="_blank" rel="noopener noreferrer"'
const rangeLabel = (a,b) => a === b ? '第 ' + a + ' 题' : '第 ' + a + '–' + b + ' 题'
const sectionName = (board,group) => sections[board]?.[group]?.[0] || (group==='legacy' ? '早期卷' : '整套资源')
export const paperTitle = paper => paper.zh || paper.title
const controls = (action, title, extra='', cls='outline') => '<button class="btn '+cls+'" data-action="'+action+'" '+extra+'>'+title+'</button>'
const linkTo = (title, href, styles='outline') => '<a class="btn '+styles+'" href="'+href+'">'+title+'</a>'
const option = (key,title,current) => '<option value="'+e(key)+'"'+(String(key)===String(current)?' selected':'')+'>'+e(title)+'</option>'
const originLabel = paper => ({original:'原创专项',local:'本机导入',external:'原站资料'})[paper.examOrigin] || '听力练习'
const asDate = paper => paper.year ? paper.year+' 年'+(paper.month?' '+Number(paper.month)+' 月':'')+(paper.number?' · 第 '+paper.number+' 套':'') : '公开样题'
export function paperQuestions(paper,group='') {
  const mapped=sections[paper.board]?.[paper.group || group]
  if (paper.questions?.length) return paper.questions.map(q=>q.number).filter(n=>!mapped || n>=mapped[1] && n<=mapped[2])
  if (mapped) return Array.from({length:mapped[2]-mapped[1]+1},(_,i)=>i+mapped[1])
  if (paper.examOrigin==='external' && paper.month && paper.group!=='legacy' && paper.board!=='kaoyan') {
    return Array.from({length:paper.board==='ielts'?40:25},(_,i)=>i+1)
  }
  return []
}
function matches(paper, filters, progress) {
  if(filters.year!=='all' && filters.year!==(paper.year || 'sample')) return false
  if(filters.group!=='all' && paper.group!==filters.group && (paper.group || (!paper.month && paper.examOrigin!=='local'))) return false
  if(filters.origin!=='all' && filters.origin!==paper.examOrigin) return false
  if(filters.question && !paperQuestions(paper,filters.group).includes(Number(filters.question))) return false
  if(filters.status==='wrong') return Boolean(progress?.latest?.correct.some(ok=>!ok))
  if(filters.status==='done') return Boolean(progress)
  if(filters.status==='not-started') return !progress
  return true
}
export function libraryView({items,settings,progress,favorites,plan}) {
  const board=settings.board, source=boards[board], bank=items.filter(paper=>paper.board===board)
  const years=[...new Set(bank.map(p=>p.year).filter(Boolean))].sort((a,b)=>Number(b)-Number(a))
  const active=bank.filter(p=>matches(p,settings,progress[p.id]))
  const exercises=bank.filter(p=>p.questions?.length)
  const completed=exercises.filter(p=>progress[p.id]).length
  return '<div class="headrow"><div><h1 class="page-title">考试训练</h1><p class="page-sub">'+source[1]+'</p></div>'+
    (board==='kaoyan'?'':controls('exam-import','导入真题资料'))+'</div><div class="actions exam-tabs" aria-label="考试类型">'+
    Object.entries(boards).map(([key,v])=>controls('exam-board',v[0],'data-key="'+key+'" aria-pressed="'+(board===key)+'"',board===key?'primary':'outline')).join('')+
    '</div>'+ (exercises.length?'<section class="panel exam-progress"><div><h2>'+source[0]+' 训练进度</h2><p class="muted">已完成 '+completed+' / '+exercises.length+' 组应用内训练</p><progress aria-label="考试练习完成度" value="'+completed+'" max="'+exercises.length+'"></progress></div>' +
    (plan?.paper ? linkTo('继续专项训练','#exam-paper/'+encodeURIComponent(plan.paper.id),'primary') : '')+'</section>':'')+
    '<form class="filters exam-filters" id="exam-filters">'+
    '<label class="field">年份<select id="exam-year" aria-label="年份">'+option('all','全部年份',settings.year)+years.map(y=>option(y,y+' 年',settings.year)).join('')+
    (bank.some(p=>!p.year)?option('sample','公开样题与指南',settings.year):'')+'</select></label>'+
    '<label class="field">题型<select id="exam-group" aria-label="题型">'+option('all','全部题型',settings.group)+Object.entries(sections[board]).map(([k,v])=>option(k,v[0],settings.group)).join('')+
    (bank.some(p=>p.group==='legacy')?option('legacy','早期卷',settings.group):'')+'</select></label>'+
    '<label class="field">来源<select id="exam-origin" aria-label="来源">'+[['all','全部来源'],['original','原创专项'],['external','历年真题与原站'],['local','本机导入']].map(([k,v])=>option(k,v,settings.origin)).join('')+'</select></label>'+
    '<label class="field">状态<select id="exam-status" aria-label="状态">'+[['all','全部状态'],['not-started','未做'],['done','已做'],['wrong','有错题']].map(([k,v])=>option(k,v,settings.status)).join('')+'</select></label>'+
    '<label class="field">题号<input type="number" inputmode="numeric" min="1" max="99" name="question" placeholder="例如 8" value="'+e(settings.question)+'"></label>'+
    '<button class="btn outline" type="submit">筛选题号</button><span class="muted exam-total">'+active.length+' 个结果</span></form>'+
    (active.length?'<div class="exam-grid">'+active.map(item=>card(item,settings,progress[item.id],Boolean(favorites[item.id]))).join('')+'</div>':
      '<p class="empty">没有符合条件的资料。可以切换年份、题型或来源。</p>')
}
function card(paper, settings, submission, favorite) {
  const numbers=paperQuestions(paper,settings.group)
  const range=numbers.length ? rangeLabel(numbers[0],numbers[numbers.length-1]) : ''
  const tag=originLabel(paper)
  const legacy=paper.group==='legacy'
  const description=paper.note || (paper.questions?.length ? paper.questions.length+' 题 · '+clock(paper.duration) : '自建的音频与题目索引')
  const open=paper.examOrigin==='external' ? '<a class="btn outline" href="'+safeLink(paper.url)+'"'+ext+'>前往原站</a>' :
    linkTo(submission?'复习这组':'开始练习','#exam-paper/'+encodeURIComponent(paper.id),'primary')
  return '<article class="card exam-card"><span class="exam-series">'+e(asDate(paper))+'</span><h2>'+e(paperTitle(paper))+'</h2><div class="actions"><span class="tag">'+e(tag)+'</span>'+
      (range?'<span class="muted">'+range+'</span>':'')+'</div><p class="muted">'+e([paper.group?sectionName(paper.board,paper.group):'',paper.source,description].filter(Boolean).join(' · '))+'</p>'+
      (legacy?'<p class="muted">早期卷题型以原题为准。</p>':'')+'<div class="actions exam-card-foot">'+open+
      controls('exam-favorite',favorite?'已收藏':'收藏','data-key="'+e(paper.id)+'" aria-pressed="'+favorite+'"','quiet')+
      (submission?.latest?'<span class="muted">'+submission.latest.correct.filter(Boolean).length+' / '+submission.latest.correct.length+' 正确</span>':'')+(paper.examOrigin==='external'?controls('exam-external-done',submission?.manual?'取消已做':'标记已做','data-key="'+e(paper.id)+'"','quiet'):'')+ (paper.examOrigin==='external' && paper.month && paper.group!=='legacy' && ['cet4','cet6'].includes(paper.board)?controls('exam-log','录入成绩','data-key="'+e(paper.id)+'"','quiet'):'')+'</div></article>'
}
export function gradePaper(paper, values) {
  const correct=paper.questions.map((question,i)=>question.answers.some(answer=>norm(answer)===norm(values[i])))
  return {answered:values,correct,at:new Date().toISOString()}
}
export function nextExamPlan(papers, progress, board, references=[]) {
  const relevant=papers.filter(paper=>paper.board===board && paper.questions?.length)
  const scores = new Map(Object.keys(sections[board] || {}).map(group=>[group,{wrong:0,total:0}]))
  for (const paper of relevant) {
    const mostRecent=progress[paper.id]?.latest?.correct
    if(!mostRecent?.length || !scores.has(paper.group)) continue
    const row=scores.get(paper.group)
    row.total+=mostRecent.length
    row.wrong+=mostRecent.filter(x=>!x).length
  }
  for (const ref of references) {
    if(ref.board!==board) continue
    for (const [group,score] of Object.entries(progress[ref.id]?.sections || {})) {
      if(!scores.has(group) || !Number.isFinite(score?.total) || !Number.isFinite(score.correct)) continue
      const row=scores.get(group)
      row.total+=score.total
      row.wrong+=score.total-score.correct
    }
  }
  const weak=[...scores].filter(([,stat])=>stat.wrong>0).sort((a,b)=>b[1].wrong/b[1].total-a[1].wrong/a[1].total || b[1].wrong-a[1].wrong)[0]
  const group=weak?.[0] || relevant.find(paper=>!progress[paper.id])?.group || relevant[0]?.group
  const paper=relevant.find(paper=>paper.group===group && progress[paper.id]?.latest?.correct.some(ok=>!ok)) ||
    relevant.find(paper=>paper.group===group && !progress[paper.id]) || relevant.find(paper=>paper.group===group)
  return {paper,group,label:group?sectionName(board,group):'',tip:needs[group],score:weak?.[1]}
}
export function planPanel(board, plan) {
  if(!plan.paper) return ''
  const score=plan.score ? '最近的 '+plan.label+' 练习错了 '+plan.score.wrong+' / '+plan.score.total+' 题，今天先练这类。' : '先做一组'+plan.label+'，记录初次答题情况。'
  return '<div class="section-heading"><h2>考试专项计划</h2></div><section class="panel stack"><h3>'+boards[board][0]+'</h3><p>'+score+'</p><p>'+e(plan.tip)+'</p>'+
    '<p class="muted">建议用 15 分钟。先盲听做题，再重听定位句，最后把 2 个在原句里出现的词或短语加入生词本。</p><div class="actions">'+
    linkTo('开始本次专项','#exam-paper/'+encodeURIComponent(plan.paper.id),'primary')+linkTo('切换考试','#exam')+'</div></section>'
}
export function paperView(paper,{result,draft,favorite,paused,cueRows}) {
  const group=sectionName(paper.board,paper.group)
  const numbers=paperQuestions(paper)
  if (!paper) return ''
  const title='<div class="headrow"><div><h1 class="page-title">'+e(paperTitle(paper))+'</h1><p class="page-sub">'+
    e([boards[paper.board]?.[0],group,originLabel(paper),asDate(paper)].join(' · '))+'</p></div>'+linkTo('返回考试训练','#exam')+'</div>'
  const playback='<div class="actions">'+controls('toggle',paused?'播放音频':'暂停','id="detail-play"','primary')+
    (result && paper.cues?.length ? linkTo('在精听播放器打开','#episode/'+encodeURIComponent(paper.id)):'')+
    controls('exam-favorite',favorite?'已收藏':'收藏','data-key="'+e(paper.id)+'" aria-pressed="'+favorite+'"','quiet')+
    (result ? controls('exam-retake','重新答题'):'')+'</div>'
  const fields=paper.questions.map((q,i)=>{
    const user=result?.answered[i] ?? draft[i] ?? ''
    const marked=result?.correct[i]
    const answer=q.options ? q.options[Number(q.answers[0])] : q.answers[0]
    return '<section class="exam-question"><h3><span>第 '+q.number+' 题</span> <span lang="en">'+e(q.prompt)+'</span></h3>'+
      (q.options ? '<div class="exam-choices">'+q.options.map((choice,j)=>'<label class="exam-choice'+(String(j)===String(q.answers[0]) && result?' correct':'')+'">'+
      '<input type="radio" name="q-'+i+'" value="'+j+'"'+(String(user)===String(j)?' checked':'')+(result?' disabled':'')+'>'+
      '<span>'+String.fromCharCode(65+j)+'. '+e(choice)+'</span></label>').join('')+'</div>' :
      '<input class="exam-answer" name="q-'+i+'" aria-label="第 '+q.number+' 题答案" maxlength="80" autocomplete="off" value="'+e(user)+'"'+(result?' disabled':'')+' placeholder="填写听到的词或数字">')+
      (result ? '<p class="feedback">'+(marked?'答对了':'答错或未答')+' · 参考答案 '+e(answer)+'</p>'+
        (q.explanation?'<p class="muted">'+e(q.explanation)+'</p>':'')+
        (paper.cues?.[q.cue]?controls('exam-evidence','重听定位句','data-index="'+q.cue+'"'):'') : '')+'</section>'
  }).join('')
  const form='<section class="panel stack"><div class="actions"><h2>'+ (numbers.length?rangeLabel(numbers[0],numbers[numbers.length-1]):'作答训练')+'</h2>'+
    (result?'<span class="tag">'+result.correct.filter(Boolean).length+'/'+result.correct.length+' 题正确</span>':'')+'</div>'+
    playback+(result?'':'<p class="muted">先读题，再用正常语速听一遍。提交后查看答案和定位句。</p>')+
    (fields ? '<form id="exam-answer-form" class="stack">'+fields+(result?'':'<button type="submit" class="btn primary">交卷并查看解析</button>')+'</form>' :
      '<p class="notice">这份资料没有设置答案。可搭配自己的题册收听，并按题型记录学习。</p>')+'</section>'
  const vocab=paper.terms?.length ? paper.terms.map(term=>{
    const cue=paper.cues[term.cue]
    return '<div class="exam-term"><strong lang="en">'+e(term.term)+'</strong><p>'+e(term.meaning)+'</p><p class="muted" lang="en">'+e(cue?.en)+'</p>'+
      '<div class="actions">'+controls('exam-evidence','听原句','data-index="'+term.cue+'"')+
      controls('exam-word','收藏语境词','data-index="'+term.cue+'" data-word="'+e(term.term)+'" data-meaning="'+e(term.meaning)+'"')+'</div></div>'
  }).join('') : '<p class="muted">可以从已导入的字幕中点击生词，保存原句和释义。</p>'
  return title+'<div class="exam-layout">'+form+'<aside class="stack">'+ (result || !paper.questions.length ? '<section class="panel stack"><h2>语境词汇</h2>'+vocab+'</section>'+
    (cueRows?'<section class="panel stack"><h2>双语原文</h2><div class="transcript" id="transcript">'+cueRows+'</div></section>':'') :
    '<section class="panel stack"><h2>交卷后复盘</h2><p class="muted">查看做错的题、定位原句和语境里的常考表达。</p></section>') + '</aside></div>'
}
