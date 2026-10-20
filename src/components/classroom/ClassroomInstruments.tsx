import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Grip, RotateCcw, Ruler as RulerIcon, Check, CircleX } from "lucide-react";

export type RulerPose = { x:number; y:number; angle:number; length:number; edge:"top"|"bottom"|"nearest" };
export type InstrumentMode = "measure"|"draw";
export type AngleDrawing = { center:[number,number]; start:[number,number]; end:[number,number]; degrees:number; mode:"semicircle"|"full" };
type ProtractorState={x:number;y:number;angle:number;radius:number;full:boolean;mode:InstrumentMode;snap:1|5|10;armA:number;armB:number};
type Drag={pointer:number;x:number;y:number;initialX:number;initialY:number;angle:number;length:number;radius:number;armA:number;armB:number;kind:"move"|"rotate"|"extend"|"resize"|"armA"|"armB"};
const ticks=Array.from({length:73},(_,i)=>i*5);
const RAD=Math.PI/180;
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const point=(angle:number,r:number,centerX:number,centerY:number):[number,number]=>[
  centerX+Math.cos(angle*RAD)*r,
  centerY-Math.sin(angle*RAD)*r,
];
const polarAngle=(x:number,y:number,cx:number,cy:number)=>((Math.atan2(cy-y,x-cx)/RAD)+360)%360;
const quantize=(x:number,step:number)=>Math.round(x/step)*step;
const relativeAngle=(a:number,b:number,full:boolean)=>{
  const cw=((b-a)%360+360)%360;
  return full?cw:Math.min(cw,360-cw);
};
/**
 * Physical-classroom instruments. The ruler is a screen-space guide:
 * the transparent body passes pointer events to the board; only blue
 * control handles capture pointer input. Both drawing and ruler geometry
 * share stage CSS-pixel coordinates.
 */
