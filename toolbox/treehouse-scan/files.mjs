import { canvas, clearCanvas, renderPage, jpeg, addWatermark } from './scan.mjs';

const path = name => new URL('./vendor/' + name, import.meta.url).href;

export async function openPdf(file) {
  const head = new TextDecoder().decode(await file.slice(0,1024).arrayBuffer());
  if (!head.includes('%PDF-')) throw new Error('所选文件不是有效的 PDF。');
  const pdf = await import('./vendor/pdfjs/pdf.mjs');
  pdf.GlobalWorkerOptions.workerSrc = path('pdfjs/pdf.worker.mjs');
  const task = pdf.getDocument({
    data: await file.arrayBuffer(), isEvalSupported: false, enableXfa: false,
    useSystemFonts: false, maxImageSize: 24_000_000, canvasMaxAreaInBytes: 48_000_000,
    cMapUrl: path('pdfjs/cmaps/'), cMapPacked: true, standardFontDataUrl: path('pdfjs/standard_fonts/'),
    iccUrl: path('pdfjs/iccs/'), wasmUrl: path('pdfjs/wasm/')
  });
  try { return { pdf, document: await task.promise, close: () => task.destroy() }; }
  catch (error) { await task.destroy(); throw error; }
}

export async function renderPdfPage(doc, i, pdf) {
  const page = await doc.getPage(i);
  let result;
  try {
    const original = page.getViewport({scale:1});
    const viewport = page.getViewport({scale:Math.min(4, 2800 / Math.max(original.width,original.height))});
    result = canvas(viewport.width,viewport.height);
    await page.render({canvas:result, viewport, annotationMode:pdf.AnnotationMode.ENABLE}).promise;
    const content = await page.getTextContent().catch(() => ({items:[]}));
    // Use existing text only when meaningful. Scanned pages fall back to OCR.
    const text = content.items.map(item => item.str ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
    return {canvas:result,text:text.length > 12 ? text : ''};
  } catch (error) {
    if (result) clearCanvas(result);
    throw error;
  } finally { page.cleanup(); }
}

export async function createOcr(langs, logger, errorHandler) {
  const { default: tesseract } = await import('./vendor/ocr/tesseract.esm.min.js');
  return tesseract.createWorker(langs.split('+'), 1, {
    workerPath:path('ocr/worker.min.js'), corePath:path('ocr/core/'), langPath:path('ocr/lang/'),
    workerBlobURL:false, cacheMethod:'none', logger, errorHandler
  });
}

export class ImagePdf {
  chunks = [];
  offsets = [0];
  pageRefs = [];
  length = 0;
  encoder = new TextEncoder();

  constructor() {
    this.write('%PDF-1.4\n');
    this.write(new Uint8Array([37,255,255,255,255,10]));
    this.next = 3;
  }

  write(chunk) {
    const bytes = typeof chunk === 'string' ? this.encoder.encode(chunk) : chunk;
    this.chunks.push(bytes);
    this.length += bytes.size ?? bytes.byteLength;
  }

  object(number, contents, image) {
    this.offsets[number] = this.length;
    this.write(`${number} 0 obj\n${contents}\n`);
    if (image) {
      this.write('stream\n'); this.write(image); this.write('\nendstream\n');
    }
    this.write('endobj\n');
  }

  append(image, width, height, a4) {
    const id = this.next;
    this.next += 3;
    this.pageRefs.push(`${id} 0 R`);
    const [pw,ph] = a4 ? (width > height ? [841.89,595.28] : [595.28,841.89])
      : [width,height].map(v => v * 595.28 / (width > height ? height : width));
    const ratio = Math.min(pw/width,ph/height);
    const w = width*ratio, h = height*ratio;
    const n = value => value.toFixed(3);
    const draw = `q ${n(w)} 0 0 ${n(h)} ${n((pw-w)/2)} ${n((ph-h)/2)} cm /Im Do Q\n`;
    this.object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pw)} ${n(ph)}] /Resources << /XObject << /Im ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    this.object(id+1, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.size} >>`, image);
    this.object(id+2,`<< /Length ${draw.length} >>\nstream\n${draw}endstream`);
  }

  finish() {
    this.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    this.object(2, `<< /Type /Pages /Kids [${this.pageRefs.join(' ')}] /Count ${this.pageRefs.length} >>`);
    const offset = this.length;
    const refs = this.offsets.slice(1).map(value => String(value).padStart(10,'0') + ' 00000 n \n').join('');
    this.write(`xref\n0 ${this.next}\n0000000000 65535 f \n${refs}trailer\n<< /Root 1 0 R /Size ${this.next} >>\nstartxref\n${offset}\n%%EOF\n`);
    return new Blob(this.chunks, {type:'application/pdf'});
  }
}

const qualities = { high:[2800,.93], normal:[1800,.86], small:[1200,.75] };
export async function exportPdf(pages, project, idMode, onPage, signal) {
  const [limit, quality] = qualities[project.quality];
  const pdf = new ImagePdf();
  if (idMode) {
    const sheet = canvas(limit*210/297, limit);
    const context = sheet.getContext('2d');
    const mm = limit/297;
    try {
      context.fillStyle = 'white';
      context.fillRect(0,0,sheet.width,sheet.height);
      for (let i=0; i<pages.length; i++) {
        signal.throwIfAborted();
        await onPage(i, pages.length);
        const card = await renderPage(pages[i], limit);
        const ratio = Math.min(85.6*mm/card.width, 54*mm/card.height);
        const w = card.width*ratio, h = card.height*ratio;
        context.drawImage(card, (sheet.width-w)/2, mm*(i ? 160 : 69)+(54*mm-h)/2,w,h);
        clearCanvas(card);
      }
      addWatermark(sheet, project.watermark);
      pdf.append(await jpeg(sheet,quality), sheet.width, sheet.height, true);
    } finally { clearCanvas(sheet); }
  } else {
    for (let i=0;i<pages.length;i++) {
      signal.throwIfAborted();
      await onPage(i, pages.length);
      const page = await renderPage(pages[i], limit, project.watermark);
      try { pdf.append(await jpeg(page,quality),page.width,page.height,project.paper==='a4'); }
      finally { clearCanvas(page); }
    }
  }
  signal.throwIfAborted();
  return pdf.finish();
}

export function safeName(value, extension) {
  const simple = value.replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]/gu,'_').trim().replace(/[. ]+$/g,'');
  const base = simple.replace(new RegExp('\\.' + extension + '$', 'i'),'');
  return (base || '树影扫描') + '.' + extension;
}

export async function saveFile(blob, name) {
  if (globalThis.ScanAndroid) {
    const token = globalThis.ScanAndroid.startExport(name, blob.type, blob.size);
    if (!token) throw new Error('无法创建导出文件。');
    try {
      for (let offset=0; offset<blob.size; offset+=384*1024) {
        const bytes = new Uint8Array(await blob.slice(offset,offset+384*1024).arrayBuffer());
        let binary = '';
        for (let j=0;j<bytes.length;j+=8192) binary += String.fromCharCode(...bytes.subarray(j,j+8192));
        if (!globalThis.ScanAndroid.writeExport(token,btoa(binary))) throw new Error('无法写入导出文件。');
      }
      const outcome = new Promise(resolve => {
        function onResult(event) {
          if (event.detail.token !== token) return;
          window.removeEventListener('scan-export',onResult);
          resolve(event.detail.saved);
        }
        window.addEventListener('scan-export',onResult);
        if (!globalThis.ScanAndroid.finishExport(token)) {
          window.removeEventListener('scan-export',onResult);
          resolve(false);
        }
      });
      return await outcome;
    } finally { globalThis.ScanAndroid.abortExport(token); }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href),60_000);
  return true;
}
