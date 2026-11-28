import { canvas, clearCanvas, decode, fromSource, jpeg, fullQuad, validQuad, makePage, renderPage,
  splitPage, imageType, MAX_EDGE, MAX_FILE, MAX_PAGES, MAX_PROJECT } from './scan.mjs';
import { openPdf, renderPdfPage, createOcr, exportPdf, safeName, saveFile } from './files.mjs';
import { readDraft, saveDraft } from './draft.mjs';
import { setUpCamera } from './camera.mjs';

const el = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const svgNS = 'http://www.w3.org/2000/svg';
const icons = {
  back:'M19 12H5m7 7-7-7 7-7', doc:'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6',
  book:'M12 6C9 4 5 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-2-1-6-1-9 1v14',
  card:'M3 5h18v14H3zM7 15v-1c0-2 5-2 5 0v1m5-5h2m-2 4h2M11 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0',
  shield:'M12 22c-4-2-7-5-7-9V6l7-3 7 3v7c0 4-3 7-7 9zm-3-10 2 2 4-4',
  download:'M12 4v11m-4-4 4 4 4-4M4 16v4h16v-4',
  camera:'M3 7h5l2-3h4l2 3h5v13H3zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  image:'M3 4h18v16H3zm0 12 5-5 4 4 4-4 5 5m-6-8h.01',
  crop:'M7 3v14h14M3 7h14v14', rotate:'M4 10a8 8 0 1 1 2 8M4 4v6h6',
  trash:'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13m-8 4v5m4-5v5',
  stamp:'M4 18h16v3H4zM6 18v-3l4-2V9a3 3 0 1 1 4 0v4l4 2v3',
  text:'M5 7V4h14v3M12 4v16m-4 0h8', file:'M6 3h8l4 4v14H6zM14 3v5h4',
  close:'m6 6 12 12M18 6 6 18', left:'m14 6-6 6 6 6', right:'m10 6 6 6-6 6'
};
function icon(key) {
  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('aria-hidden','true');
  const path = document.createElementNS(svgNS,'path');
  path.setAttribute('d',icons[key]);
  svg.append(path);
  return svg;
}
for (const slot of all('[data-icon]')) slot.append(icon(slot.dataset.icon));

const newProject = () => ({pages:[], filename:'', paper:'fit', quality:'high', filter:'original',
  watermark:{enabled:false,text:'',opacity:22}});
let projects = {doc:newProject(),id:newProject()};
let mode = 'doc', selected, side = 'front', busy, saving = false, draftQueue = Promise.resolve();
let undo, crop, replaceInput, dragged, previewUrl, previewEpoch = 0, previewTimer, noticeTimer;
const thumbUrls = new Map();
const activeKey = () => mode === 'id' ? 'id' : 'doc';
const project = () => projects[activeKey()];
const page = () => mode==='id' ? project().pages.find(p=>p.side===side) : project().pages.find(p=>p.id===selected);
const pause = () => new Promise(resolve => setTimeout(resolve,0));
const descriptions = {
  doc:['文档扫描','拍摄纸张或导入文件，整理成一份 PDF。','添加你的第一页','拖入图片或 PDF，也可以直接打开相机。'],
  book:['书籍连拍','保持相机开启，逐页拍摄或将左右跨页拆开。','从书籍第一页开始','用连拍顺序收集每页。展开跨页可先拍后拆。'],
  id:['证件扫描','依次收集正反面，在一张 A4 上输出。','添加证件照片','先选择正面或反面，再拍摄或导入该面。']
};
const filterHints = {
  original:'保留拍摄色彩，适合图文混排。', color:'提亮纸面并增加对比度，适合普通彩色资料。',
  seal:'主要提亮低饱和度的纸面，保留浅红色章迹和其他颜色。',
  gray:'保留明暗层次，适合无需彩色的文档。', bw:'提高黑白反差，适合底色均匀的文字稿。'
};

function notice(text) {
  clearTimeout(noticeTimer);
  el('notice').textContent = text;
  if (text) noticeTimer = setTimeout(()=>{el('notice').textContent='';},13000);
}

