import { detectDocument, warpPerspective } from './vendor/doc-scanner/index.js';
import { filterPixels } from './filters.mjs?v=1.1.0';

export const fullQuad = () => [[0, 0], [1, 0], [1, 1], [0, 1]];
export const MAX_EDGE = 3200;
export const MAX_FILE = 100 * 1024 * 1024;
export const MAX_PAGES = 240;
export const MAX_PROJECT = 240 * 1024 * 1024;

export function canvas(width, height) {
  const element = document.createElement('canvas');
  element.width = Math.max(1, Math.round(width));
  element.height = Math.max(1, Math.round(height));
  return element;
}

export function clearCanvas(element) { element.width = element.height = 1; }

export function scaledSize(width, height, limit) {
  const ratio = Math.min(1, limit / Math.max(width, height));
  return [width * ratio, height * ratio];
}

export function validQuad(points) {
  if (points.length !== 4 || !points.every(p => p.every(v => v >= 0 && v <= 1))) return false;
  return points.every(([x,y], i) => {
    const [u,v] = points[(i + 1) % 4];
    const [s,t] = points[(i + 2) % 4];
    return (u - x) * (t - v) - (v - y) * (s - u) > .0012;
  });
}

export function jpeg(element, quality = .95) {
  return new Promise((resolve, reject) => {
    element.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成图片。')), 'image/jpeg', quality);
  });
}

export function fromSource(source, width, height, limit) {
  const element = canvas(...scaledSize(width, height, limit));
  try {
    const context = element.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, element.width, element.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, element.width, element.height);
    return element;
  } catch (error) { clearCanvas(element); throw error; }
}

export async function decode(blob, limit = MAX_EDGE) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 50_000_000) throw new Error('单张图片超过 5000 万像素。');
    return fromSource(image, image.naturalWidth, image.naturalHeight, limit);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imageType(file) {
  const h = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const at = (i, str) => Array.from(str).every((c, j) => h[i + j] === c.charCodeAt(0));
  if (h[0] === 255 && h[1] === 216 && h[2] === 255) return 'image/jpeg';
  if (h[0] === 137 && at(1, 'PNG') && h[4] === 13 && h[5] === 10 && h[6] === 26 && h[7] === 10) return 'image/png';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(0, 'BM')) return 'image/bmp';
  if (at(4, 'ftyp') && (at(8, 'avif') || at(8, 'avis'))) return 'image/avif';
  throw new Error('请选择 JPG、PNG、WebP、BMP 或 AVIF 图片。');
}

export function detectPaper(source, limit = 900) {
  const small = fromSource(source, source.width, source.height, limit);
  const { width, height } = small;
  try {
    const image = small.getContext('2d').getImageData(0,0,width,height);
    const detected = detectDocument(image,{workSize:Math.min(400,limit),refineSize:limit,minArea:.10});
    if (!detected) return null;
    const quad = detected.corners.map(({x,y})=>[Math.max(0,Math.min(1,x/width)), Math.max(0,Math.min(1,y/height))]);
    return validQuad(quad) ? quad : null;
  } finally { clearCanvas(small); }
}

function straighten(source, quad, limit) {
  const unchanged = fullQuad().every(([x,y],i)=>x===quad[i][0] && y===quad[i][1]);
  if (unchanged) return fromSource(source,source.width,source.height,limit);
  const {width,height} = source;
  const pixels = source.getContext('2d').getImageData(0,0,width,height);
  const points = quad.map(([x,y])=>({x:x*width,y:y*height}));
  const output = warpPerspective(pixels,points,{maxSide:limit});
  const result = canvas(output.width,output.height);
  result.getContext('2d',{alpha:false}).putImageData(new ImageData(output.data,output.width,output.height),0,0);
  return result;
}
function filter(element, mode) {
  if (mode === 'original') return;
  const context = element.getContext('2d');
  const {width,height} = element;
  const image = context.getImageData(0,0,width,height);
  const output=filterPixels(image,mode);
  context.putImageData(output===image ? image : new ImageData(output.data,width,height),0,0);
}

export function addWatermark(element, { enabled, text, opacity }) {
  if (!enabled || !text.trim()) return;
  const context = element.getContext('2d');
  const {width:w,height:h} = element;
  context.save();
  context.translate(w/2,h/2);
  context.rotate(-Math.PI/7);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `600 ${Math.max(12, Math.round(Math.min(w,h)*.063))}px sans-serif`;
  context.fillStyle = `rgba(36,66,72,${opacity/100})`;
  for (const position of [-.27, 0, .27]) context.fillText(text.trim(),0,h*position,w*.88);
  context.restore();
}

export async function renderPage(page, limit, watermark, applyFilter = true) {
  // Decode at greater resolution than the requested preview so crop previews retain detail.
  const source = await decode(page.blob, Math.min(MAX_EDGE, Math.max(1200, limit * 1.7)));
  let result;
  try { result = straighten(source, page.quad, limit); }
  finally { clearCanvas(source); }
  if (page.rotation) {
    const swap = page.rotation % 180 !== 0;
    const next = canvas(swap ? result.height : result.width, swap ? result.width : result.height);
    const context = next.getContext('2d');
    context.translate(next.width/2,next.height/2);
    context.rotate(page.rotation * Math.PI/180);
    context.drawImage(result,-result.width/2,-result.height/2);
    clearCanvas(result);
    result = next;
  }
  if (applyFilter) filter(result, page.filter);
  if (watermark) addWatermark(result, watermark);
  return result;
}

export async function makePage(source, name, mode, crop, text = '') {
  const found = crop ? detectPaper(source) : null;
  const quad = found || fullQuad();
  const cropState = found ? 'auto' : crop ? 'review' : 'whole';
  const tiny = fromSource(source, source.width, source.height, 180);
  try {
    const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
    return { id, name, blob:await jpeg(source, .96), thumb:await jpeg(tiny, .77), quad, cropState, rotation:0, filter:mode, text };
  } finally { clearCanvas(tiny); }
}

export async function splitPage(page) {
  const image = await renderPage(page, MAX_EDGE, null, false);
  try {
    if (image.width < 4) throw new Error('图片太窄，无法拆分。');
    const seam = Math.floor(image.width/2);
    const pages = [];
    for (let i=0;i<2;i++) {
      const left = i ? seam : 0, width = i ? image.width-seam : seam;
      const half = canvas(width,image.height);
      try {
        half.getContext('2d').drawImage(image,left,0,width,image.height,0,0,width,image.height);
        pages.push(await makePage(half, page.name + (i ? ' · 右页' : ' · 左页'), page.filter, false));
      } finally { clearCanvas(half); }
    }
    return pages;
  } finally { clearCanvas(image); }
}
