// Explicit tools-only source topology/known-sample DOUBLE; not a shader oracle.
// Literal RGB facts and sample extents; no original source, raster or assets.
import { authoredSourceRecipesDouble } from './authored-source-fixture.mjs';
export const standardRgb = [
[192,128,255],[144,153,255],[128,208,208],[128,255,128],[238,238,112],[255,160,96],[255,144,144],
[255,64,64],[224,48,224],[255,255,255],[144,153,255],[80,80,80],[255,192,80],[40,136,96],
[100,117,255],[120,134,255],[72,84,255],[160,80,255],[255,224,64],[56,68,255],[56,68,255],
[78,35,192],[255,86,9],[101,200,232],[128,132,144],[60,192,72],[0,255,83],[217,69,69],
[255,64,64],[144,144,144],[32,32,240],[240,32,32],[240,240,32],[240,144,32],[240,32,240],
[32,240,32],[40,60,173],[104,128,255],[0,0,112],[104,40,170],[0,0,0],[128,128,255]];
const recipe=(size,commands)=>({width:size,height:size,halfWidth:size/2,halfHeight:size/2,commands});
const pixels=(size,rgb)=>{const data=new Uint8Array(size*size*4);for(let i=0;i<data.length;i+=4)data.set([...rgb,255],i);return recipe(size,[['pixels',size,size,data]]);};
const disk=(size,rgb,radius)=>recipe(size,[['fillStyle',`rgb(${rgb.join(',')})`],['beginPath'],['arc',size/2,size/2,radius,0,Math.PI*2],['fill']]);
/** Resource/ABI double only: use real Rust for actual material samples and shapes. */
export function standardSourceRecipesDouble() {
  const p=authoredSourceRecipesDouble(); p.paletteRgb=structuredClone(standardRgb);
  p.bodySources.palettes=standardRgb.map((rgb,id)=>({variants:Array.from({length:id===36?60:7},()=>pixels(48,rgb)),boostGlow:pixels(62,rgb)}));
  p.bodySources.effects={outline:pixels(52,[0,0,0]),shadow:pixels(62,[0,0,0]),deathHighlight:disk(32,[255,153,102],16)};
  p.food=standardRgb.slice(0,10).map((rgb,color)=>({color,count:17,
    bodies:Array.from({length:17},(_,i)=>disk(Math.ceil(2*(2.8+i)*.65),rgb,1)),
    outlines:Array.from({length:17},(_,i)=>disk(Math.ceil(2*(2.8+i)*.7)+22,[0,0,0],1)),
    glows:Array.from({length:17},(_,i)=>disk(Math.ceil((2.8+i)*8+6),rgb,1))}));
  p.prey=standardRgb.slice(0,9).map((rgb,color)=>({color,count:22,
    bodies:Array.from({length:22},(_,i)=>disk((3+i)*2+38,rgb,(3+i)/2)),outlines:[],glows:structuredClone(p.food[color].glows)}));
  return p;
}