function persist(force = false) {
  if (!saving && !force) return;
  const value = saving ? {mode,projects:{...projects}} : null;
  draftQueue = draftQueue.catch(()=>{}).then(()=>saveDraft(value)).then(() => {
    el('draft-status').textContent = value ? '草稿已保存到此设备。' : '开启后可关闭页面再续扫。关闭此选项会删除已保存草稿。';
  }).catch(() => {
    el('draft-status').textContent = value ? '本机草稿保存失败，请先导出 PDF。' : '草稿删除失败，可重新开启后再尝试关闭。';
  });
}

function updateProject(options, rerender = true) {
  const key = activeKey();
  projects[key] = {...projects[key],...options};
  persist();
  if (rerender) refresh();
}

function updatePage(changes) {
  const id = page()?.id;
  updateProject({pages:project().pages.map(p => p.id===id ? {...p,...changes} : p)});
}

function selection(id, newSide = side) {
  if (busy || crop) return;
  selected = id;
  side = newSide;
  refresh();
}

function list() {
  const p = project(), current = page();
  const used = new Set([...projects.doc.pages,...projects.id.pages].map(item=>item.thumb));
  for (const [image,url] of thumbUrls) if (!used.has(image)) {
    URL.revokeObjectURL(url); thumbUrls.delete(image);
  }
  const scroll = el('pages').scrollTop, scrollX = el('pages').scrollLeft;
  el('pages').replaceChildren();
  for (const [index,item] of p.pages.entries()) {
    const li = document.createElement('li');
    const label = mode==='id' ? (item.side==='front'?'证件正面':'证件反面') : `第 ${index+1} 页`;
    li.className = 'page-item' + (current?.id===item.id ? ' selected' : '');
    li.draggable = mode!=='id' && !busy && !crop;
    const choose = document.createElement('button');
    choose.title = item.name;
    choose.setAttribute('aria-pressed',String(current?.id===item.id));
    choose.disabled = Boolean(busy || crop);
    const image = document.createElement('img');
    if (!thumbUrls.has(item.thumb)) thumbUrls.set(item.thumb,URL.createObjectURL(item.thumb));
    image.src = thumbUrls.get(item.thumb);
    image.alt = '';
    image.loading = 'lazy';
    const text = document.createElement('span');
    text.textContent = label;
    choose.append(image,text);
    choose.addEventListener('click',()=>selection(item.id,item.side));
    li.append(choose);
    if (mode!=='id') {
      li.addEventListener('dragstart',event=>{
        dragged=item.id;
        event.dataTransfer.effectAllowed='move';
        event.dataTransfer.setData('text/plain',label);
      });
      li.addEventListener('dragover',event=>{
        if (!dragged) return;
        event.preventDefault(); li.classList.add('over');
      });
      li.addEventListener('dragleave',()=>li.classList.remove('over'));
      li.addEventListener('dragend',()=>{dragged=null;});
      li.addEventListener('drop',event=>{
        if (!dragged) return;
        event.preventDefault(); event.stopPropagation();
        move(dragged,index); dragged=null;
      });
      if (item.id===current?.id && p.pages.length>1) {
        const controls = document.createElement('div');
        controls.className='move';
        for (const [delta,label,key] of [[-1,'移到前一页','left'],[1,'移到后一页','right']]) {
          const button=document.createElement('button'), mark=document.createElement('span');
          mark.dataset.icon=key; mark.append(icon(key)); button.append(mark);
          button.title=label; button.setAttribute('aria-label',label);
          button.disabled=Boolean(busy || crop) || !p.pages[index+delta];
          button.addEventListener('click',()=>move(item.id,index+delta,label));
          controls.append(button);
        }
        li.append(controls);
      }
    }
    el('pages').append(li);
  }
  el('pages').scrollTop=scroll;
  el('pages').scrollLeft=scrollX;
}

function move(id,to,focus) {
  if (busy || crop) return;
  const pages = [...project().pages], from = pages.findIndex(p=>p.id===id);
  if (from<0 || from===to || !pages[to]) return;
  pages.splice(to,0,pages.splice(from,1)[0]);
  selected=id;
  updateProject({pages});
  if (focus) {
    const button=all('.page-item.selected .move button').find(button=>button.title===focus);
    (button?.disabled ? document.querySelector('.page-item.selected > button') : button)?.focus();
  }
}

function setPreview(url) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = url;
  if (url) el('preview').src = url;
  else el('preview').removeAttribute('src');
  el('preview-wrap').hidden=!url;
  el('preview-status').hidden=Boolean(url) || !page();
  el('preview-status').textContent=url ? '' : '正在生成预览…';
}

