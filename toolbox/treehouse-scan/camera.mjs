import { canvas, clearCanvas, fromSource, detectPaper, MAX_EDGE } from './scan.mjs?v=1.2.0';
import { quadDistance } from './paper.mjs?v=1.2.0';

const el = id => document.getElementById(id);
const message = text => { el('camera-status').textContent = text; };
const difference = (a,b) => a.reduce((sum,value,i) => sum+Math.abs(value-b[i]),0)/a.length;

export function setUpCamera(add, fallback) {
  const dialog = el('camera-dialog'), video = el('video');
  const outline = el('camera-outline'), polygon = outline.querySelector('polygon');
  const thumb=canvas(32,24).getContext('2d',{willReadFrequently:true});
  const preferences={doc:false,book:true};
  let stream, epoch = 0, timer, session, alignment, lastShot, stableSince, active = false, torch = false;

  function fingerprint(source) {
    thumb.drawImage(source,0,0,32,24);
    const {data}=thumb.getImageData(0,0,32,24);
    return Uint8Array.from({length:768},(_,i)=>.3*data[4*i]+.59*data[4*i+1]+.11*data[4*i+2]);
  }

  function showOutline(quad, locked = false) {
    outline.toggleAttribute('hidden',!quad);
    outline.classList.toggle('locked',locked);
    el('camera-guide').hidden=Boolean(quad) || !el('smart-crop').checked;
    const status=el('alignment-status');
    const text=!el('smart-crop').checked ? '' : locked ? '纸边已对准' : quad ? '正在对准纸边' : '请让纸张四角入镜';
    if (status.textContent!==text) status.textContent=text;
    if (!quad) return;
    const frame=el('camera-view').getBoundingClientRect(), image=video.getBoundingClientRect();
    const scale=Math.min(image.width/video.videoWidth,image.height/video.videoHeight);
    const width=video.videoWidth*scale, height=video.videoHeight*scale;
    const left=image.left-frame.left+(image.width-width)/2, top=image.top-frame.top+(image.height-height)/2;
    polygon.setAttribute('points',quad.map(([x,y])=>
      `${(left+x*width)*100/frame.width},${(top+y*height)*100/frame.height}`).join(' '));
  }

  function close() {
    epoch++;
    clearTimeout(timer);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    el('shutter').disabled = true;
    session = null;
    alignment=null;
    showOutline(null);
  }

  async function capture() {
    if (active || !session || !video.videoWidth) return;
    active = true;
    const saved = {...session,continuous:el('continuous-scan').checked};
    el('shutter').disabled = true;
    el('finish-camera').disabled = true;
    el('close-camera').disabled = true;
    let image;
    try {
      image = fromSource(video,video.videoWidth,video.videoHeight,MAX_EDGE);
      const still = fingerprint(image);
      const crop=el('smart-crop').checked;
      const split = saved.mode==='book' && el('camera-split').checked;
      const guide=crop && alignment?.locked && performance.now()-alignment.time<710
        && difference(alignment.frame,still)<5 ? alignment.quad : null;
      if (!saved.continuous) {
        dialog.close();
        close();
      } else {
        message('正在生成扫描件…');
      }
      const result = await add(image, saved, {crop,split,guide});
      if (!result) {
        if (dialog.open) message('这一页未保存，请重试。');
        return;
      }
      lastShot = still;
      stableSince = 0;
      if (dialog.open) {
        el('camera-count').textContent = `当前文档 ${result.total} 页`;
        message(result.needsCrop ? '已收录。未找到完整纸边，可在预览里裁边。' : '已完成这一页，可以翻到下一页。');
      }
    } catch (error) {
      if (dialog.open) {
        el('auto-shot').checked = false;
        message(error.message || '这张照片未能保存。');
      }
    } finally {
      if (image) clearCanvas(image);
      active = false;
      el('shutter').disabled = !session || !video.videoWidth;
      el('finish-camera').disabled = false;
      el('close-camera').disabled = false;
    }
  }

  function watch(started) {
    if (started!==epoch || !session) return;
    const now=performance.now();
    try {
      if (!active && video.readyState>=2) alignFrame(now);
    } finally {
      if (started===epoch) timer=setTimeout(()=>watch(started),Math.max(170,350-(performance.now()-now)));
    }
  }

  function alignFrame(now) {
    const auto=el('auto-shot').checked, autoCrop=el('smart-crop').checked;
    if (!auto && !autoCrop) { alignment=null; stableSince=0; return; }
    let frame, next, found, reused=false;
    try {
      frame=fromSource(video,video.videoWidth,video.videoHeight,320);
      next=fingerprint(frame);
      // An unmoving frame can keep its locked outline while still checking for motion.
      reused=alignment?.locked && now-alignment.measuredAt<1250 && difference(alignment.frame,next)<1.4;
      found=reused ? alignment.quad : detectPaper(frame,320);
    } catch {
      found=null;
    } finally { if (frame) clearCanvas(frame); }
    if (!found) {
      alignment=null; stableSince=0; showOutline(null); return;
    }
    const steady=alignment && quadDistance(alignment.quad,found)<.032 && difference(alignment.frame,next)<4;
    const quad=steady ? found.map(([x,y],i)=>[
      alignment.quad[i][0]*.42+x*.58,alignment.quad[i][1]*.42+y*.58
    ]) : found;
    alignment={quad,frame:next,time:now,measuredAt:reused?alignment.measuredAt:now,locked:Boolean(steady)};
    showOutline(autoCrop ? quad : null,autoCrop && alignment.locked);
    if (!steady || !stableSince) stableSince=now;
    if (auto && steady && now-stableSince>=710 && (!lastShot || difference(lastShot,next)>=4)) void capture();
  }

  function updateCaptureMode() {
    const continuous=el('continuous-scan').checked;
    el('finish-camera').hidden=!continuous;
    if (!session) return;
    if (session.mode==='doc') el('camera-title').textContent=session.replace ? '补拍当前页' : continuous ? '文档连拍' : '单页扫描';
  }

  async function open(mode, replace, side, count) {
    if (!navigator.mediaDevices?.getUserMedia) return fallback(replace,'当前浏览器无法访问摄像头，可先拍照再导入。');
    const started = ++epoch;
    session = {mode,replace,side};
    alignment = lastShot = null;
    stableSince = 0; torch = false;
    el('torch').hidden = true;
    el('torch').setAttribute('aria-pressed','false');
    el('auto-shot').checked = false;
    el('auto-shot').disabled = mode==='id' || Boolean(replace);
    const singleOnly=mode==='id' || Boolean(replace);
    el('continuous-option').hidden=singleOnly;
    el('continuous-scan').checked=!singleOnly && preferences[mode];
    el('camera-split-option').hidden = mode!=='book' || Boolean(replace);
    el('camera-title').textContent = replace ? '补拍当前页' : mode==='book' ? '书籍连拍' : mode==='id' ? (side==='front'?'拍摄正面':'拍摄反面') : '文档连拍';
    updateCaptureMode();
    el('camera-count').textContent = `当前文档 ${count} 页`;
    message('正在启动摄像头…');
    dialog.showModal();
    try {
      const media = await navigator.mediaDevices.getUserMedia({audio:false,video:{
        facingMode:{ideal:'environment'}, width:{ideal:2560}, height:{ideal:1920}
      }});
      if (started!==epoch || !dialog.open) { media.getTracks().forEach(track=>track.stop()); return; }
      stream = media;
      video.srcObject = stream;
      await video.play();
      if (started!==epoch || !dialog.open) return;
      el('torch').hidden = !stream.getVideoTracks()[0]?.getCapabilities?.().torch;
      el('shutter').disabled = false;
      message(el('continuous-scan').checked ? '扫描后可直接翻页。' : '扫描后会直接打开预览。');
      watch(started);
    } catch {
      if (started!==epoch || !dialog.open) return;
      dialog.close();
      fallback(replace,'摄像头无法启动。请检查相机权限，或从相册导入。');
    }
  }

  el('shutter').addEventListener('click',capture);
  el('smart-crop').addEventListener('change',()=>{ alignment=null; showOutline(null); });
  el('continuous-scan').addEventListener('change',()=>{
    if (session) preferences[session.mode]=el('continuous-scan').checked;
    updateCaptureMode();
    if (video.readyState>=2) message(el('continuous-scan').checked ? '扫描后可直接翻页。' : '扫描后会直接打开预览。');
  });
  for (const id of ['close-camera','finish-camera']) el(id).addEventListener('click',() => dialog.close());
  el('torch').addEventListener('click',async () => {
    const track = stream?.getVideoTracks()[0];
    try {
      if (!track) return;
      await track.applyConstraints({advanced:[{torch:!torch}]});
      torch = !torch;
      el('torch').setAttribute('aria-pressed',String(torch));
      el('torch').textContent = torch ? '关闭补光' : '补光';
    } catch { message('此摄像头无法切换补光。'); }
  });
  dialog.addEventListener('cancel',event => { if (active) event.preventDefault(); });
  dialog.addEventListener('close',()=>{ if (!dialog.open) close(); });
  document.addEventListener('visibilitychange',() => { if (document.hidden && dialog.open) dialog.close(); });
  return open;
}