export function ClassroomInstrument({
  type,onClose,ruler,onRulerChange,onCommitAngle,stageSize
}:{
  type:"ruler"|"protractor";onClose:()=>void;
  ruler?:RulerPose;onRulerChange?:(next:RulerPose)=>void;
  onCommitAngle?:(angle:AngleDrawing)=>void;stageSize:[number,number];
}){
  const [localRuler,setLocalRuler]=useState<RulerPose>({x:Math.max(24,stageSize[0]*.30),y:Math.max(75,stageSize[1]*.17),angle:0,length:360,edge:"nearest"});
  const currentRuler=ruler??localRuler;
  const changeRuler=(next:RulerPose)=>{(onRulerChange??setLocalRuler)(next);};
  const [pro,setPro]=useState<ProtractorState>({
    x:Math.min(560,stageSize[0]*.50),y:Math.min(270,stageSize[1]*.36),
    angle:0,radius:160,full:false,mode:"measure",snap:5,armA:0,armB:83
  });
  const drag=useRef<Drag|null>(null);
  const root=useRef<HTMLDivElement>(null);
  const onDown=(e:ReactPointerEvent<HTMLElement>,kind:Drag["kind"])=>{
    if(e.button!==0)return;
    e.stopPropagation();e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const state=type==="ruler"?currentRuler:pro;
    drag.current={pointer:e.pointerId,x:e.clientX,y:e.clientY,initialX:state.x,initialY:state.y,
      angle:state.angle,length:currentRuler.length,radius:pro.radius,armA:pro.armA,armB:pro.armB,kind};
  };
  const onMove=(e:ReactPointerEvent<HTMLElement>)=>{
    const a=drag.current;if(!a||a.pointer!==e.pointerId)return;
    e.stopPropagation();e.preventDefault();
    const dx=e.clientX-a.x,dy=e.clientY-a.y;
    if(type==="ruler"){
      const radians=currentRuler.angle*RAD;
      if(a.kind==="move")changeRuler({...currentRuler,x:a.initialX+dx,y:a.initialY+dy});
      if(a.kind==="rotate")changeRuler({...currentRuler,angle:a.angle+dx*.65});
      if(a.kind==="extend"){
        const aligned=dx*Math.cos(radians)+dy*Math.sin(radians);
        changeRuler({...currentRuler,length:clamp(Math.round(a.length+aligned),180,12000)});
      }
      return;
    }
    if(a.kind==="move")setPro(old=>({...old,x:a.initialX+dx,y:a.initialY+dy}));
    if(a.kind==="rotate")setPro(old=>({...old,angle:a.angle+dx*.65}));
    if(a.kind==="resize")setPro(old=>({...old,radius:clamp(a.radius+dx*.65,90,310)}));
    if(a.kind==="armA"||a.kind==="armB"){
      // Protractor is rotated with its container; undo that rotation in global coordinates.
      const theta=pro.angle*RAD;
      const center:[number,number]=[pro.x,pro.y];
      const localX=(e.clientX-center[0])*Math.cos(theta)+(e.clientY-center[1])*Math.sin(theta);
      const localY=-(e.clientX-center[0])*Math.sin(theta)+(e.clientY-center[1])*Math.cos(theta);
      const ang=quantize(polarAngle(localX,localY,0,0),pro.snap);
      const limited=pro.full?ang:Math.min(180,ang);
      setPro(old=>({...old,[a.kind==="armA"?"armA":"armB"]:limited}));
    }
  };
  const onUp=(e:ReactPointerEvent<HTMLElement>)=>{
    if(drag.current?.pointer!==e.pointerId)return;
    e.stopPropagation();
    drag.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const handlers=(kind:Drag["kind"])=>({
    onPointerDown:(e:ReactPointerEvent<HTMLElement>)=>onDown(e,kind),
    onPointerMove:onMove,onPointerUp:onUp,onPointerCancel:onUp
  });

  if(type==="ruler"){
    const ratio=currentRuler.length/360;
    return <div ref={root} className="classroom-instrument classroom-instrument-ruler"
      style={{left:currentRuler.x,top:currentRuler.y,width:currentRuler.length+34,
        transform:"rotate("+currentRuler.angle+"deg)",transformOrigin:"16px 52px"}}>
      <div className="classroom-instrument-grip" {...handlers("move")} title="Move ruler">
        <Grip size={14}/><span>EXTENDABLE RULER</span>
        <button type="button" aria-label="Close ruler" onPointerDown={e=>e.stopPropagation()}
          onClick={e=>{e.stopPropagation();onClose();}}>×</button>
      </div>
      <div className="classroom-ruler-face" style={{height:65,width:currentRuler.length+32}}>
        <div className="classroom-ruler-units">inch / cm · diagram scale</div>
        <div className="classroom-ruler-inch-ticks" style={{width:currentRuler.length}}>
          {Array.from({length:Math.min(4000,Math.ceil(currentRuler.length/5.55625)+1)},(_,i)=>i).map(i=>(
            <span key={i} className={i%8===0?"major":i%4===0?"medium":"minor"} style={{left:i*5.55625}}>
              {i%8===0&&<small>{i/8}</small>}
            </span>
          ))}
        </div>
        <div className="classroom-ruler-ticks" style={{width:currentRuler.length}}>
          {Array.from({length:Math.min(3500,Math.ceil(currentRuler.length/3.5)+1)},(_,i)=>i).map(i=>(
            <span key={i} className={i%5===0?"major":i%2===0?"medium":"minor"} style={{left:i*3.5}}>
              {i%5===0&&<small>{i/5}</small>}
            </span>
          ))}
        </div>
      </div>
      <div className="classroom-instrument-extend" title="Drag to extend or shorten the ruler"
        style={{left:currentRuler.length+13,top:29}} {...handlers("extend")}>↔</div>
      <div className="classroom-instrument-footer">
        <div className="classroom-instrument-rotate" {...handlers("rotate")} title="Drag to rotate ruler">
          <RotateCcw size={13}/> Rotate
        </div>
        <select value={currentRuler.edge} onPointerDown={e=>e.stopPropagation()}
          onChange={e=>changeRuler({...currentRuler,edge:e.target.value as RulerPose["edge"]})}
          aria-label="Ruler snapping edge">
          <option value="nearest">Nearest edge</option><option value="top">Top edge</option>
          <option value="bottom">Bottom edge</option>
        </select>
        <span>{Math.round(currentRuler.angle)}°</span>
      </div>
      <span className="classroom-ruler-sr">Scale {ratio.toFixed(1)}× relative to original 360px ruler</span>
    </div>;
  }

  const radius=pro.radius,mid=pro.radius+12;
  const centerX=mid,centerY=pro.full?mid:mid+6;
  const a=pro.armA,b=pro.armB;
  const showAngle=relativeAngle(a,b,pro.full);
  const endA=point(a,radius*.85,centerX,centerY);
  const endB=point(b,radius*.85,centerX,centerY);
  const max=pro.full?360:180;
  const arcPoints=Array.from({length:Math.max(2,Math.ceil(showAngle/3)+1)},(_,i)=>{
    const sign=pro.full?1:(((b-a+360)%360)<=180?1:-1);
    return point(a+sign*showAngle*i/Math.max(1,Math.ceil(showAngle/3)),radius*.49,centerX,centerY);
  });
  const region=pro.full
    ?<circle cx={centerX} cy={centerY} r={radius} fill="rgba(217,239,255,.45)" stroke="#4d8bc5" strokeWidth="1.4"/>
    :<path d={"M "+(centerX-radius)+" "+centerY+" A "+radius+" "+radius+" 0 0 1 "+(centerX+radius)+" "+centerY+" Z"}
      fill="rgba(217,239,255,.45)" stroke="#4d8bc5" strokeWidth="1.4"/>;
  const toPage=(p:[number,number]):[number,number]=>{
    const x=p[0]-centerX,y=p[1]-centerY,theta=pro.angle*RAD;
    return [pro.x+x*Math.cos(theta)-y*Math.sin(theta),pro.y+x*Math.sin(theta)+y*Math.cos(theta)];
  };
  return <div ref={root} className="classroom-instrument classroom-instrument-protractor advanced"
    style={{left:pro.x-centerX,top:pro.y-centerY-30,
      width:mid*2,height:(pro.full?mid*2:mid+30)+66,
      transform:"rotate("+pro.angle+"deg)",transformOrigin:centerX+"px "+(centerY+30)+"px"}}>
    <div className="classroom-instrument-grip" {...handlers("move")} title="Move protractor">
      <Grip size={14}/><span>PROTRACTOR {pro.full?"360°":"180°"}</span>
      <button type="button" aria-label="Close protractor" onPointerDown={e=>e.stopPropagation()}
        onClick={e=>{e.stopPropagation();onClose();}}>×</button>
    </div>
    <svg viewBox={"0 0 "+mid*2+" "+(pro.full?mid*2:mid+25)}
      style={{width:mid*2,height:pro.full?mid*2:mid+25}} className="classroom-protractor-face" aria-label="Adjustable protractor">
      {region}
      {ticks.filter(d=>d<=max).map(degree=>{
        const t=point(degree,radius,centerX,centerY),inner=point(degree,radius-(degree%10===0?16:8),centerX,centerY);
        const label=point(degree,radius-31,centerX,centerY);
        return <g key={degree}>
          <line x1={inner[0]} y1={inner[1]} x2={t[0]} y2={t[1]} stroke="#3b79b8" strokeWidth={degree%10===0?1.4:.7}/>
          {degree%20===0&&<text x={label[0]} y={label[1]+3} fill="#2d65a4" fontSize="10" fontWeight="600" textAnchor="middle">{degree}</text>}
        </g>;
      })}
      <line x1={centerX} y1={centerY} x2={endA[0]} y2={endA[1]} stroke="#2491e5" strokeWidth="2.5"/>
      <line x1={centerX} y1={centerY} x2={endB[0]} y2={endB[1]} stroke="#e25c7f" strokeWidth="2.5"/>
      <polyline points={arcPoints.map(p=>p.join(",")).join(" ")} fill="none" stroke="#f0a237" strokeWidth="2.7"/>
      <circle cx={centerX} cy={centerY} r="6" fill="#fafcff" stroke="#306da8" strokeWidth="2"/>
      <text x={centerX} y={centerY-14} textAnchor="middle" fill="#205e9c" fontSize="14" fontWeight="700">{showAngle.toFixed(0)}°</text>
    </svg>
    <div className="classroom-protractor-arm a" style={{left:endA[0]-9,top:30+endA[1]-9}}
      title="Drag blue arm" {...handlers("armA")}>A</div>
    <div className="classroom-protractor-arm b" style={{left:endB[0]-9,top:30+endB[1]-9}}
      title="Drag rose arm" {...handlers("armB")}>B</div>
    <div className="classroom-instrument-footer protractor-controls">
      <div className="classroom-instrument-rotate" {...handlers("rotate")}><RotateCcw size={13}/> Rotate</div>
      <button type="button" onClick={()=>setPro(old=>({...old,full:!old.full,armA:0,armB:old.full?Math.min(old.armB,180):old.armB}))}>
        {pro.full?"180°":"360°"}
      </button>
      <button type="button" onClick={()=>setPro(old=>({...old,mode:old.mode==="draw"?"measure":"draw"}))}>
        {pro.mode==="draw"?"Draw":"Measure"}
      </button>
      <select value={pro.snap} aria-label="Angle snapping" onPointerDown={e=>e.stopPropagation()}
        onChange={e=>setPro(old=>({...old,snap:Number(e.target.value) as 1|5|10}))}>
        <option value={1}>1°</option><option value={5}>5°</option><option value={10}>10°</option>
      </select>
    </div>
    <div className="classroom-instrument-footer">
      <div className="classroom-instrument-rotate" {...handlers("resize")}><RulerIcon size={13}/> Resize</div>
      <span>{showAngle.toFixed(0)}°</span>
      {pro.mode==="draw"&&onCommitAngle&&<button className="classroom-angle-commit" type="button" onClick={()=>{
        const c=toPage([centerX,centerY]),s=toPage(endA),e=toPage(endB);
        onCommitAngle({center:c,start:s,end:e,degrees:showAngle,mode:pro.full?"full":"semicircle"});
      }}><Check size={13}/> Add to board</button>}
    </div>
    <button className="classroom-instrument-discard" title="Remove instrument" onClick={onClose}><CircleX size={14}/></button>
  </div>;
}
