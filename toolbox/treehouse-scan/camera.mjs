import { canvas, clearCanvas, fromSource, detectPaper, MAX_EDGE } from './scan.mjs';

const el = id => document.getElementById(id);
const message = text => { el('camera-status').textContent = text; };
const difference = (a,b) => a.reduce((sum,value,i) => sum+Math.abs(value-b[i]),0)/a.length;

function fingerprint(video) {
  const tiny = canvas(32,24), context = tiny.getContext('2d',{willReadFrequently:true});
  context.drawImage(video,0,0,32,24);
  const {data} = context.getImageData(0,0,32,24);
  clearCanvas(tiny);
  return Array.from({length:768},(_,i) => .3*data[4*i]+.59*data[4*i+1]+.11*data[4*i+2]);
}

export function setUpCamera(add, fallback) {
  const dialog = el('camera-dialog'), video = el('video');
  let stream, epoch = 0, timer, session, previous, lastShot, stableSince, active = false, torch = false;

  function close() {
    epoch++;
    clearInterval(timer);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    el('shutter').disabled = true;
    session = null;
  }

  async function capture() {
    if (active || !session || !video.videoWidth) return;
    active = true;
    const saved = session;
    el('shutter').disabled = true;
    el('finish-camera').disabled = true;
    el('close-camera').disabled = true;
    const still = fingerprint(video);
    let image;
    try {
      image = fromSource(video,video.videoWidth,video.videoHeight,MAX_EDGE);
      const split = saved.mode==='book' && el('camera-split').checked;
      const total = await add(image, saved, el('smart-crop').checked, split);
      lastShot = still;
      stableSince = 0;
      saved.frames++;
      if (session === saved) {
        el('camera-count').textContent = `当前文档 ${total} 页`;
        message('已拍摄，可以翻到下一页。');
        if (saved.replace || saved.mode==='id') dialog.close();
      }
    } catch (error) {
      if (session === saved) {
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

  function watch() {
    if (!el('auto-shot').checked || active || !session || video.readyState < 2) {
      previous = null; stableSince = 0; return;
    }
    const next = fingerprint(video);
    const now = performance.now();
    if (!previous || difference(previous,next) > 3.2) stableSince = now;
    previous = next;
    if (lastShot && difference(lastShot,next) < 4) return;
    if (!stableSince || now-stableSince < 900) return;
    const frame = fromSource(video,video.videoWidth,video.videoHeight,240);
    let found;
    try { found = detectPaper(frame); }
    finally { clearCanvas(frame); }
    if (found) { void capture(); return; }
    message('请让整页入镜，尽量使用有色差的桌面。也可以点拍摄。');
  }

  async function open(mode, replace, side, count) {
    if (!navigator.mediaDevices?.getUserMedia) return fallback(replace,'当前浏览器无法访问摄像头，可先拍照再导入。');
    const started = ++epoch;
    session = {mode,replace,side,frames:0};
    previous = lastShot = null;
    stableSince = 0; torch = false;
    el('torch').hidden = true;
    el('torch').setAttribute('aria-pressed','false');
    el('auto-shot').checked = false;
    el('auto-shot').disabled = mode==='id' || Boolean(replace);
    el('camera-split-option').hidden = mode!=='book' || Boolean(replace);
    el('camera-title').textContent = replace ? '补拍当前页' : mode==='book' ? '书籍连拍' : mode==='id' ? (side==='front'?'拍摄正面':'拍摄反面') : '文档连拍';
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
      message('让纸张四角入镜，按拍摄可继续添加。');
      timer = setInterval(watch,250);
    } catch {
      if (started!==epoch || !dialog.open) return;
      dialog.close();
      fallback(replace,'摄像头无法启动。请检查相机权限，或从相册导入。');
    }
  }

  el('shutter').addEventListener('click',capture);
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
  dialog.addEventListener('close',close);
  document.addEventListener('visibilitychange',() => { if (document.hidden && dialog.open) dialog.close(); });
  return open;
}
