import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from './vendor/pdflib/pdf-lib.mjs';

const a4 = [595.28, 841.89];
const fileLimit = 512 * 1024 ** 2;
const imageLimit = 64 * 1024 ** 2;

async function readImage(file, maxEdge = Infinity) {
  if (file.size > imageLimit) throw new Error('单张图片超过 64 MB');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8)) === 'WEBP';
  if (!png && !jpg && !webp) throw new Error('图片格式无效，请使用 PNG、JPG 或 WebP');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('图片损坏或无法读取'); });
  try {
    if (bitmap.width * bitmap.height > 50_000_000 || bitmap.width > 16384 || bitmap.height > 16384) {
      throw new Error('图片超过浏览器处理尺寸上限');
    }
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = jpg ? 'image/jpeg' : 'image/png';
    const blob = await canvas.convertToBlob({ type, quality: 0.97 });
    const output = { bytes: await blob.arrayBuffer(), type, width: canvas.width, height: canvas.height };
    canvas.width = canvas.height = 0;
    return output;
  } finally {
    bitmap.close();
  }
}

function embedImage(pdf, image) {
  return image.type === 'image/jpeg' ? pdf.embedJpg(image.bytes) : pdf.embedPng(image.bytes);
}

async function imagesToPDF(files, paperSize) {
  const pdf = await PDFDocument.create();
  for (const [index, file] of files.entries()) {
    const image = await readImage(file);
    const embedded = await embedImage(pdf, image);
    const ratio = Math.min(0.75, 14_400 / Math.max(image.width, image.height));
    const size = paperSize === 'a4' ? (image.width > image.height ? [...a4].reverse() : a4) : [image.width * ratio, image.height * ratio];
    const page = pdf.addPage(size);
    const margin = paperSize === 'a4' ? 22 : 0;
    const fit = Math.min((size[0] - 2 * margin) / image.width, (size[1] - 2 * margin) / image.height);
    const width = image.width * fit;
    const height = image.height * fit;
    page.drawImage(embedded, { x: (size[0] - width) / 2, y: (size[1] - height) / 2, width, height });
    await embedded.embed();
    postMessage({ progress: index + 1 });
  }
  return pdf;
}

async function textImage(text, color) {
  const probe = new OffscreenCanvas(1, 1).getContext('2d');
  const font = 'bold 146px "Microsoft YaHei", "PingFang SC", sans-serif';
  probe.font = font;
  const canvas = new OffscreenCanvas(Math.ceil(probe.measureText(text).width) + 32, 202);
  const context = canvas.getContext('2d');
  context.font = font;
  context.textBaseline = 'middle';
  context.fillStyle = color;
  context.fillText(text, 16, 101);
  const blob = await canvas.convertToBlob();
  return { bytes: await blob.arrayBuffer(), width: canvas.width, height: canvas.height, type: 'image/png' };
}

const activeActions = new Set(['JavaScript','Launch','SubmitForm','ImportData','GoToR','GoToE','Rendition','Movie','Sound']);
const key = (name) => PDFName.of(name);

function stripActiveContent(pdf) {
  const visited = new Set();
  const pending = [pdf.catalog];
  while (pending.length) {
    const object = pending.pop();
    if (object instanceof PDFRef) {
      const entry = pdf.context.lookup(object);
      if (entry) pending.push(entry);
      continue;
    }
    if (visited.has(object)) continue;
    visited.add(object);
    if (object instanceof PDFDict) {
      const kind = object.lookup(key('S'));
      if (kind instanceof PDFName && activeActions.has(kind.decodeText())) {
        for (const name of object.keys()) object.delete(name);
        continue;
      }
      for (const name of ['AA','OpenAction','JavaScript','JS','EmbeddedFiles','AF','XFA']) object.delete(key(name));
      for (const value of object.values()) if (value instanceof PDFDict || value instanceof PDFArray || value instanceof PDFRef) pending.push(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) if (value instanceof PDFDict || value instanceof PDFArray || value instanceof PDFRef) pending.push(value);
    }
  }
}

function markPage(page, mark, image, settings) {
  const box = page.getCropBox();
  const rotation = (page.getRotation().angle % 360 + 360) % 360;
  const turned = rotation === 90 || rotation === 270;
  const width = turned ? box.height : box.width;
  const height = turned ? box.width : box.height;
  const angle = rotation + settings.angle;
  const radians = angle * Math.PI / 180;
  const localRadians = settings.angle * Math.PI / 180;
  const tile = settings.position === 'tile';
  const target = tile ? .22 : .48;
  const fit = Math.min(width * target / image.width, height * (tile ? .13 : .28) / image.height);
  const markWidth = image.width * fit;
  const markHeight = image.height * fit;
  const halfWidth = (Math.abs(Math.cos(localRadians)) * markWidth + Math.abs(Math.sin(localRadians)) * markHeight) / 2;
  const halfHeight = (Math.abs(Math.sin(localRadians)) * markWidth + Math.abs(Math.cos(localRadians)) * markHeight) / 2;
  const xInset = Math.min(width / 2, width * .06 + halfWidth);
  const yInset = Math.min(height / 2, height * .06 + halfHeight);
  const positions = {
    center: [[width / 2,height / 2]], tl: [[xInset,height-yInset]], tr: [[width-xInset,height-yInset]],
    bl: [[xInset,yInset]], br: [[width-xInset,yInset]],
    tile: [.18,.5,.82].flatMap((u) => [.17,.39,.61,.83].map((v) => [u * width, v * height])),
  };
  for (const [u,v] of positions[settings.position]) {
    const points = { 0: [u,v], 90: [box.width-v,u], 180: [box.width-u,box.height-v], 270: [v,box.height-u] };
    const [x,y] = points[rotation] ?? points[0];
    page.drawImage(mark, {
      x: box.x + x - (Math.cos(radians) * markWidth - Math.sin(radians) * markHeight) / 2,
      y: box.y + y - (Math.sin(radians) * markWidth + Math.cos(radians) * markHeight) / 2,
      width: markWidth, height: markHeight, rotate: degrees(angle), opacity: settings.opacity / 100,
    });
  }
}

async function watermarkPDF(file, settings) {
  let pdf;
  try {
    pdf = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  } catch {
    throw new Error('无法编辑这个 PDF，请确认文件完整且已解锁');
  }
  const image = settings.file ? await readImage(settings.file, 2200) : await textImage(settings.text, settings.color);
  const mark = await embedImage(pdf, image);
  stripActiveContent(pdf);
  for (const [index,page] of pdf.getPages().entries()) {
    markPage(page, mark, image, settings);
    postMessage({ progress: index + 1 });
  }
  return pdf;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.files.reduce((size, file) => size + file.size, 0) > fileLimit) throw new Error('合计文件超过 512 MB，请分批处理');
    const pdf = data.operation === 'image' ? await imagesToPDF(data.files, data.paperSize) : await watermarkPDF(data.files[0], data.settings);
    const bytes = await pdf.save({ updateFieldAppearances: false });
    postMessage({ output: new Blob([bytes], { type: 'application/pdf' }) });
  } catch (error) {
    postMessage({ error: error.message });
  }
};
