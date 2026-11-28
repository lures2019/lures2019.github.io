import { enhance } from './vendor/doc-scanner/index.js';

export const filterHints = {
  sharp:'压淡纸面阴影，锐化字边，适合日常扫描。',
  hd:'清理纸纹并增强细节，适合拍暗的文字页。',
  bright:'柔和提亮，保留原有色彩和图片层次。',
  original:'保留原有颜色和光照，仍应用已确认的裁边。',
  seal:'提亮纸面，优先保住淡红印章和蓝色签字。',
  color:'均衡光照并提高彩色图文的对比度。',
  shadow:'按纸面各处的亮度补偿阴影，保留笔画。',
  watermark:'淡化浅灰底纹和浅色水印。浅色正文也可能变淡。',
  handwriting:'减淡蓝、紫色笔迹。相近颜色的印刷内容也会受影响。',
  bw:'将纸面和字迹分成纯黑、纯白，适合文字稿。',
  ink:'漂白纸面，用深灰保留笔画，适合打印。',
  gray:'保留明暗层次，转为灰度扫描。',
  inverse:'反转色彩，便于查看深底浅字。',
};

const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const luminance = (r,g,b) => .299*r + .587*g + .114*b;

function sharpen(data, width, height, strength) {
  const tones = new Uint8Array(width*height);
  for (let i=0, p=0; i<tones.length; i++,p+=4) tones[i]=luminance(data[p],data[p+1],data[p+2]);
  for (let y=1; y<height-1; y++) {
    for (let x=1; x<width-1; x++) {
      const i=y*width+x, p=i*4, center=tones[i];
      const smooth=(4*center+2*(tones[i-1]+tones[i+1]+tones[i-width]+tones[i+width])
        +tones[i-width-1]+tones[i-width+1]+tones[i+width-1]+tones[i+width+1])/16;
      const difference=center-smooth;
      if (Math.abs(difference)<3) continue;
      const chroma=Math.max(data[p],data[p+1],data[p+2])-Math.min(data[p],data[p+1],data[p+2]);
      const delta=clamp(difference*strength,-27,22)* (1-clamp((chroma-14)/65)*.7);
      data[p]+=delta; data[p+1]+=delta; data[p+2]+=delta;
    }
  }
}

// Normalize illumination with the open-source scan engine. Use its luminance
// estimate without white-balancing the document's colored marks.
export function filterPixels(image, mode) {
  if (mode==='original' || !filterHints[mode]) return image;
  if (mode==='color' || mode==='gray') return enhance(image,mode);
  const {data,width,height}=image;
  const useExposure=mode!=='bright' && mode!=='inverse';
  const normalized=useExposure ? enhance(image,'gray').data : null;
  for (let p=0;p<data.length;p+=4) {
    const r=data[p], g=data[p+1], b=data[p+2], y=luminance(r,g,b);
    const chroma=Math.max(r,g,b)-Math.min(r,g,b);
    if (mode==='inverse') {
      data[p]=255-r; data[p+1]=255-g; data[p+2]=255-b;
      continue;
    }
    let tone = normalized?.[p] ?? y;
    if (mode==='bw' || mode==='ink') {
      const print=mode==='bw' ? (tone>=172 ? 255 : 0) : 255-194*Math.pow(clamp((224-tone)/190),.68);
      data[p]=print; data[p+1]=print; data[p+2]=print;
      continue;
    }
    const red = Math.max(0,r-Math.max(g,b));
    const ink = clamp(Math.max((chroma-10)/38, (red-3)/13));
    let amount = 1 - ink*.78;
    if (mode==='bright') {
      tone=y+27*Math.sin(Math.PI*y/255);
      amount=1-ink*.48;
    } else if (mode==='seal') {
      amount=1-clamp(Math.max(chroma/38,red/9));
    } else if (mode==='hd') {
      tone=tone>184 ? tone+clamp((tone-184)/52)*(255-tone) : tone*.96;
    } else if (mode==='shadow') {
      // Keep more midtone and texture than contrast-enhancing presets.
      tone=255-(255-tone)*.88;
      amount=1-ink*.58;
    } else if (mode==='watermark') {
      const fade=clamp((tone-156)/59) * (1-clamp((chroma-5)/18));
      tone+=(255-tone)*fade;
      amount=1-ink*.92;
    } else if (mode==='handwriting') {
      const blue=clamp((b-r-8)/24)*clamp((b-g-4)/17);
      if (blue>.02) {
        const paper=251, delta=(tone-y)*amount;
        data[p]=(r+delta)*(1-blue)+paper*blue;
        data[p+1]=(g+delta)*(1-blue)+paper*blue;
        data[p+2]=(b+delta)*(1-blue)+paper*blue;
        continue;
      }
    }
    const delta=(tone-y)*amount;
    data[p]=r+delta; data[p+1]=g+delta; data[p+2]=b+delta;
  }
  if (mode==='sharp' || mode==='hd') sharpen(data,width,height,mode==='sharp' ? 1.12 : .62);
  return image;
}
