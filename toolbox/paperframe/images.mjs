const pngType = 'image/png';
const jpgType = 'image/jpeg';
const physicalChunkType = 0x70485973;
const crcTable = Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = (byte >>> 1) ^ ((byte & 1) ? 0xedb88320 : 0);
  return byte;
});

async function pngDensity(blob, dpi) {
  const chunk = new Uint8Array(21);
  const data = new DataView(chunk.buffer);
  const dotsPerMeter = Math.round(dpi / 0.0254);
  data.setUint32(0, 9);
  data.setUint32(4, physicalChunkType);
  data.setUint32(8, dotsPerMeter);
  data.setUint32(12, dotsPerMeter);
  chunk[16] = 1;
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 17)) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  data.setUint32(17, (crc ^ 0xffffffff) >>> 0);

  // PNG requires one pHYs chunk before the first IDAT. Retain color profile and image data.
  const parts = [blob.slice(0, 33), chunk];
  let offset = 33;
  while (offset + 12 <= blob.size) {
    const header = new DataView(await blob.slice(offset, offset + 8).arrayBuffer());
    const type = header.getUint32(4);
    if (type === 0x49444154 || type === 0x49454e44) break;
    const end = offset + 12 + header.getUint32(0);
    if (end > blob.size) throw new Error('图片编码失败');
    if (type !== physicalChunkType) parts.push(blob.slice(offset, end));
    offset = end;
  }
  parts.push(blob.slice(offset));
  return new Blob(parts, { type: pngType });
}

async function jpegDensity(blob, dpi) {
  const prefix = new Uint8Array(await blob.slice(0, 20).arrayBuffer());
  const header = Uint8Array.of(255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0);
  const matchingJfif = prefix[2] === 255 && prefix[3] === 224 &&
    header.subarray(4, 9).every((value, index) => value === prefix[index + 6]);
  const data = new DataView(header.buffer);
  data.setUint16(12, dpi);
  data.setUint16(14, dpi);
  const offset = matchingJfif ? 4 + new DataView(prefix.buffer).getUint16(4) : 2;
  return new Blob([blob.slice(0, 2), header, blob.slice(offset)], { type: jpgType });
}

export async function encodeCanvas(canvas, format, dpi, color) {
  if (color === 'gray') {
    const context = canvas.getContext('2d');
    context.filter = 'grayscale(1)';
    context.drawImage(canvas, 0, 0);
    context.filter = 'none';
  }
  const mime = format === 'jpg' ? jpgType : pngType;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.97));
  if (!blob || blob.type !== mime) throw new Error('图片编码失败');
  return format === 'jpg' ? jpegDensity(blob, dpi) : pngDensity(blob, dpi);
}
