import { detectDocument } from './vendor/doc-scanner/index.js';
import { gradients, refineQuad, sideSupport } from './vendor/doc-scanner/edges.js';

export function quadDistance(a,b) {
  return Math.max(...a.map(([x,y],i)=>Math.hypot(x-b[i][0],y-b[i][1])));
}

export function validQuad(points) {
  if (points.length !== 4 || !points.every(p => p.every(v => v >= 0 && v <= 1))) return false;
  return points.every(([x,y], i) => {
    const [u,v] = points[(i + 1) % 4];
    const [s,t] = points[(i + 2) % 4];
    return (u - x) * (t - v) - (v - y) * (s - u) > .0012;
  });
}

function toQuad(points, {width,height}) {
  if (!points || points.some(({x,y}) => x<-.018*width || x>1.018*width || y<-.018*height || y>1.018*height)) return null;
  const clamp = n => Math.max(0,Math.min(1,n));
  const quad=points.map(({x,y})=>[clamp(x/width),clamp(y/height)]);
  return validQuad(quad) ? quad : null;
}

function boostContrast({data,width,height}) {
  const hist=new Uint32Array(256);
  let count=0;
  for (let p=0;p<data.length;p+=32) {
    hist[Math.round(.299*data[p]+.587*data[p+1]+.114*data[p+2])]++;
    count++;
  }
  let low, high, total=0;
  for (let i=0;i<256;i++) {
    total+=hist[i];
    if (low===undefined && total>=count*.14) low=i;
    if (total>=count*.9) { high=i; break; }
  }
  const span=high-low;
  if (span < 3 || span > 95) return null;
  const gain=Math.min(4.8,115/span), center=(low+high)/2;
  const output=new Uint8ClampedArray(data.length);
  for (let p=0;p<data.length;p+=4) {
    const y=.299*data[p]+.587*data[p+1]+.114*data[p+2];
    const shift=180+(y-center)*gain-y;
    output[p]=data[p]+shift; output[p+1]=data[p+1]+shift; output[p+2]=data[p+2]+shift; output[p+3]=255;
  }
  return {data:output,width,height};
}

// Check that a candidate still lies on real edges in the unmodified frame.
function supported(edges, corners) {
  const {sides}=sideSupport(edges,corners,{full:20});
  return Math.min(...sides) >= .10 && sides.reduce((sum,side)=>sum+side,0) >= 1.16;
}

export function locatePaper(image, workSize = 400) {
  const options={workSize,refineSize:Math.max(image.width,image.height),minArea:.09};
  const original=toQuad(detectDocument(image,options)?.corners,image);
  if (original) return original;
  const adjusted=boostContrast(image);
  if (!adjusted) return null;
  const candidate=detectDocument(adjusted,options)?.corners;
  const result=toQuad(candidate,image);
  return result && supported(gradients(image),candidate) ? result : null;
}

export function refineTrackedPaper(image, guide) {
  const edges=gradients(image);
  const points=guide.map(([x,y])=>({x:x*image.width,y:y*image.height}));
  const radius=Math.max(4,Math.round(Math.max(image.width,image.height)*.019));
  const snapped=refineQuad(edges,points,radius);
  const quad=toQuad(snapped,image);
  if (quad && quadDistance(guide,quad)<.055 && supported(edges,snapped)) return quad;
  return null;
}