let shownPage, shownWatermark;
async function preview() {
  const current = page(), mark = project().watermark;
  if (crop || (current===shownPage && mark===shownWatermark)) return;
  shownPage = current; shownWatermark = mark;
  const epoch = ++previewEpoch;
  if (!current) { setPreview(null); return; }
  if (current.id !== el('preview').dataset.page) setPreview(null);
  let rendered;
  try {
    rendered=await renderPage(current,1100,mark);
    const blob=await jpeg(rendered,.91);
    if (epoch===previewEpoch && !crop) {
      el('preview').dataset.page=current.id;
      setPreview(URL.createObjectURL(blob));
    }
  } catch {
    if (epoch===previewEpoch) {
      setPreview(null);
      el('preview-status').textContent='无法显示这一页，请尝试替换图片。';
    }
  } finally { if (rendered) clearCanvas(rendered); }
}

function refresh() {
  const p=project(), current=page(), isId=mode==='id';
  const [heading,subtitle,title,copy]=descriptions[mode];
  el('heading').textContent=heading;
  el('subtitle').textContent=subtitle;
  el('empty-title').textContent=title;
  el('empty-copy').textContent=copy;
  el('count').textContent=isId ? `${p.pages.length} / 2 面` : `${p.pages.length} 页`;
  el('list-hint').textContent=isId?'点击缩略图检查对应一面。':'可拖动，或用选中页下方的按钮排序。';
  el('list-hint').hidden=!isId && p.pages.length<2;
  el('id-options').hidden=!isId;
  el('paper-field').hidden=isId;
  el('split').hidden=mode!=='book';
  el('undo').hidden=undo?.key!==activeKey();
  el('clear').hidden=!p.pages.length;
  el('empty').hidden=Boolean(current);
  el('preview-wrap').hidden=!current || !previewUrl;
  if (!current) el('preview-status').hidden=true;
  el('page-tools').hidden=!current || Boolean(crop);
  el('crop-layer').hidden=el('crop-controls').hidden=!crop;
  const locked=Boolean(busy || crop);
  for (const button of all('[data-mode]')) {
    button.disabled=locked; button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
  }
  for (const button of all('[data-side]')) {
    button.disabled=locked; button.setAttribute('aria-pressed',String(button.dataset.side===side));
  }
  const filter=current?.filter || p.filter;
  for (const button of all('[data-filter]')) {
    button.disabled=locked; button.setAttribute('aria-pressed',String(button.dataset.filter===filter));
  }
  el('filter-hint').textContent=filterHints[filter];
  for (const id of ['start-camera','start-images','add-camera','add-images','demo','draft','clear','undo','split','replace','retake','crop','remove','rotate',
    'watermark','watermark-text','watermark-opacity','filename','paper','quality','ocr-lang']) el(id).disabled=locked;
  el('add-pdf').hidden=el('start-pdf').hidden=isId;
  el('add-pdf').disabled=el('start-pdf').disabled=locked;
  el('export').disabled=el('ocr-all').disabled=el('apply').disabled=locked || !p.pages.length;
  el('ocr-page').disabled=locked || !current;
  el('progress').hidden=!busy;
  el('watermark').checked=p.watermark.enabled;
  el('watermark-status').textContent=p.watermark.enabled && p.watermark.text.trim() ? '已开启' : '关闭';
  el('watermark-text').value=p.watermark.text;
  el('watermark-opacity').value=p.watermark.opacity;
  el('paper').value=p.paper;
  el('quality').value=p.quality;
  el('filename').value=p.filename;
  list();
  void preview();
}

async function job(label, action, cancelable = false) {
  if (busy || crop) return;
  const controller = new AbortController();
  busy=controller;
  el('cancel-job').hidden=!cancelable;
  el('cancel-job').disabled=false;
  progress(label);
  refresh();
  try { await action(controller.signal); }
  catch (error) { notice(controller.signal.aborted ? '已停止。' : (error.message || '操作失败，请重试。')); }
  finally { busy=null; refresh(); }
}

function progress(label, current, total) {
  el('progress-label').textContent=label;
  const bar=el('progress-bar');
  if (total) { bar.max=total; bar.value=current; }
  else bar.removeAttribute('value');
}

