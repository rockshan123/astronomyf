import {useRef,useState,type PointerEvent as ReactPointerEvent} from "react";
export type CompassDrawing={points:[number,number][]};
type P=[number,number];
type Mode="move"|"radius"|"rotation";
const clamp=(x:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,x));
/** A screen-space compass: one fixed needle, one pencil tip and a movable hinge.
 * The onCommit circle/arc uses the same CSS-pixel frame as the classroom ink.
 */
export function ClassroomCompass({stageSize,onDraw,onClose}:{
 stageSize:P;onDraw:(arc:CompassDrawing)=>void;onClose:()=>void;
}){
 const [center,setCenter]=useState<P>(()=>[stageSize[0]*.5,stageSize[1]*.53]);
 const [radius,setRadius]=useState(()=>Math.min(132,Math.max(42,stageSize[0]*.24)));
 const [rotation,setRotation]=useState(-.6);
 const [arc,setArc]=useState<90|180|360>(360);
 const svgRef=useRef<SVGSVGElement>(null);
 const gesture=useRef<{id:number;mode:Mode;start:P;center:P;radius:number;rotation:number}|null>(null);
 const tip:P=[center[0]+radius*Math.cos(rotation),center[1]+radius*Math.sin(rotation)];
 const hinge:P=[center[0]+radius*.36*Math.cos(rotation)-radius*.35*Math.sin(rotation),
                center[1]+radius*.36*Math.sin(rotation)+radius*.35*Math.cos(rotation)];
 const top:P=[hinge[0]+radius*.15*Math.sin(rotation),hinge[1]-radius*.15*Math.cos(rotation)];
 const pixel=(e:ReactPointerEvent<SVGElement>):P=>{
   const box=svgRef.current?.getBoundingClientRect();return box?[e.clientX-box.left,e.clientY-box.top]:[e.clientX,e.clientY];
 };
 const down=(e:ReactPointerEvent<SVGElement>,mode:Mode)=>{
   if(e.button!==0)return;e.preventDefault();e.stopPropagation();
   e.currentTarget.setPointerCapture(e.pointerId);
   gesture.current={id:e.pointerId,mode,start:pixel(e),center,radius,rotation};
 };
 const move=(e:ReactPointerEvent<SVGElement>)=>{
   const g=gesture.current;if(g?.id!==e.pointerId)return;
   e.stopPropagation();e.preventDefault();
   const p=pixel(e),dx=p[0]-g.start[0],dy=p[1]-g.start[1];
   if(g.mode==="move")setCenter([g.center[0]+dx,g.center[1]+dy]);
   if(g.mode==="radius")setRadius(clamp(Math.hypot(p[0]-center[0],p[1]-center[1]),30,Math.max(60,Math.min(...stageSize)*.8)));
   if(g.mode==="rotation")setRotation(Math.atan2(p[1]-center[1],p[0]-center[0]));
 };
 const up=(e:ReactPointerEvent<SVGElement>)=>{
   if(gesture.current?.id!==e.pointerId)return;
   e.preventDefault();e.stopPropagation();gesture.current=null;
   if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
 };
 const controls=(mode:Mode)=>({
   onPointerDown:(e:ReactPointerEvent<SVGElement>)=>down(e,mode),
   onPointerMove:move,onPointerUp:up,onPointerCancel:up,
 });
 const commit=()=>{
   const step=Math.max(36,Math.round(arc/2));
   const points:Array<P>=Array.from({length:step+1},(_,i)=>{
     const angle=rotation+(arc*Math.PI/180)*i/step;
     return [center[0]+Math.cos(angle)*radius,center[1]+Math.sin(angle)*radius];
   });
   onDraw({points});
 };
 const dialSize=radius*.42;
 return <svg ref={svgRef} className="classroom-instrument classroom-compass-svg"
   viewBox={"0 0 "+stageSize[0]+" "+stageSize[1]}
   width="100%" height="100%" aria-label="Adjustable geometric compass"
   style={{position:"absolute",inset:0,width:"100%",height:"100%",overflow:"visible",pointerEvents:"none"}}>
   <defs>
    <linearGradient id="compassSteel" x1="0" x2="1">
      <stop offset="0" stopColor="#555e68"/><stop offset=".35" stopColor="#c4ccd3"/>
      <stop offset=".7" stopColor="#5f6871"/><stop offset="1" stopColor="#303d49"/>
    </linearGradient>
   </defs>
   {<>
     <circle cx={center[0]} cy={center[1]} r={radius}
       fill="none" stroke="rgba(62,162,246,.33)" strokeWidth="1.2" strokeDasharray="5 7"/>
     <path d={"M "+center.join(" ")+" L "+hinge.join(" ")} stroke="url(#compassSteel)" strokeWidth={11} strokeLinecap="round"/>
     <path d={"M "+hinge.join(" ")+" L "+tip.join(" ")} stroke="url(#compassSteel)" strokeWidth={12} strokeLinecap="round"/>
     <path d={"M "+hinge.join(" ")+" L "+top.join(" ")} stroke="#727a82" strokeWidth={9} strokeLinecap="round"/>
     <path d={"M "+tip.join(" ")+" L "+[tip[0]+Math.cos(rotation)*12,tip[1]+Math.sin(rotation)*12].join(" ")}
       stroke="#1eabff" strokeWidth={5} strokeLinecap="round"/>
     <circle cx={hinge[0]} cy={hinge[1]} r="15" fill="#68717b" stroke="#f0f6fb" strokeWidth="2"/>
     <circle cx={hinge[0]} cy={hinge[1]} r="8" fill="#303841" stroke="#dbe7f0" strokeWidth="1.4"/>
     <circle cx={center[0]} cy={center[1]} r="4" fill="#36b6ff"/>
     <g {...controls("move")} style={{pointerEvents:"auto",cursor:"move",touchAction:"none"}}>
       <circle cx={center[0]} cy={center[1]} r="19" fill="rgba(27,136,239,.28)" stroke="#60c4ff" strokeWidth="2"/>
       <circle cx={center[0]} cy={center[1]} r="6" fill="#fff"/>
     </g>
     <g {...controls("radius")} style={{pointerEvents:"auto",cursor:"ew-resize",touchAction:"none"}}>
       <circle cx={tip[0]} cy={tip[1]} r="18" fill="#299df3" stroke="#fff" strokeWidth="2"/>
       <text x={tip[0]} y={tip[1]+5} textAnchor="middle" fontSize="16" fill="white">↔</text>
     </g>
     <g {...controls("rotation")} style={{pointerEvents:"auto",cursor:"grab",touchAction:"none"}}>
       <circle cx={top[0]} cy={top[1]} r="19" fill="#545d66" stroke="#f2f7ff" strokeWidth="2"/>
       <path d={"M "+(top[0]-7)+" "+top[1]+" a 8 8 0 1 1 9 7"} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
     </g>
   </>}
   <g className="classroom-compass-actions" style={{pointerEvents:"auto"}}>
     <rect x={center[0]-dialSize-110} y={center[1]-radius-75} width="220" height="41" rx="16"
       fill="rgba(234,241,248,.86)" stroke="rgba(90,140,195,.45)"/>
     <text x={center[0]-dialSize-94} y={center[1]-radius-49} fontSize="12" fill="#244663" fontWeight="700">
       {arc===360?"Full circle":arc+"° arc"}
     </text>
     {([90,180,360] as const).map((s,i)=><g key={s}
       onClick={e=>{e.stopPropagation();setArc(s);}} style={{cursor:"pointer",pointerEvents:"auto"}}>
       <rect x={center[0]-15+i*36} y={center[1]-radius-67} width="34" height="25" rx="9"
         fill={arc===s?"#2289f9":"rgba(218,231,242,.96)"} />
       <text x={center[0]+2+i*36} y={center[1]-radius-50} textAnchor="middle"
         fontSize="10" fontWeight="700" fill={arc===s?"white":"#315d84"}>{s}</text>
       </g>)}
     <g onClick={e=>{e.stopPropagation();commit();}} style={{cursor:"pointer",pointerEvents:"auto"}}>
       <circle cx={center[0]+radius+27} cy={center[1]-radius-45} r="19" fill="#1289ed"/>
       <path d={"M "+(center[0]+radius+17)+" "+(center[1]-radius-45)+" l 7 8 l 14 -17"}
         stroke="white" strokeWidth="3" fill="none" strokeLinecap="round"/>
     </g>
     <g onClick={e=>{e.stopPropagation();onClose();}} style={{cursor:"pointer",pointerEvents:"auto"}}>
       <circle cx={center[0]+radius+27} cy={center[1]-radius-1} r="17" fill="rgba(227,238,246,.91)"/>
       <path d={"M "+(center[0]+radius+20)+" "+(center[1]-radius-8)+" l 14 14 M "+(center[0]+radius+34)+" "+(center[1]-radius-8)+" l -14 14"}
         fill="none" stroke="#2473bb" strokeWidth="2.5" strokeLinecap="round"/>
     </g>
   </g>
 </svg>;
}
