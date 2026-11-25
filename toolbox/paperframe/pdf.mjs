import { AnnotationMode, getDocument, GlobalWorkerOptions } from './vendor/pdfjs/pdf.mjs';
import { encodeCanvas } from './images.mjs';

const vendor = (name) => new URL(`./vendor/pdfjs/${name}`, import.meta.url).href;
GlobalWorkerOptions.workerSrc = vendor('pdf.worker.mjs');
GlobalWorkerOptions.rendererSrc = vendor('pdf.renderer.mjs');

const maxFileSize = 512 * 1024 ** 2;
const maxPixels = 50_000_000;
const inactivityMs = 120_000;

function timebox(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('处理超时')), inactivityMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function withDocument(file, signal, operation) {
  signal.throwIfAborted();
  if (file.size > maxFileSize) throw new Error('文件超过 512 MB');
  const data = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const task = getDocument({
    data,
    cMapUrl: vendor('cmaps/'),
    standardFontDataUrl: vendor('standard_fonts/'),
    wasmUrl: vendor('wasm/'),
    iccUrl: vendor('iccs/'),
    enableXfa: false,
    isEvalSupported: false,
    stopAtErrors: true,
  });
  let destruction;
  const stop = () => { destruction ??= task.destroy().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    const pdf = await timebox(task.promise);
    if (!pdf.numPages) throw new Error('PDF 中没有页面');
    return await operation(pdf);
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
    await destruction;
  }
}

export async function inspectPDF(file, signal) {
  return withDocument(file, signal, async (pdf) => {
    let title;
    try {
      const { info, metadata } = await timebox(pdf.getMetadata());
      const titles = [metadata?.get('dc:title'), info?.Title];
      title = titles.find((value) => typeof value === 'string' && value.trim() &&
        !/^(?:文章编号|中图分类号|文献标识码|doi\s*[:：]|microsoft\s+word|untitled\b|无标题)/iu.test(value.trim()));
    } catch (error) {
      signal.throwIfAborted();
      if (error.message === '处理超时') throw error;
    }
    return { title: title?.trim() || file.name.replace(/\.pdf$/iu, ''), pages: pdf.numPages };
  });
}

export async function convertPDF(file, options, signal, onPage) {
  const { dpi, format } = options;
  if (!Number.isInteger(dpi) || dpi < 400 || dpi > 1200 || !['png', 'jpg'].includes(format)) throw new Error('导出设置无效');
  return withDocument(file, signal, async (pdf) => {
    const canvas = document.createElement('canvas');
    const digits = Math.max(3, String(pdf.numPages).length);
    try {
      for (let number = 1; number <= pdf.numPages; number++) {
        signal.throwIfAborted();
        const page = await timebox(pdf.getPage(number));
        const viewport = page.getViewport({ scale: dpi / 72 });
        // Scaling from points can put an exact pixel boundary one floating-point step above the integer.
        const width = Math.ceil(viewport.width - Number.EPSILON * viewport.width);
        const height = Math.ceil(viewport.height - Number.EPSILON * viewport.height);
        if (!(width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= maxPixels)) {
          throw new Error(`第 ${number} 页尺寸超过浏览器导出上限`);
        }
        canvas.width = width;
        canvas.height = height;
        const task = page.render({ canvas, viewport, background: '#ffffff', annotationMode: AnnotationMode.ENABLE });
        try {
          await timebox(task.promise);
        } finally {
          task.cancel();
          page.cleanup();
        }
        signal.throwIfAborted();
        const image = await timebox(encodeCanvas(canvas, format, dpi, options.color));
        signal.throwIfAborted();
        await onPage({ name: `第${String(number).padStart(digits, '0')}页.${format}`, image, number, total: pdf.numPages });
      }
      return pdf.numPages;
    } finally {
      canvas.width = canvas.height = 0;
    }
  });
}

export async function previewPDF(file, signal, tiles) {
  return withDocument(file, signal, async (pdf) => {
    for (const [number, tile] of tiles) {
      signal.throwIfAborted();
      if (!tile.isConnected) return;
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(106 / natural.width, 112 / natural.height) });
      if (!(viewport.width > 0 && viewport.height > 0)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const task = page.render({ canvas, viewport, background: '#fff', annotationMode: AnnotationMode.DISABLE });
      try {
        await timebox(task.promise);
        if (!signal.aborted && tile.isConnected) tile.prepend(canvas);
      } finally {
        task.cancel();
        page.cleanup();
      }
    }
  });
}

export async function editPDF(files, changes, signal) {
  const size = files.reduce((sum, item) => sum + item.file.size, 0);
  if (size > maxFileSize) throw new Error('合计文件超过 512 MB，请分批处理');
  const first = files[0];
  const output = await withDocument(first.file, signal, async (pdf) => {
    const documents = [{ document: null, ...changes }];
    for (const { file } of files.slice(1)) {
      signal.throwIfAborted();
      documents.push({ document: new Uint8Array(await file.arrayBuffer()) });
    }
    const bytes = await timebox(pdf.extractPages(documents));
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('无法生成完整的 PDF');
    return new Blob([bytes], { type: 'application/pdf' });
  });
  const pages = await withDocument(output, signal, (pdf) => pdf.numPages);
  return { output, pages };
}

export function pdfError(error) {
  const message = error?.message ?? '';
  if (error?.name === 'PasswordException') return '需要密码，请先解锁';
  if (error?.name === 'InvalidPDFException') return 'PDF 损坏或格式无效';
  if (/^(?:第 \d+ 页|文件超过|处理超时|图片编码失败|PDF 中没有)/u.test(message)) return message;
  return '无法读取或完整渲染该 PDF';
}