function checkCapacity(pages) {
  if (pages.length>MAX_PAGES) throw new Error(`一份文档最多容纳 ${MAX_PAGES} 页。`);
  const other=activeKey()==='id'?projects.doc.pages:projects.id.pages;
  const total=[...pages,...other].reduce((sum,p)=>sum+p.blob.size+p.thumb.size,0);
  if (total>MAX_PROJECT) throw new Error('扫描素材已超过 240 MB，请先导出部分页面。');
}

function insert(items, {replace, side:target=side} = {}) {
  let pages=[...project().pages];
  if (mode==='id') {
    items=[{...items[0],side:target}];
    pages=pages.filter(p=>p.side!==target).concat(items).sort((a,b)=>a.side===b.side?0:a.side==='front'?-1:1);
    side=target;
  } else if (replace) {
    const index=pages.findIndex(p=>p.id===replace);
    if (index<0) throw new Error('原页面已被移除。');
    pages.splice(index,1,...items);
  } else {
    pages=pages.concat(items);
  }
  checkCapacity(pages);
  selected=items.at(-1).id;
  updateProject({pages},!busy);
  return pages.length;
}

async function importFiles(files, {replace, kind} = {}) {
  const list=[...files].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
  if (!list.length) return;
  const single=mode==='id' || Boolean(replace);
  if (single && list.length>1) { notice('补拍或证件单面请一次选择一张图片。'); return; }
  const count=project().pages.length;
  let failures=0, firstError='';
  await job('正在导入文件…',async signal=>{
    for (const [i,file] of list.entries()) {
      signal.throwIfAborted();
      progress(`读取文件 ${i+1} / ${list.length}`,i,list.length);
      try {
        if (file.size>MAX_FILE) throw new Error('单个文件超过 100 MB。');
        const isPdf=kind==='pdf' || (kind!=='image' && (file.type==='application/pdf' || /\.pdf$/i.test(file.name)));
        if (isPdf) {
          if (single) throw new Error('请为这一面选择图片。');
          const handle=await openPdf(file);
          try {
            const doc=handle.document;
            if (doc.numPages+project().pages.length>MAX_PAGES) throw new Error(`该 PDF 无法完整导入。一份文档最多容纳 ${MAX_PAGES} 页。`);
            for (let n=1;n<=doc.numPages;n++) {
              signal.throwIfAborted();
              progress(`读取 PDF 第 ${n} / ${doc.numPages} 页`,n-1,doc.numPages);
              const data=await renderPdfPage(doc,n,handle.pdf);
              try { insert([await makePage(data.canvas,`${file.name} · ${n}`,project().filter,false,data.text)]); }
              finally { clearCanvas(data.canvas); }
            }
          } finally { await handle.close(); }
        } else {
          const type=await imageType(file);
          const source=await decode(file.slice(0,file.size,type));
          try { insert([await makePage(source,file.name,page()?.id===replace ? page().filter : project().filter,true)],{replace}); }
          finally { clearCanvas(source); }
        }
      } catch (error) {
        if (signal.aborted) throw error;
        failures++;
        firstError ||= error.name==='PasswordException' ? '请先解除 PDF 的密码保护。' : (error.message || '文件无法读取。');
      }
    }
    const added=project().pages.length-count;
    notice(failures ? `新增 ${added} 页，${failures} 个文件未能完整导入。${firstError}`
      : single ? '照片已保存。' : `已导入 ${added} 页。`);
  },true);
}

function chooseImages(replace) {
  if (busy || crop) return;
  replaceInput=replace;
  el('images').multiple=!replace && mode!=='id';
  el('images').click();
}

const openCamera = setUpCamera(async (source,session,crop,split) => {
  const filter=session.replace ? page()?.filter : project().filter;
  const scan=await makePage(source,'相机拍摄',filter || 'original',crop);
  return insert(split ? await splitPage(scan) : [scan],session);
}, (replace,msg) => {
  notice(msg);
  // The file picker stays behind a deliberate user gesture after permission denial.
  el(replace?'replace':'add-images').focus();
});

function launchCamera(replace = false) {
  if (!busy && !crop) void openCamera(mode,replace?page()?.id:undefined,side,project().pages.length);
}

