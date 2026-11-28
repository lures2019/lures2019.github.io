import {escape as e, clock} from './core.js?v=1.4.0'

export const boards = {
  cet4: ['四级', '短篇新闻、长对话、听力篇章'],
  cet6: ['六级', '长对话、听力篇章、讲座'],
  ielts: ['雅思', '日常对话、场景介绍、学术对话和讲座']
}
export const sections = {
  cet4: {news:'短篇新闻', conversation:'长对话', passage:'听力篇章'},
  cet6: {conversation:'长对话', passage:'听力篇章', report:'讲座与报道'},
  ielts: {part1:'日常对话', part2:'场景介绍', part3:'学术对话', part4:'学术讲座'}
}
const option=(key,title,at)=>'<option value="'+e(key)+'"'+(key===at?' selected':'')+'>'+e(title)+'</option>'

export function libraryView({items,settings,favorites}) {
  const board = settings.board
  const bank = items.filter(item=>item.board===board)
  const years = [...new Set(bank.filter(item=>item.examOrigin==='local').map(item=>item.year))].filter(Boolean).sort().reverse()
  const active = bank.filter(item=>(settings.group==='all' || item.group===settings.group) &&
    (settings.year==='all' || item.examOrigin==='local' && item.year===settings.year) &&
    (settings.kind!=='fav' || favorites[item.id]))
  const html = '<div class="headrow"><div><h1 class="page-title">考试听力</h1><p class="page-sub">'+e(boards[board][1])+'</p></div>'+
    '<button class="btn outline" data-action="exam-import">导入我的真题音频</button></div>'+
    '<div class="actions exam-tabs" aria-label="考试类型">'+Object.entries(boards).map(([k,value])=>
    '<button class="btn '+(k===board?'primary':'outline')+'" data-action="exam-board" data-key="'+k+'" aria-pressed="'+(k===board)+'">'+e(value[0])+'</button>'
    ).join('')+'</div><div class="filters exam-filters">'+
    '<label class="field">题材<select id="exam-group" aria-label="题材">'+option('all','全部题材',settings.group)+Object.entries(sections[board]).map(([k,v])=>option(k,v,settings.group)).join('')+'</select></label>'+
    (years.length?'<label class="field">年份<select id="exam-year" aria-label="年份">'+option('all','全部年份',settings.year)+years.map(y=>option(y,y+' 年',settings.year)).join('')+'</select></label>':'')+
    '<label class="field">收藏<select id="exam-kind" aria-label="收藏">'+option('all','全部材料',settings.kind)+option('fav','已收藏',settings.kind)+'</select></label><span class="muted exam-total">'+active.length+' 段</span></div>'+
    (active.length?'<div class="exam-grid">'+active.map(item=>card(item,favorites[item.id])).join('')+'</div>':
    '<p class="empty">没有找到符合条件的听力。可调整筛选或导入自己的音频。</p>')
  return {html, ids:active.map(item=>item.id)}
}

function card(item,favorite) {
  const title = item.zh || item.title
  const info = [
    sections[item.board]?.[item.group],
    item.examOrigin==='local' ? [item.year ? item.year+' 年' : '',item.month ? Number(item.month)+' 月' : '',item.number].filter(Boolean).join(' ') : '原创题材听力',
    item.duration ? clock(item.duration) : ''
  ].filter(Boolean).join(' · ')
  return '<article class="card exam-card"><span class="exam-series">'+e(info)+'</span><h2>'+e(title)+'</h2>'+
    '<div class="actions"><span class="tag">'+(item.cues?.some(cue=>cue.en&&cue.zh)?'中英字幕':item.cues?.length?'已有字幕':'可附字幕')+'</span></div>'+
    '<div class="actions exam-card-foot"><button class="btn primary" data-go="episode" data-key="'+e(item.id)+'">播放与原文</button>'+
    '<button class="btn quiet" data-action="exam-favorite" data-key="'+e(item.id)+'" aria-pressed="'+Boolean(favorite)+'">'+
    (favorite?'已收藏':'收藏')+'</button></div></article>'
}