el('images').addEventListener('change',event=>{
  const files=[...event.target.files], replace=replaceInput;
  event.target.value=''; replaceInput=null;
  void importFiles(files,{replace,kind:'image'});
});
el('documents').addEventListener('change',event=>{
  const files=[...event.target.files]; event.target.value='';
  void importFiles(files,{kind:'pdf'});
});
for (const id of ['start-images','add-images']) el(id).onclick=()=>chooseImages();
for (const id of ['start-camera','add-camera']) el(id).onclick=()=>launchCamera();
for (const id of ['start-pdf','add-pdf']) el(id).onclick=()=>el('documents').click();
el('replace').onclick=()=>chooseImages(page()?.id);
el('retake').onclick=()=>launchCamera(true);

el('drop').addEventListener('dragover',event=>{
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  if (!busy && !crop) el('drop').classList.add('drag');
});
el('drop').addEventListener('dragleave',event=>{
  if (!el('drop').contains(event.relatedTarget)) el('drop').classList.remove('drag');
});
el('drop').addEventListener('drop',event=>{
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  el('drop').classList.remove('drag');
  void importFiles(event.dataTransfer.files);
});
window.addEventListener('dragover',event=>{ if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
window.addEventListener('drop',event=>{ if (event.dataTransfer.files.length) event.preventDefault(); });

for (const button of all('[data-mode]')) button.onclick=()=>{
  mode=button.dataset.mode;
  if (!project().pages.some(p=>p.id===selected)) selected=projects.doc.pages[0]?.id;
  persist(); refresh();
};
for (const button of all('[data-side]')) button.onclick=()=>selection(undefined,button.dataset.side);
for (const button of all('[data-filter]')) button.onclick=()=>{
  const filter=button.dataset.filter, current=page();
  if (!current) updateProject({filter});
  else updatePage({filter});
};
el('apply').onclick=()=>{
  const filter=page()?.filter || project().filter;
  updateProject({filter,pages:project().pages.map(p=>p.filter===filter?p:{...p,filter})});
  notice('已应用到全部页和后续新增页。');
};
el('remove').onclick=()=>{
  const item=page(), pages=project().pages;
  if (!item) return;
  const index=pages.indexOf(item);
  undo={key:activeKey(),item,index};
  const kept=pages.filter(p=>p!==item);
  selected=kept[Math.min(index,kept.length-1)]?.id;
  updateProject({pages:kept});
};
el('undo').onclick=()=>{
  const {index,item}=undo, pages=[...project().pages];
  if (mode==='id' && pages.some(p=>p.side===item.side)) { notice('该面已有新照片，请先保留当前版本。'); return; }
  pages.splice(index,0,item);
  try { checkCapacity(pages); }
  catch(error) { notice(error.message); return; }
  selected=item.id; if (item.side) side=item.side;
  undo=null; updateProject({pages});
};
el('clear').onclick=()=>{
  if (!confirm('清空当前文档中的全部页面？')) return;
  undo=null; selected=undefined;
  updateProject({pages:[]});
};
el('rotate').onclick=()=>updatePage({rotation:(page().rotation+90)%360});
el('split').onclick=()=>job('正在拆分跨页…',async()=>{
  const current=page();
  await pause();
  insert(await splitPage(current),{replace:current.id});
  notice('已按左页、右页拆分。');
});

const layer=el('crop-layer');
const polygon=document.createElementNS(svgNS,'polygon');
const overlay=document.createElementNS(svgNS,'svg');
overlay.setAttribute('viewBox','0 0 1000 1000'); overlay.setAttribute('preserveAspectRatio','none');
overlay.append(polygon); layer.append(overlay);
function updateCrop() {
  polygon.setAttribute('points',crop.map(([x,y])=>`${x*1000},${y*1000}`).join(' '));
  for (const [i,[x,y]] of crop.entries()) {
    const handle=layer.children[i+1];
    handle.style.left=`${x*100}%`; handle.style.top=`${y*100}%`;
  }
}
function moveCorner(index,x,y) {
  const next=crop.map((p,i)=>i===index?[Math.max(0,Math.min(1,x)),Math.max(0,Math.min(1,y))]:p);
  if (validQuad(next)) { crop=next; updateCrop(); }
}
for (const [index,label] of ['左上','右上','右下','左下'].entries()) {
  const handle=document.createElement('button');
  handle.setAttribute('aria-label',label+'裁切点');
  layer.append(handle);
  handle.addEventListener('pointerdown',event=>handle.setPointerCapture(event.pointerId));
  handle.addEventListener('pointermove',event=>{
    if (!handle.hasPointerCapture(event.pointerId)) return;
    const rect=layer.getBoundingClientRect();
    moveCorner(index,(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height);
  });
  handle.addEventListener('keydown',event=>{
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if (!delta) return;
    event.preventDefault();
    const step=event.shiftKey?.035:.008, [x,y]=crop[index];
    moveCorner(index,x+step*delta[0],y+step*delta[1]);
  });
}
el('crop').onclick=()=>{
  crop=page().quad;
  previewEpoch++;
  setPreview(URL.createObjectURL(page().blob));
  refresh(); updateCrop();
  layer.querySelector('button').focus();
};
el('reset-crop').onclick=()=>{ crop=fullQuad(); updateCrop(); };
el('cancel-crop').onclick=()=>{ crop=null; shownPage=null; refresh(); el('crop').focus(); };
el('save-crop').onclick=()=>{ const quad=crop; crop=null; updatePage({quad}); el('crop').focus(); };

el('watermark').onchange=()=>updateProject({watermark:{...project().watermark,enabled:el('watermark').checked}});
for (const [id,key,map] of [['watermark-text','text',String],['watermark-opacity','opacity',Number]]) {
  el(id).addEventListener('input',()=>{
    const watermark={...project().watermark,[key]:map(el(id).value)};
    updateProject({watermark},false);
    el('watermark-status').textContent=watermark.enabled && watermark.text.trim() ? '已开启' : '关闭';
    clearTimeout(previewTimer);
    previewTimer=setTimeout(preview,150);
  });
}
el('filename').oninput=()=>updateProject({filename:el('filename').value},false);
el('quality').onchange=()=>updateProject({quality:el('quality').value},false);
el('paper').onchange=()=>updateProject({paper:el('paper').value},false);
el('draft').onchange=()=>{saving=el('draft').checked; persist(true);};

el('cancel-job').onclick=()=>{
  busy?.abort(); el('cancel-job').disabled=true; progress('正在停止…');
};

el('export').onclick=()=>job('正在准备 PDF…',async signal=>{
  const p=project();
  if (p.watermark.enabled && !p.watermark.text.trim()) {
    el('watermark-text').closest('details').open=true;
    throw new Error('请填写水印内容，或关闭水印。');
  }
  const result=await exportPdf(p.pages,p,mode==='id',async(i,total)=>{
    progress(`正在生成第 ${i+1} / ${total} 页`,i,total);
    await pause();
  },signal);
  progress('请选择保存位置。');
  el('cancel-job').hidden=true;
  const saved=await saveFile(result,safeName(p.filename,'pdf'));
  notice(saved ? `PDF 已导出 · ${(result.size/1048576).toFixed(2)} MB` : '已取消保存。');
},true);

function recognize(batch) {
  return job('正在加载本机识别模型…',async signal=>{
    const pages=batch ? [...project().pages] : [page()];
    let worker, workerError, timer;
    const abort=()=>{void worker?.terminate().catch(()=>{});};
    const cancelled=new Promise((_,reject)=>signal.addEventListener('abort',()=>{abort();reject(signal.reason);},{once:true}));
    const failure=new Promise((_,reject)=>{workerError=reject;});
    void failure.catch(()=>{});
    const results=[];
    let index=0;
    try {
      for (const p of pages) {
        signal.throwIfAborted();
        let text=p.text && fullQuad().every(([x,y],i)=>x===p.quad[i][0] && y===p.quad[i][1]) ? p.text : '';
        progress(`识别第 ${index+1} / ${pages.length} 页`,index,pages.length);
        if (!text) {
          if (!worker) {
            timer=setTimeout(()=>workerError(new Error('识别模型加载超时，请重试。')),45000);
            let closing=false;
            const loading=createOcr(el('ocr-lang').value,event=>{
              if (event.status==='recognizing text' && !signal.aborted) progress(`识别第 ${index+1} / ${pages.length} 页`,index+event.progress,pages.length);
            },workerError).then(instance=>{
              if (signal.aborted || closing) { void instance.terminate(); throw new DOMException('已停止','AbortError'); }
              return instance;
            });
            try { worker=await Promise.race([loading,cancelled,failure]); }
            finally { closing=true; clearTimeout(timer); }
          }
          const image=await renderPage(p,2100,null,false);
          try {
            signal.throwIfAborted();
            const result=await Promise.race([worker.recognize(image),cancelled,failure]);
            text=result.data.text.replace(/(?<=\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu,'').trim();
          } finally { clearCanvas(image); }
        }
        results.push(batch ? `第 ${index+1} 页\n${text || '（未识别到文字）'}` : text);
        index++;
      }
      el('ocr-result').value=results.join('\n\n');
      el('ocr-dialog').showModal();
      if (!batch && !el('ocr-result').value) notice('未识别到文字，可换一张更清晰的照片。');
    } finally { await worker?.terminate().catch(()=>{}); }
  },true);
}
el('ocr-all').onclick=()=>recognize(true);
el('ocr-page').onclick=()=>recognize(false);
el('close-ocr').onclick=()=>el('ocr-dialog').close();
el('copy-ocr').onclick=async()=>{
  const field=el('ocr-result');
  try { await navigator.clipboard.writeText(field.value); }
  catch {
    field.focus(); field.select();
    if (!document.execCommand('copy')) { el('copy-ocr').textContent='请复制选中的文字'; return; }
  }
  el('copy-ocr').textContent='已复制';
};
el('ocr-dialog').addEventListener('close',()=>{el('copy-ocr').textContent='复制文字'; el('ocr-result').value='';});
el('save-ocr').onclick=async()=>{
  const button=el('save-ocr');
  button.disabled=true;
  try {
    const saved=await saveFile(new Blob([el('ocr-result').value],{type:'text/plain'}),safeName(project().filename.replace(/\.pdf$/i,''),'txt'));
    button.textContent=saved?'已保存 TXT':'保存 TXT';
  } catch { button.textContent='保存失败，重试'; }
  finally { button.disabled=false; }
};
el('ocr-dialog').addEventListener('close',()=>{el('save-ocr').textContent='保存 TXT';});

el('demo').onclick=()=>job('正在生成示例…',async()=>{
  const card=mode==='id';
  const source=canvas(card?1160:1200,card?760:1500),ctx=source.getContext('2d');
  ctx.fillStyle='#526c74'; ctx.fillRect(0,0,source.width,source.height);
  ctx.save(); ctx.translate(105,60); ctx.rotate(.028);
  const paperH=card?620:1330;
  ctx.fillStyle='#f4f1e8'; ctx.fillRect(0,0,985,paperH);
  ctx.fillStyle='#1e3851'; ctx.font='700 65px sans-serif';
  ctx.fillText(card?'SAMPLE CARD':'Treehouse Scan',62,126);
  ctx.font='37px sans-serif';
  ctx.fillText(card?'证件样张 · SAMPLE':'文件扫描样张',65,208);
  const lines=card?['FOR DEMONSTRATION ONLY','Document sample 2026','ID NUMBER: 000000000000']:['Document control record','This sample shows color and paper texture.','Keep the original red seal visible.','This page is a demonstration.','Reference number: SCAN-2026-01'];
  ctx.font='34px sans-serif';
  lines.forEach((line,i)=>ctx.fillText(line,65,325+i*69));
  ctx.translate(746,paperH-160); ctx.rotate(-.2);
  ctx.strokeStyle='#c67474'; ctx.lineWidth=7; ctx.beginPath(); ctx.arc(0,0,83,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='#c67474'; ctx.textAlign='center'; ctx.font='700 46px sans-serif'; ctx.fillText('样章',0,16);
  ctx.restore();
  try { insert([await makePage(source,'示例照片',project().filter,true)]); }
  finally { clearCanvas(source); }
});

if (globalThis.ScanAndroid) document.body.classList.add('native');
window.addEventListener('scan-back',event=>{
  const dialog=document.querySelector('dialog[open]');
  if (dialog) {
    dialog.close(); event.preventDefault();
  } else if (crop) {
    el('cancel-crop').click(); event.preventDefault();
  }
});
const stageObserver = new ResizeObserver(entries=>{
  el('preview-wrap').style.setProperty('--preview-limit',Math.max(1,entries[0].contentRect.width-35)+'px');
});
stageObserver.observe(el('stage'));

try {
  const draft=await readDraft();
  if (draft) {
    projects=draft.projects;
    mode=draft.mode;
    selected=projects.doc.pages[0]?.id;
    saving=el('draft').checked=true;
    el('draft-status').textContent='已恢复此设备的草稿。';
  }
} catch {
  el('draft-status').textContent='此浏览器无法访问本机草稿。';
}
refresh();
