import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Link } from "@tanstack/react-router";
import * as THREE from "three";
import type { OrbitControls as OrbitImpl } from "three-stdlib";
import { ArrowLeft, Check, Compass, Eraser, Eye, EyeOff, Maximize2, MousePointer2, Palette, PenLine, RotateCcw, Ruler, Slash, Undo2, X, Shapes, Triangle, DraftingCompass, Redo2, Settings2 } from "lucide-react";
import { LAYERS, type LayerDef } from "@/data/layers";
import { buildLayer } from "@/lib/astronomy/layerGeometry";
import { computeSky } from "@/lib/astronomy/sky";
import { greatCircle, planeNormal, slerpArc, V } from "@/lib/astronomy/math";
import { ClassroomInstrument, type RulerPose, type AngleDrawing } from "./ClassroomInstruments";
import { ClassroomCompass, type CompassDrawing } from "./ClassroomCompass";
import "./Classroom.css";

type Vec = [number,number,number];
type XY = [number,number];
type Tool = "orbit" | "pen" | "line" | "ruler" | "eraser" | "triangle" | "protractor";
type Place = "inside" | "outside";
type View = "outside" | "inside";
type Mark = {id:string;points:Vec[];color:string;width:number;surface:boolean;inside:boolean;measure?:string;anchorA?:Vec;anchorB?:Vec;kind?:"pen"|"line"|"ruler"};
type Stroke = {id:string;points:XY[];color:string;width:number;measure?:{x:number;y:number;label:string}};
type Snapshot = {marks:Mark[];strokes:Stroke[]};
type Gesture = {pointer:number;kind:"screen"|"erase"|"free-line"|"edit"|"sphere"|"free-multi"|"hollow-pen";x:number;y:number;startX:number;startY:number;dragged:boolean;guide:boolean};
type Edit = {id:string;endpoint:0|1};
type CameraCmd = {number:number;dir:Vec};
const SEASONS = [
  {longitude:0,ar:"الاعتدال الربيعي",en:"Vernal Equinox"},
  {longitude:90,ar:"الانقلاب الصيفي",en:"June Solstice"},
  {longitude:180,ar:"الاعتدال الخريفي",en:"Autumnal Equinox"},
  {longitude:270,ar:"الانقلاب الشتوي",en:"December Solstice"},
] as const;
const GREAT=LAYERS.filter(l=>l.group==="great").slice(0,10);
const DEFAULT_VISIBLE=GREAT.filter(l=>[1,2,6,7].includes(l.num)).map(l=>l.id);
const PALETTE=["#e8ecf5","#fb6379","#51a1ff","#3fe0aa","#c795ff","#ffd06a"];
const SKY_DATE=new Date("2026-03-20T12:00:00Z");
const v=(p:Vec)=>new THREE.Vector3(...p).normalize();
const t=(p:THREE.Vector3):Vec=>[p.x,p.y,p.z];
const angle=(a:Vec,b:Vec)=>v(a).angleTo(v(b));
const deg=(a:Vec,b:Vec)=>(angle(a,b)*180/Math.PI).toFixed(1);
const dist2=(a:XY,b:XY)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const spherePointDistance=(a:Vec,b:Vec)=>angle(a,b);

// Lines are densely sampled, so erasing a portion can truly split the 3D path.
// Surface strokes follow a great-circle arc above the rendered globe.
// Straight inside/outside strokes remain straight chords, not curved arcs.
function shapePath(a:Vec,b:Vec,inside=false):Vec[] {
  // A painted curve follows the spherical skin, never an elevated chord.
  const radius=inside?0.988:1.012;
  return slerpArc(v(a),v(b),Math.max(48,Math.ceil(angle(a,b)*125)))
    .map(p=>t(p.multiplyScalar(radius)));
}
function straightPath(a:Vec,b:Vec,place:Place):Vec[] {
  const A=v(a),B=v(b),theta=A.angleTo(B);
  const radius=place==="outside"?1.065/Math.max(0.18,Math.cos(theta/2)):0.975;
  const p=A.multiplyScalar(radius),q=B.multiplyScalar(radius);
  return Array.from({length:Math.max(45,Math.ceil(theta*90))},(_,i)=>
    t(p.clone().lerp(q,i/(Math.max(45,Math.ceil(theta*90))-1))));
}
function screenDistance(p:XY,a:XY,b:XY) {
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  const f=length>0?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
  return Math.hypot(p[0]-a[0]-f*dx,p[1]-a[1]-f*dy);
}
function projectPoint(point:Vec,camera:THREE.Camera,width:number,height:number):XY|null {
  const p=new THREE.Vector3(...point).project(camera);
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.z<-1||p.z>1)return null;
  return [(p.x+1)*0.5*width,(1-p.y)*0.5*height];
}
function visiblePoint(point:Vec,camera:THREE.Camera,view:View,shell:boolean):boolean {
  if(!shell||view==="inside")return true;
  const dest=new THREE.Vector3(...point),delta=dest.clone().sub(camera.position);
  const length=delta.length();
  if(length<0.001)return false;
  const ray=new THREE.Ray(camera.position,delta.multiplyScalar(1/length));
  const hit=ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(),0.997),new THREE.Vector3());
  return !hit||camera.position.distanceTo(hit)>=length-0.026;
}
function projectedMarks(mark:Mark,camera:THREE.Camera,width:number,height:number,view:View,shell:boolean){
  return mark.points.map(p=>visiblePoint(p,camera,view,shell)?projectPoint(p,camera,width,height):null);
}
function markHit(mark:Mark,p:XY,camera:THREE.Camera,w:number,h:number,view:View,shell:boolean){
  const samples=projectedMarks(mark,camera,w,h,view,shell);
  let distance=Infinity;
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i];
    if(a&&b)distance=Math.min(distance,screenDistance(p,a,b));
  }
  return distance;
}
function inkHit(stroke:Stroke,p:XY,w:number,h:number) {
  let best=Infinity;
  for(let i=1;i<stroke.points.length;i++){
    const a=stroke.points[i-1],b=stroke.points[i];
    best=Math.min(best,screenDistance(p,[a[0]*w,a[1]*h],[b[0]*w,b[1]*h]));
  }
  return best;
}
function cutMark(mark:Mark,p:XY,camera:THREE.Camera,w:number,h:number,view:View,shell:boolean,radius=15):Mark[]{
  const pts=projectedMarks(mark,camera,w,h,view,shell);
  if(!pts.some(q=>q&&Math.hypot(q[0]-p[0],q[1]-p[1])<radius))return [mark];
  let buffer:Vec[]=[];const pieces:Mark[]=[];
  const flush=()=>{if(buffer.length>=2)pieces.push({...mark,id:mark.id+"-cut-"+pieces.length,points:buffer,
    anchorA:undefined,anchorB:undefined,measure:undefined});buffer=[];};
  for(let i=0;i<mark.points.length;i++){
    const q=pts[i];if(q&&Math.hypot(q[0]-p[0],q[1]-p[1])<radius)flush();
    else buffer.push(mark.points[i]!);
  }
  flush();return pieces;
}
function cutInk(stroke:Stroke,p:XY,w:number,h:number,radius=15):Stroke[]{
  const near=stroke.points.some(q=>Math.hypot(q[0]*w-p[0],q[1]*h-p[1])<radius);
  if(!near)return [stroke];
  let buffer:XY[]=[];const pieces:Stroke[]=[];
  const flush=()=>{if(buffer.length>=2)pieces.push({...stroke,id:stroke.id+"-cut-"+pieces.length,points:buffer});buffer=[];};
  for(const q of stroke.points){if(Math.hypot(q[0]*w-p[0],q[1]*h-p[1])<radius)flush();else buffer.push(q);}
  flush();return pieces;
}
function hitSphere(screen:XY,camera:THREE.Camera,w:number,h:number):Vec|null {
  const ray=new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(screen[0]/w*2-1,1-screen[1]/h*2),camera);
  const at=ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(),1),new THREE.Vector3());
  return at?t(at.normalize()):null;
}
/** Position on the infinitely extendable ruler's top/bottom straight edge. */
function rulerSnap(pixel:XY,pose:RulerPose):XY|null {
  // CSS transform-origin on the ruler is 16px 52px from its top-left corner.
  const theta=pose.angle*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta);
  const dx=pixel[0]-(pose.x+16),dy=pixel[1]-(pose.y+52);
  const localX=c*dx+s*dy+16;
  const localY=-s*dx+c*dy+52;
  if(localX<12||localX>pose.length+17)return null;
  const available=pose.edge==="top"?[31]:pose.edge==="bottom"?[96]:[31,96];
  let nearest=available[0]!,distance=Math.abs(localY-nearest);
  for(const candidate of available){
    if(Math.abs(localY-candidate)<distance){nearest=candidate;distance=Math.abs(localY-candidate);}
  }
  if(distance>22)return null;
  const newX=localX-16,newY=nearest-52;
  return [pose.x+16+c*newX-s*newY,pose.y+52+s*newX+c*newY];
}
function rulerProject(pixel:XY,pose:RulerPose):XY {
  const theta=pose.angle*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta);
  const dx=pixel[0]-(pose.x+16),dy=pixel[1]-(pose.y+52);
  const lx=Math.max(17,Math.min(pose.length+14,c*dx+s*dy+16));
  const ly=-s*dx+c*dy+52;
  const ys=pose.edge==="top"?[31]:pose.edge==="bottom"?[96]:[31,96];
  const edge=ys.reduce((best,y)=>Math.abs(y-ly)<Math.abs(best-ly)?y:best,ys[0]!);
  const x=lx-16,y=edge-52;
  return [pose.x+16+c*x-s*y,pose.y+52+s*x+c*y];
}
function segmentInSphere(a:Vec,b:Vec):Vec[] {
  // Chords between points on the INSIDE skin; all interior samples are
  // linearly interpolated in 3D, never slerped on the surface.
  const from=v(a).multiplyScalar(.984),to=v(b).multiplyScalar(.984);
  const count=Math.max(3,Math.ceil(from.distanceTo(to)*130));
  return Array.from({length:count},(_,i)=>t(from.clone().lerp(to,i/(count-1))));
}
function inkPath(points:XY[],size:XY){
  return points.map((p,i)=>(i?"L":"M")+(p[0]*size[0]).toFixed(2)+" "+(p[1]*size[1]).toFixed(2)).join(" ");
}
function angleAt(a:Vec,vertex:Vec,b:Vec){
  const o=v(vertex),p=v(a),q=v(b);
  const t1=p.addScaledVector(o,-p.dot(o)).normalize();
  const t2=q.addScaledVector(o,-q.dot(o)).normalize();
  return THREE.MathUtils.radToDeg(t1.angleTo(t2));
}
function planarAngle(a:XY,vertex:XY,b:XY){
  const u=new THREE.Vector2(a[0]-vertex[0],a[1]-vertex[1]);
  const v=new THREE.Vector2(b[0]-vertex[0],b[1]-vertex[1]);
  if(u.lengthSq()<1e-10||v.lengthSq()<1e-10)return 0;
  return THREE.MathUtils.radToDeg(u.angleTo(v));
}

function Tag({p,ar,en,color,view,showSphere}:{p:THREE.Vector3;ar:string;en?:string;color?:string;view:View;showSphere:boolean}) {
  const label=useRef<HTMLDivElement>(null);
  const delta=useMemo(()=>new THREE.Vector3(),[]);
  useFrame(({camera})=>{
    if(!label.current)return;
    if(!showSphere||view==="inside"){label.current.style.visibility="visible";return;}
    delta.copy(p).sub(camera.position);
    const a=delta.lengthSq(),b=2*camera.position.dot(delta),c=camera.position.lengthSq()-0.997*0.997;
    const discriminant=b*b-4*a*c;
    const near=discriminant>0?(-b-Math.sqrt(discriminant))/(2*a):2;
    label.current.style.visibility=c>0&&near>0.0001&&near<0.999?"hidden":"visible";
  });
  return <Html position={p} center style={{pointerEvents:"none"}} zIndexRange={[4,0]}>
    <div ref={label} className="classroom-space-label" style={{color}}>
      <strong dir="rtl">{ar}</strong>{en&&<small>{en}</small>}
    </div>
  </Html>;
}
/**
 * Arabic names follow their own geometrical circles, rather than appearing
 * at a fixed global point where several labels can overlap or disappear.
 * Targets deliberately occupy different areas of the teaching sphere.
 */
const LABEL_TARGETS:XY[]=[
  [-0.43, 0.48], [0.42,0.48], [-0.56,0.12], [0.55,0.18],
  [-0.49,-0.26], [0.51,-0.24], [-0.20,-0.54], [0.22,-0.51],
  [0.00,0.73], [0.02,-0.72],
];
function CircleName({layer,lines,index,view}:{
  layer:LayerDef;lines:THREE.Vector3[][];index:number;view:View;
}){
  const group=useRef<THREE.Group>(null);
  const element=useRef<HTMLDivElement>(null);
  const sample=useMemo(()=>new THREE.Vector3(),[]);
  const frameCount=useRef(0);
  useFrame(({camera})=>{
    if(!group.current||!element.current)return;
    // Avoid heavy layout or projection work on every rendered frame.
    if(++frameCount.current%8!==1)return;
    const [targetX,targetY]=LABEL_TARGETS[index]??[0,0];
    let bestPoint:THREE.Vector3|null=null;
    let bestScore=Number.POSITIVE_INFINITY;
    for(const pts of lines){
      for(let i=0;i<pts.length;i+=Math.max(1,Math.floor(pts.length/90))){
        const point=pts[i]!;
        if(view==="outside"&&point.dot(camera.position)<0.18)continue;
        sample.copy(point).multiplyScalar(view==="inside"?0.978:1.055).project(camera);
        if(sample.z<-1||sample.z>1||Math.abs(sample.x)>0.97||Math.abs(sample.y)>0.94)continue;
        const score=(sample.x-targetX)**2+(sample.y-targetY)**2;
        if(score<bestScore){bestScore=score;bestPoint=point;}
      }
    }
    element.current.style.visibility=bestPoint?"visible":"hidden";
    if(bestPoint){
      group.current.position.copy(bestPoint).normalize().multiplyScalar(view==="inside"?0.987:1.025);
    }
  });
  return <group ref={group}>
    <Html center zIndexRange={[3,0]} style={{pointerEvents:"none"}}>
      <div ref={element} className={"classroom-circle-name"+(layer.ar.length>32?" is-long":"")}
        style={{color:layer.color}} title={layer.en}>
        <span lang="ar" dir="rtl">{layer.ar}</span>
      </div>
    </Html>
  </group>;
}

function ClassroomCamera({view,cmd,enabled}:{view:View;cmd:CameraCmd;enabled:boolean}){
  const {camera}=useThree();
  const controls=useRef<OrbitImpl>(null);
  useEffect(()=>{
    const d=v(cmd.dir);
    camera.position.copy(d.multiplyScalar(view==="inside"?-0.09:3.25));
    const perspective=camera as THREE.PerspectiveCamera;
    perspective.fov=view==="inside"?94:45;
    perspective.near=0.002;
    perspective.updateProjectionMatrix();
    controls.current?.target.set(0,0,0);
    controls.current?.update();
  },[view,cmd,camera]);
  return <OrbitControls ref={controls as never} makeDefault enabled={enabled} enablePan={false}
    enableDamping dampingFactor={0.07} rotateSpeed={0.83} zoomSpeed={0.85}
    minPolarAngle={0.0001} maxPolarAngle={Math.PI-0.0001}
    minAzimuthAngle={-Infinity} maxAzimuthAngle={Infinity}
    minDistance={view==="inside"?0.002:1.3}
    maxDistance={view==="inside"?0.992:11}/>;
}
function MarkLine({mark,view,showSphere,edit,onBeginEdit}:{mark:Mark;view:View;showSphere:boolean;edit:Edit|null;onBeginEdit:(id:string,endpoint:0|1)=>void}){
  if(mark.points.length<2)return null;
  const midpoint=mark.points[Math.floor(mark.points.length/2)]!;
  return <group>
    <Line points={mark.points.map(p=>new THREE.Vector3(...p))}
      color={mark.color} lineWidth={mark.width+0.7}
      opacity={1} transparent depthTest={mark.surface&&showSphere&&view==="outside"}
      depthWrite={false} raycast={()=>null}/>
    {mark.measure&&<Html position={new THREE.Vector3(...midpoint)} center style={{pointerEvents:"none"}}>
      <span className="classroom-measure-label">{mark.measure}</span>
    </Html>}
    {mark.anchorA&&mark.anchorB&&([mark.anchorA,mark.anchorB] as const).map((anchor,index)=>{
      const active=edit?.id===mark.id&&edit.endpoint===index;
      const edge=mark.points[index===0?0:mark.points.length-1]!;
      const position=mark.surface?v(anchor).multiplyScalar(mark.inside?0.982:1.027):new THREE.Vector3(...edge);
      return <mesh key={index} position={position}
        onPointerDown={e=>e.stopPropagation()}
        onPointerUp={e=>e.stopPropagation()}
        onDoubleClick={e=>{e.stopPropagation();onBeginEdit(mark.id,index as 0|1);}}>
        <sphereGeometry args={[active?0.038:0.026,16,16]}/>
        <meshBasicMaterial color={active?"#fff568":mark.color} transparent opacity={active?1:0.94} depthTest={false}/>
      </mesh>;
    })}
  </group>;
}
function Sphere({visible,zenith,nadir,directions,seasons,marks,pending,tool,color,view,cmd,showSphere,showNames,edit,draft,onPoint,onBeginEdit}:{
 visible:string[];zenith:boolean;nadir:boolean;directions:boolean;seasons:number[];
 marks:Mark[];pending:Vec|null;tool:Tool;color:string;view:View;cmd:CameraCmd;showSphere:boolean;showNames:boolean;
 edit:Edit|null;draft:Vec[];onPoint:(p:Vec)=>void;onBeginEdit:(id:string,endpoint:0|1)=>void;
}){
  const sky=useMemo(()=>computeSky(SKY_DATE,0,75.8),[]);
  const great=useMemo(()=>GREAT.map(layer=>{
    const geom=buildLayer(layer.id,sky);
    // Circle 9 remains a teaching schematic pending textual verification.
    const lines=geom.lines.length?geom.lines:layer.num===9?[greatCircle(planeNormal(sky.K,V(0,1,0)))]:[];
    return {layer,lines};
  }),[sky]);
  // All tool positions are resolved once from stage-relative pointer coordinates.
  // The invisible sphere is visual-only here; stage handles click raycasting.
  return <>
    <ambientLight intensity={0.9}/>
    <ClassroomCamera view={view} cmd={cmd} enabled={tool!=="eraser"&&!edit}/>
    {showSphere&&view==="outside"&&<mesh renderOrder={-1} raycast={()=>null}>
      <sphereGeometry args={[0.997,72,56]}/><meshBasicMaterial colorWrite={false} depthWrite/>
    </mesh>}
    {/* Invisible raycast sphere remains usable when the shell is hidden. */}
    <mesh raycast={()=>null}>
      <sphereGeometry args={[1,96,72]}/>
      <meshBasicMaterial side={THREE.DoubleSide} colorWrite={false} depthWrite={false}/>
    </mesh>
    {showSphere&&<>
      <mesh raycast={()=>null}><sphereGeometry args={[1,72,56]}/>
        <meshBasicMaterial side={THREE.DoubleSide} color="#9ec4ef" transparent opacity={0.12} depthWrite={false}/></mesh>
      <mesh scale={1.001} raycast={()=>null}><sphereGeometry args={[1,32,24]}/>
        <meshBasicMaterial side={THREE.DoubleSide} color="#80a7cf" wireframe transparent opacity={0.07} depthWrite={false}/></mesh>
    </>}
    {great.filter(({layer})=>visible.includes(layer.id)).map(({layer,lines})=><group key={layer.id}>
      {lines.map((pts,i)=><Line key={i} points={pts.map(p=>p.clone().multiplyScalar(1.008))}
        color={layer.color} lineWidth={layer.num<=2?3.2:2.2}
        transparent opacity={0.98} depthTest={showSphere&&view==="outside"} depthWrite={false} raycast={()=>null}/>)}
      {showNames&&<CircleName layer={layer} lines={lines} index={layer.num-1} view={view}/>}
    </group>)}
    {directions&&([
      [V(0,0,-1.16),"N","North"],[V(0,0,1.16),"S","South"],
      [V(1.16,0,0),"E","East"],[V(-1.16,0,0),"W","West"]
    ] as const).map(([p,ar,en])=><Tag key={ar} p={p} ar={ar} en={en} view={view} showSphere={showSphere} color="#b8ddff"/>)}
    {zenith&&<Tag p={V(0,1.18,0)} ar="سَمْتُ الرَّأْسِ" en="Zenith" showSphere={showSphere} color="#cfe8ff" view={view}/>}
    {nadir&&<Tag p={V(0,-1.18,0)} ar="سَمْتُ الْقَدَمِ" en="Nadir" showSphere={showSphere} color="#cfe8ff" view={view}/>}
    {SEASONS.filter(s=>seasons.includes(s.longitude)).map(s=>{
      const p=sky.eclToLocal(s.longitude);
      return <group key={s.longitude}>
        <mesh raycast={()=>null} position={p}><sphereGeometry args={[0.018,12,12]}/><meshBasicMaterial color="#ffb883"/></mesh>
        <Tag p={p.clone().multiplyScalar(1.17)} ar={s.ar} en={s.en} view={view} showSphere={showSphere} color="#ffcb93"/>
      </group>;
    })}
    {marks.map(mark=><MarkLine key={mark.id} mark={mark} view={view} showSphere={showSphere} edit={edit} onBeginEdit={onBeginEdit}/>)}
    {draft.length>1&&<Line points={draft.map(p=>new THREE.Vector3(...p))} color={color}
      lineWidth={3} depthTest={false} depthWrite={false} raycast={()=>null}/>} 
    {pending&&<mesh raycast={()=>null} position={v(pending).multiplyScalar(view==="inside"?0.981:1.027)}>
      <sphereGeometry args={[0.022,18,18]}/><meshBasicMaterial color={color} depthTest={false}/></mesh>}
  </>;
}
function ToolButton({active,onClick,children,label}:{active:boolean;onClick:()=>void;children:ReactNode;label:string}){
  return <button type="button" className={"classroom-tool"+(active?" is-active":"")}
    onClick={onClick} aria-pressed={active} aria-label={label} title={label}>{children}</button>;
}

export function ClassroomApp(){
  const [mobilePanel,setMobilePanel]=useState<"layers"|"tools"|"none">("none");
  const [visible,setVisible]=useState<string[]>(DEFAULT_VISIBLE);
  const [zenith,setZenith]=useState(true);
  const [nadir,setNadir]=useState(true);
  const [directions,setDirections]=useState(true);
  const [seasons,setSeasons]=useState<number[]>(SEASONS.map(s=>s.longitude));
  const [showSphere,setShowSphere]=useState(true);
  const [showNames,setShowNames]=useState(true);
  const [tool,setTool]=useState<Tool>("orbit");
  const [shape,setShape]=useState(true);
  const [view,setView]=useState<View>("outside");
  const [cmd,setCmd]=useState<CameraCmd>({number:0,dir:[0,0,1]});
  const [placement,setPlacement]=useState<Place>("inside");
  const [color,setColor]=useState("#51a1ff");
  const [hexDraft,setHexDraft]=useState("#51a1ff");
  const [recentColors,setRecentColors]=useState<string[]>([]);
  const applyColor=(value:string)=>{
    const normalized=value.toLowerCase();
    if(!/^#[0-9a-f]{6}$/.test(normalized))return;
    setColor(normalized);
    setHexDraft(normalized);
    setRecentColors(previous=>[normalized,...previous.filter(item=>item!==normalized)].slice(0,5));
  };
  const [width,setWidth]=useState(3);
  const [pending,setPending]=useState<Vec|null>(null);
  const [pendingScreen,setPendingScreen]=useState<XY|null>(null);
  const [pendingVertices,setPendingVertices]=useState<Vec[]>([]);
  const [pendingScreenVertices,setPendingScreenVertices]=useState<XY[]>([]);
  const [rulerVisible,setRulerVisible]=useState(false);
  const [protractorVisible,setProtractorVisible]=useState(false);
  const [compassVisible,setCompassVisible]=useState(false);
  const [rulerPose,setRulerPose]=useState<RulerPose>({x:330,y:140,angle:0,length:360,edge:"nearest"});
  const [hollowPenDraft,setHollowPenDraft]=useState<Vec[]>([]);
  const hollowDraftRef=useRef<Vec[]>([]);
  const stageRef=useRef<HTMLElement|null>(null);
  const [stageSize,setStageSize]=useState<XY>([1000,700]);
  const [edit,setEdit]=useState<Edit|null>(null);
  const [marks,setMarks]=useState<Mark[]>([]);
  const [strokes,setStrokes]=useState<Stroke[]>([]);
  const [drawing,setDrawing]=useState<Stroke|null>(null);
  const [history,setHistory]=useState<Snapshot[]>([]);
  const [future,setFuture]=useState<Snapshot[]>([]);
  const [info,setInfo]=useState("Draw on the ball · Double-click endpoints to edit · Hide Sphere for circles only.");
  const [eraserCursor,setEraserCursor]=useState<XY|null>(null);
  const cameraRef=useRef<THREE.Camera|null>(null);
  useEffect(()=>{
    const stage=stageRef.current;
    if(!stage)return;
    const sync=()=>{const rect=stage.getBoundingClientRect();
      setStageSize([Math.max(1,rect.width),Math.max(1,rect.height)]);};
    sync();
    const observer=new ResizeObserver(sync);
    observer.observe(stage);
    return ()=>observer.disconnect();
  },[]);
  const gesture=useRef<Gesture|null>(null);
  const nextId=useRef(1);
  const makeId=()=>String(nextId.current++);
  const snapshot=useCallback(()=>{setHistory(old=>[...old,{marks,strokes}]);setFuture([]);},[marks,strokes]);

  const chooseTool=(next:Tool)=>{
    setTool(next);setPending(null);setPendingScreen(null);setPendingVertices([]);setPendingScreenVertices([]);setDrawing(null);setHollowPenDraft([]);hollowDraftRef.current=[];setEdit(null);
    setInfo(next==="orbit"?"Drag vertically N–S or horizontally E–W; scroll/pinch to zoom.":
      next==="eraser"?"Click any teacher-drawn line to remove it; drag across a portion to cut it.":
      next==="pen"?"Shape ON: follow ball skin. Inside + Shape OFF: draw hollow 3D segments. Drag along the ruler edge for a perfect straight stroke.":
      next==="line"?"Shape ON: ball-surface arc. Inside + Shape OFF: 3D straight chord through the hollow interior. Outside + OFF: flat line.":
      next==="triangle"?"Choose three points. Shape ON draws spherical edges; OFF draws straight triangle sides.":
      next==="protractor"?"Choose vertex, first arm, second arm to measure the angle.":
      "Select two points to measure their angular separation.");
    if(next==="protractor")setProtractorVisible(true);
  };
  const moveEndpoint=useCallback((which:Edit,point:Vec)=>{
    setMarks(old=>old.map(mark=>{
      if(mark.id!==which.id||!mark.anchorA||!mark.anchorB)return mark;
      const a=which.endpoint===0?point:mark.anchorA;
      const b=which.endpoint===1?point:mark.anchorB;
      if(angle(a,b)<0.003)return mark;
      const pts=mark.surface?shapePath(a,b,mark.inside):
        mark.inside?segmentInSphere(a,b):straightPath(a,b,"outside");
      return {...mark,anchorA:a,anchorB:b,points:pts,measure:mark.kind==="ruler"?deg(a,b)+"°":undefined};
    }));
  },[]);
  const onBeginEdit=useCallback((id:string,endpoint:0|1)=>{
    setPending(null);setPendingScreen(null);
    setEdit({id,endpoint});
    setInfo("Edit endpoint: drag it onto the sphere or click a new destination. Use Undo to reverse.");
  },[]);
  const onPoint=useCallback((point:Vec)=>{
    if(edit){snapshot();moveEndpoint(edit,point);setEdit(null);setInfo("Endpoint moved. Undo restores the previous position.");return;}
    if(tool==="orbit"||tool==="eraser")return;
    if(!shape&&view==="inside"&&tool==="line"){
      if(!pending){setPending(point);setInfo("First internal endpoint selected. Choose the other endpoint.");return;}
      if(angle(pending,point)<.006)return;
      snapshot();
      setMarks(old=>[...old,{id:makeId(),anchorA:pending,anchorB:point,kind:"line",
        points:segmentInSphere(pending,point),color,width,surface:false,inside:true}]);
      setPending(null);
      setInfo("Hollow 3D straight chord drawn through the sphere interior.");
      return;
    }
    if(!shape)return;
    if(tool==="triangle"||tool==="protractor"){
      const points=[...pendingVertices,point];
      if(points.length<3){
        setPendingVertices(points);
        setInfo(points.length===1?"Point 1 saved. Choose point 2.":"Point 2 saved. Choose point 3.");
        return;
      }
      const [a,b,c]=points as [Vec,Vec,Vec];
      const edges=tool==="triangle"?[[a,b],[b,c],[c,a]]:[[a,b],[a,c]];
      snapshot();
      const newMarks:Mark[]=edges.map((edge,index)=>({
        id:makeId(),anchorA:edge[0]!,anchorB:edge[1]!,
        points:shapePath(edge[0]!,edge[1]!,view==="inside"),
        color,width,surface:true,inside:view==="inside",
        kind:"line",measure:tool==="protractor"&&index===0?angleAt(b,a,c).toFixed(1)+"°":undefined,
      }));
      setMarks(old=>[...old,...newMarks]);
      setPendingVertices([]);
      setInfo(tool==="triangle"?"A three-sided surface triangle is drawn.":"Spherical angle: "+angleAt(b,a,c).toFixed(1)+"°");
      return;
    }
    if(!pending){setPending(point);setInfo("First point selected. Click the next point on the ball.");return;}
    if(angle(pending,point)<0.006){setInfo("Choose a different point.");return;}
    const a=pending,b=point;
    snapshot();
    setMarks(old=>[...old,{
      id:makeId(),points:shapePath(a,b,view==="inside"),
      anchorA:a,anchorB:b,color,width,
      kind:tool==="ruler"?"ruler":tool==="pen"?"pen":"line",
      surface:true,inside:view==="inside",
      measure:tool==="ruler"?deg(a,b)+"°":undefined,
    }]);
    if(tool==="pen"){
      setPending(point);
      setInfo("Surface stroke added. Click again to continue, drag the globe to rotate.");
    }else{
      setPending(null);
      setInfo("Line follows the ball skin. Double-click a handle to adjust it.");
    }
  },[edit,tool,shape,pending,pendingVertices,view,color,width,snapshot,moveEndpoint]);

  // All pointer positions are relative to the SAME classroom stage, in CSS pixels.
  // Camera raycasting, SVG ink, hit-testing and eraser visuals share this frame.
  const stageRect=()=>stageRef.current?.getBoundingClientRect()??null;
  const pixelFromClient=(clientX:number,clientY:number):XY=>{
    const rect=stageRect();return rect?[clientX-rect.left,clientY-rect.top]:[0,0];
  };
  const normalizedFromPixel=(p:XY):XY=>[p[0]/stageSize[0],p[1]/stageSize[1]];
  const guided=(p:XY)=>rulerVisible?rulerSnap(p,rulerPose):null;
  const sphereFromPixel=(p:XY):Vec|null=>{
    if(!cameraRef.current)return null;
    return hitSphere(p,cameraRef.current,stageSize[0],stageSize[1]);
  };
  const eraseAt=useCallback((p:XY,partial:boolean)=>{
    const camera=cameraRef.current,w=stageSize[0],h=stageSize[1];
    if(!camera)return;
    if(partial){
      setMarks(old=>old.flatMap(mark=>cutMark(mark,p,camera,w,h,view,showSphere,16)));
      setStrokes(old=>old.flatMap(stroke=>cutInk(stroke,p,w,h,16)));
      return;
    }
    let nearest=18;
    let selected:{id:string;kind:"mark"|"ink"}|null=null;
    for(const mark of marks){
      const distance=markHit(mark,p,camera,w,h,view,showSphere);
      if(distance<nearest){nearest=distance;selected={id:mark.id,kind:"mark"};}
    }
    for(const stroke of strokes){
      const distance=inkHit(stroke,p,w,h);
      if(distance<nearest){nearest=distance;selected={id:stroke.id,kind:"ink"};}
    }
    if(!selected){setInfo("Eraser: no teacher-drawn line at this pointer position.");return;}
    if(selected.kind==="mark")setMarks(old=>old.filter(x=>x.id!==selected!.id));
    else setStrokes(old=>old.filter(x=>x.id!==selected!.id));
    setInfo("Erased exactly the selected teacher-drawn line; astronomy circles remain.");
  },[marks,strokes,stageSize,view,showSphere]);

  const addFreePoint=(point:XY)=>{
    const px=(pos:XY)=>[pos[0]*stageSize[0],pos[1]*stageSize[1]] as XY;
    if(tool==="line"||tool==="ruler"){
      if(!pendingScreen){setPendingScreen(point);setInfo("Point 1 set. Click point 2 for a straight line.");return;}
      snapshot();
      const a=pendingScreen,b=point;
      const count=Math.max(2,Math.ceil(dist2(px(a),px(b))/5));
      const pts=Array.from({length:count},(_,i):XY=>[
        a[0]+(b[0]-a[0])*i/(count-1),
        a[1]+(b[1]-a[1])*i/(count-1),
      ]);
      const measure=tool==="ruler"?{
        x:(a[0]+b[0])/2,y:(a[1]+b[1])/2,
        label:(dist2(px(a),px(b))/17.5).toFixed(1)+" diagram cm",
      }:undefined;
      setStrokes(old=>[...old,{id:makeId(),color,width,points:pts,...(measure?{measure}:{})}]);
      setPendingScreen(null);
      setInfo(tool==="line"?"A straight line was drawn, independent of the sphere.":"Ruler: measured a straight diagram-space distance.");
      return;
    }
    if(tool==="triangle"||tool==="protractor"){
      const newPoints=[...pendingScreenVertices,point];
      if(newPoints.length<3){
        setPendingScreenVertices(newPoints);
        setInfo("Point "+newPoints.length+" saved. Select point "+(newPoints.length+1)+".");
        return;
      }
      const [a,b,c]=newPoints as [XY,XY,XY];
      const outline=tool==="triangle"?[a,b,c,a]:[b,a,c];
      // Dense segments ensure precise partial erasing, even on large displays.
      const points:XY[]=[];
      for(let i=1;i<outline.length;i++){
        const first=outline[i-1]!,last=outline[i]!;
        const steps=Math.max(2,Math.ceil(dist2(px(first),px(last))/5));
        for(let j=0;j<steps;j++)points.push([
          first[0]+(last[0]-first[0])*j/(steps-1),
          first[1]+(last[1]-first[1])*j/(steps-1),
        ]);
      }
      const measure=tool==="protractor"?{x:a[0],y:a[1],label:planarAngle(b,a,c).toFixed(1)+"°"}:undefined;
      snapshot();
      setStrokes(old=>[...old,{id:makeId(),points,color,width,...(measure?{measure}:{})}]);
      setPendingScreenVertices([]);
      setInfo(tool==="triangle"?"Straight triangle completed.":"Measured angle: "+planarAngle(b,a,c).toFixed(1)+"°");
    }
  };
  const screenDown=(e:ReactPointerEvent<HTMLElement>)=>{
    if((e.target as Element).closest(".classroom-instrument"))return;
    if(!e.isPrimary){gesture.current=null;return;}
    if(e.button!==0||gesture.current)return;
    const p=pixelFromClient(e.clientX,e.clientY);
    const snap=(tool==="pen"||tool==="line")?guided(p):null;
    const useRuler=Boolean(snap);
    const kind:Gesture["kind"]|null=edit?"edit":
      tool==="eraser"?"erase":
      tool==="pen"&&useRuler?"screen":
      tool==="line"&&(useRuler||pendingScreen)?"free-line":
      view==="inside"&&!shape&&tool==="pen"?"hollow-pen":
      view==="inside"&&!shape&&tool==="line"?"sphere":
      !shape&&tool==="pen"?"screen":
      !shape&&tool==="line"?"free-line":
      !shape&&(tool==="ruler"||tool==="triangle"||tool==="protractor")?"free-multi":
      shape&&tool!=="orbit"?"sphere":null;
    if(!kind)return;
    gesture.current={pointer:e.pointerId,kind,x:p[0],y:p[1],startX:p[0],startY:p[1],dragged:false,guide:useRuler};
    if(kind==="sphere")return; // Dragging keeps OrbitControls active.
    e.preventDefault();e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if(kind==="edit"||kind==="screen"||kind==="erase"||kind==="hollow-pen")snapshot();
    if(kind==="screen")setDrawing({id:makeId(),points:[normalizedFromPixel(useRuler?rulerProject(p,rulerPose):p)],color,width});
    if(kind==="hollow-pen"){
      const point=sphereFromPixel(p);
      hollowDraftRef.current=point?[...segmentInSphere(point,point).slice(0,1)]:[];
      setHollowPenDraft(hollowDraftRef.current);
    }
    if(kind==="erase")setEraserCursor(normalizedFromPixel(p));
  };
  const screenMove=(e:ReactPointerEvent<HTMLElement>)=>{
    const p=pixelFromClient(e.clientX,e.clientY);
    if(tool==="eraser")setEraserCursor(normalizedFromPixel(p));
    const g=gesture.current;
    if(!g||g.pointer!==e.pointerId)return;
    const movement=Math.hypot(p[0]-g.startX,p[1]-g.startY);
    if(movement>6)g.dragged=true;
    if(g.kind==="sphere")return;
    e.stopPropagation();
    if(g.kind==="screen"){
      const previous:XY=[g.x,g.y],steps=Math.max(1,Math.ceil(dist2(previous,p)/4));
      setDrawing(old=>{
        if(!old)return null;
        const extension=Array.from({length:steps},(_,i)=>{
          const px:XY=[previous[0]+(p[0]-previous[0])*(i+1)/steps,
            previous[1]+(p[1]-previous[1])*(i+1)/steps];
          return normalizedFromPixel(g.guide?rulerProject(px,rulerPose):px);
        });
        return {...old,points:[...old.points,...extension]};
      });
      g.x=p[0];g.y=p[1];
    }else if(g.kind==="hollow-pen"){
      const previous:XY=[g.x,g.y],steps=Math.max(1,Math.ceil(dist2(previous,p)/5));
      const collection=[...hollowDraftRef.current];
      for(let i=1;i<=steps;i++){
        const px:XY=[previous[0]+(p[0]-previous[0])*i/steps,
          previous[1]+(p[1]-previous[1])*i/steps];
        const point=sphereFromPixel(px);
        if(!point)continue;
        const last=collection[collection.length-1];
        if(!last)collection.push(t(v(point).multiplyScalar(.984)));
        else if(angle(last,point)>.002)collection.push(...segmentInSphere(last,point).slice(1));
      }
      hollowDraftRef.current=collection;
      setHollowPenDraft(collection);
      g.x=p[0];g.y=p[1];
    }else if(g.kind==="erase"&&g.dragged){
      const previous:XY=[g.x,g.y],steps=Math.max(1,Math.ceil(dist2(previous,p)/8));
      for(let i=1;i<=steps;i++){
        const brush:XY=[
          previous[0]+(p[0]-previous[0])*i/steps,
          previous[1]+(p[1]-previous[1])*i/steps,
        ];
        eraseAt(brush,true);
      }
      g.x=p[0];g.y=p[1];
      setInfo("Erasing only the area beneath the 16px brush.");
    }else if(g.kind==="edit"&&g.dragged&&edit){
      const point=sphereFromPixel(p);
      if(point)moveEndpoint(edit,point);
    }
  };
  const screenUp=(e:ReactPointerEvent<HTMLElement>)=>{
    const g=gesture.current;
    if(!g||g.pointer!==e.pointerId)return;
    const p=pixelFromClient(e.clientX,e.clientY);
    if(g.kind==="sphere"){
      if(!g.dragged&&!edit){
        const point=sphereFromPixel(p);
        if(point)onPoint(point);
      }
      gesture.current=null;
      return;
    }
    e.stopPropagation();
    if(g.kind==="hollow-pen"){
      const points=hollowDraftRef.current;
      if(points.length>1)setMarks(old=>[...old,{id:makeId(),points,color,width,surface:false,inside:true,kind:"pen"}]);
      hollowDraftRef.current=[];
      setHollowPenDraft([]);
      setInfo("Free 3D pen: successive straight segments run through the hollow interior.");
    }else if(g.kind==="screen"){
      if(drawing){
        const points=drawing.points.length===1?[drawing.points[0]!,drawing.points[0]!]:drawing.points;
        setStrokes(old=>[...old,{...drawing,points}]);
      }
      setDrawing(null);
    }else if(g.kind==="erase"){
      if(!g.dragged)eraseAt(p,false);
    }else if(g.kind==="free-line"||g.kind==="free-multi"){
      if(!g.dragged)addFreePoint(normalizedFromPixel(g.guide?rulerProject(p,rulerPose):p));
    }else if(g.kind==="edit"&&edit){
      const point=sphereFromPixel(p);
      if(point)moveEndpoint(edit,point);
      setEdit(null);
      setInfo("Endpoint moved to exact pointer location.");
    }
    gesture.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const screenDoubleClick=(e:ReactMouseEvent<HTMLElement>)=>{
    if(!cameraRef.current||tool==="eraser")return;
    const p=pixelFromClient(e.clientX,e.clientY);
    let best:{id:string;index:0|1;distance:number}|null=null;
    for(const mark of marks){
      if(!mark.anchorA||!mark.anchorB)continue;
      for(const [index,anchor] of ([mark.anchorA,mark.anchorB] as const).entries()){
        if(!visiblePoint(anchor,cameraRef.current,view,showSphere))continue;
        const pos=projectPoint(anchor,cameraRef.current,stageSize[0],stageSize[1]);
        if(!pos)continue;
        const distance=dist2(pos,p);
        if(distance<22&&(!best||distance<best.distance))best={id:mark.id,index:index as 0|1,distance};
      }
    }
    if(best){
      e.stopPropagation();
      onBeginEdit(best.id,best.index);
      setPending(null);
      setPendingScreen(null);
      setPendingVertices([]);
      setPendingScreenVertices([]);
    }
  };
  /** Commit protractor rays and angle to the board as editable/erasable screen ink. */
  const addInstrumentAngle=(instrument:AngleDrawing)=>{
    const [cx,cy]=instrument.center;
    const start:XY=instrument.start,end:XY=instrument.end;
    const lerp=(a:XY,b:XY,steps:number)=>Array.from({length:steps+1},(_,i):XY=>[
      a[0]+(b[0]-a[0])*i/steps,a[1]+(b[1]-a[1])*i/steps
    ]);
    const A=Math.atan2(start[1]-cy,start[0]-cx);
    const B=Math.atan2(end[1]-cy,end[0]-cx);
    const screenSweep=(B-A+Math.PI*2)%(Math.PI*2);
    // In SVG, y grows downward; the instrument's angle runs counter-clockwise.
    const theta=instrument.mode==="full"?-instrument.degrees*Math.PI/180:
      (screenSweep>Math.PI?-1:1)*instrument.degrees*Math.PI/180;
    const radius=Math.min(Math.hypot(start[0]-cx,start[1]-cy),Math.hypot(end[0]-cx,end[1]-cy))*.57;
    const center:XY=[cx,cy];
    const arc=Array.from({length:49},(_,i):XY=>[
      cx+Math.cos(A+theta*i/48)*radius,cy+Math.sin(A+theta*i/48)*radius
    ]);
    const normalizedPoints=(points:XY[])=>points.map(([x,y]):XY=>[x/stageSize[0],y/stageSize[1]]);
    const midpoint=arc[Math.floor(arc.length/2)]!;
    const label:Stroke["measure"]={x:midpoint[0]/stageSize[0],y:midpoint[1]/stageSize[1],
      label:instrument.degrees.toFixed(0)+"°"};
    snapshot();
    setStrokes(old=>[...old,
      {id:makeId(),color,width,points:normalizedPoints(lerp(center,start,36))},
      {id:makeId(),color,width,points:normalizedPoints(lerp(center,end,36))},
      {id:makeId(),color:"#ffc14f",width:Math.max(1,width-1),points:normalizedPoints(arc),measure:label}
    ]);
    setInfo("Protractor "+instrument.degrees.toFixed(0)+"° angle added to the board.");
  };
  const undo=()=>{
    if(edit){setEdit(null);return;}
    if(pending||pendingScreen||pendingVertices.length||pendingScreenVertices.length){
      setPending(null);setPendingScreen(null);setPendingVertices([]);setPendingScreenVertices([]);return;
    }
    const previous=history[history.length-1];
    if(!previous)return;
    setFuture(old=>[...old,{marks,strokes}]);
    setMarks(previous.marks);setStrokes(previous.strokes);
    setHistory(old=>old.slice(0,-1));
    setInfo("Undo successful.");
  };
  const redo=()=>{
    if(!future.length)return;
    const next=future[future.length-1]!;
    setHistory(old=>[...old,{marks,strokes}]);
    setMarks(next.marks);setStrokes(next.strokes);
    setFuture(old=>old.slice(0,-1));
    setInfo("Redo successful.");
  };
  const addCompassArc=(draw:CompassDrawing)=>{
    if(draw.points.length<2)return;
    snapshot();
    setStrokes(old=>[...old,{id:makeId(),color,width,
      points:draw.points.map(([x,y]):XY=>[x/stageSize[0],y/stageSize[1]])}]);
    setInfo("Compass circle / arc drawn accurately on the whiteboard.");
  };
  const clear=()=>{
    if(!marks.length&&!strokes.length&&!pending&&!pendingScreen&&!pendingVertices.length&&!pendingScreenVertices.length)return;
    if(!window.confirm("Clear all classroom drawings?"))return;
    snapshot();setMarks([]);setStrokes([]);setPending(null);setPendingScreen(null);setPendingVertices([]);setPendingScreenVertices([]);setDrawing(null);setEdit(null);
    setInfo("Teacher drawings cleared; the original astronomical circles remain.");
  };

  return <main className="classroom-root classroom-v2" data-panel={mobilePanel} data-view={view} data-shell={showSphere?"shown":"hidden"}>
    <header className="classroom-top classroom-glass">
      <Link to="/" className="classroom-back" aria-label="Back to Observatory"><ArrowLeft size={18}/></Link>
      <div className="classroom-title"><span className="classroom-kicker">TASHRIHUL AFLAK · TEACHING STUDIO</span>
        <span className="classroom-heading">Celestial Whiteboard</span></div>
      <div className="classroom-mobile-tabs">
        <button className={mobilePanel==="layers"?"selected":""} onClick={()=>setMobilePanel(current=>current==="layers"?"none":"layers")} aria-expanded={mobilePanel==="layers"}>Circles</button>
        <button className={mobilePanel==="tools"?"selected":""} onClick={()=>setMobilePanel(current=>current==="tools"?"none":"tools")} aria-expanded={mobilePanel==="tools"}>Tools</button>
      </div>
      <button className="classroom-fullscreen" type="button" title="Fullscreen" onClick={()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()}><Maximize2 size={17}/></button>
    </header>
    <section ref={stageRef} className="classroom-stage" aria-label="Interactive celestial sphere"
      onPointerDownCapture={screenDown} onPointerMoveCapture={screenMove} onPointerUpCapture={screenUp}
      onPointerCancelCapture={screenUp} onDoubleClickCapture={screenDoubleClick}
      onPointerLeave={()=>setEraserCursor(null)}>
      <Canvas className="classroom-canvas" dpr={[1,1.7]}
        gl={{alpha:true,antialias:true}} camera={{position:[0,0,3.25],fov:45,near:0.002,far:80}}
        onCreated={({camera})=>{cameraRef.current=camera;}}>
        <Sphere visible={visible} zenith={zenith} nadir={nadir} directions={directions} seasons={seasons}
          marks={marks} pending={pending} tool={tool} color={color} view={view} cmd={cmd}
          showSphere={showSphere} showNames={showNames} edit={edit} draft={hollowPenDraft} onPoint={onPoint} onBeginEdit={onBeginEdit}/>
      </Canvas>
      <svg className="classroom-ink-layer" width="100%" height="100%"
        viewBox={"0 0 "+stageSize[0]+" "+stageSize[1]} preserveAspectRatio="none"
        aria-label="Freehand annotation surface">
        {[...strokes,...(drawing?[drawing]:[])].map(line=><g key={line.id}>
          <path d={inkPath(line.points,stageSize)} fill="none" stroke={line.color}
            strokeWidth={line.width*1.8} strokeLinecap="round" strokeLinejoin="round"/>
          {line.measure&&<text x={line.measure.x*stageSize[0]} y={line.measure.y*stageSize[1]-11}
            fill="#fff1ae" fontSize={14} fontWeight="700" textAnchor="middle">{line.measure.label}</text>}
        </g>)}
        {pendingScreen&&<circle cx={pendingScreen[0]*stageSize[0]} cy={pendingScreen[1]*stageSize[1]} r={7}
          stroke={color} strokeWidth={2} fill="none"/>}
        {pendingScreenVertices.map((p,i)=><circle key={i} cx={p[0]*stageSize[0]} cy={p[1]*stageSize[1]}
          r={6} fill={color} stroke="#ffffff" strokeWidth={1.5}/>)}
        {tool==="eraser"&&eraserCursor&&<circle cx={eraserCursor[0]*stageSize[0]}
          cy={eraserCursor[1]*stageSize[1]} r={16} fill="rgba(255,255,255,.12)"
          stroke="#fff2c2" strokeWidth={2}/>}
      </svg>
      {rulerVisible&&<ClassroomInstrument type="ruler" stageSize={stageSize} ruler={rulerPose} onRulerChange={setRulerPose} onClose={()=>setRulerVisible(false)}/>}
      {protractorVisible&&<ClassroomInstrument type="protractor" stageSize={stageSize} onCommitAngle={addInstrumentAngle} onClose={()=>setProtractorVisible(false)}/>} 
      {compassVisible&&<ClassroomCompass stageSize={stageSize} onDraw={addCompassArc} onClose={()=>setCompassVisible(false)}/>}
    </section>
    <nav className="classroom-floating-toolbar classroom-glass" role="toolbar" aria-label="Whiteboard drawing toolbar">
      <ToolButton active={tool==="pen"} onClick={()=>chooseTool(tool==="pen"?"orbit":"pen")} label="Pen"><PenLine size={22}/>Pen</ToolButton>
      <ToolButton active={tool==="eraser"} onClick={()=>chooseTool(tool==="eraser"?"orbit":"eraser")} label="Eraser"><Eraser size={22}/>Eraser</ToolButton>
      <ToolButton active={tool==="orbit"} onClick={()=>chooseTool("orbit")} label="Select and rotate sphere"><MousePointer2 size={22}/>Select</ToolButton>
      <ToolButton active={tool==="line"} onClick={()=>chooseTool(tool==="line"?"orbit":"line")} label="Straight line"><Slash size={22}/>Line</ToolButton>
      <ToolButton active={tool==="triangle"} onClick={()=>chooseTool(tool==="triangle"?"orbit":"triangle")} label="Shape triangle"><Triangle size={22}/>Shape</ToolButton>
      <button type="button" className={"classroom-toolbar-icon"+(mobilePanel==="tools"?" is-active":"")}
        aria-label="Show or hide tool settings" aria-expanded={mobilePanel==="tools"}
        onClick={()=>setMobilePanel(p=>p==="tools"?"none":"tools")}><Settings2 size={22}/><small>Toolbox</small></button>
      <button type="button" className="classroom-toolbar-icon" aria-label="Undo" disabled={!history.length&&!pending&&!pendingScreen}
        onClick={undo}><Undo2 size={22}/><small>Undo</small></button>
      <button type="button" className="classroom-toolbar-icon" aria-label="Redo" disabled={!future.length}
        onClick={redo}><Redo2 size={22}/><small>Redo</small></button>
      <button type="button" className={"classroom-toolbar-icon"+(rulerVisible?" is-active":"")}
        aria-pressed={rulerVisible} aria-label="Toggle transparent ruler"
        onClick={()=>setRulerVisible(v=>!v)}><Ruler size={22}/><small>Ruler</small></button>
      <button type="button" className={"classroom-toolbar-icon"+(protractorVisible?" is-active":"")}
        aria-pressed={protractorVisible} aria-label="Toggle protractor"
        onClick={()=>setProtractorVisible(v=>!v)}><DraftingCompass size={22}/><small>Angle</small></button>
      <button type="button" className={"classroom-toolbar-icon"+(compassVisible?" is-active":"")}
        aria-pressed={compassVisible} aria-label="Toggle compass instrument"
        onClick={()=>setCompassVisible(v=>!v)}><Compass size={22}/><small>Compass</small></button>
      <button type="button" className="classroom-toolbar-icon" aria-label="Toggle inside or outside view"
        onClick={()=>{setView(v=>v==="inside"?"outside":"inside");setPending(null);}}><Eye size={22}/><small>{view==="inside"?"Inside":"Outside"}</small></button>
      {(pending||pendingScreen||pendingVertices.length>0||pendingScreenVertices.length>0)&&
        <button type="button" className="classroom-toolbar-icon classroom-toolbar-cancel" aria-label="Cancel current drawing"
          onClick={()=>{setPending(null);setPendingScreen(null);setPendingVertices([]);setPendingScreenVertices([]);}}>
          <X size={22}/><small>Cancel</small>
        </button>}
    </nav>
    <aside className="classroom-layers classroom-glass" aria-label="Great circle controls">
      <div className="classroom-panel-head"><div><span className="classroom-overline">GEOMETRY</span><h2 dir="rtl">الدَّوَائِرُ الْعِظَامُ</h2><p>10 Great Circles</p></div>
        <div className="classroom-name-actions">
          <button className="classroom-tiny" aria-pressed={showNames}
            onClick={()=>setShowNames(x=>!x)}>{showNames?"Hide names":"Show names"}</button>
          <button className="classroom-tiny" onClick={()=>setVisible(visible.length===GREAT.length?[]:GREAT.map(l=>l.id))}>{visible.length===GREAT.length?"Hide all":"Show all"}</button>
        </div></div>
      <div className="classroom-circle-list">{GREAT.map(l=><label key={l.id} className={"classroom-circle-row"+(visible.includes(l.id)?" active":"")}>
        <input type="checkbox" checked={visible.includes(l.id)}
          onChange={()=>setVisible(old=>old.includes(l.id)?old.filter(id=>id!==l.id):[...old,l.id])}/>
        <span className="classroom-circle-color" style={{background:l.color}}/>
        <span className="classroom-circle-label"><strong dir="rtl">{l.ar}</strong><small>{l.en}{l.num===9?" · Schematic":""}</small></span>
        <span className="classroom-circle-check">{visible.includes(l.id)&&<Check size={14}/>}</span>
      </label>)}</div>
      <p className="classroom-source-note">Circle 9 is a teaching schematic; its historical definition is under review.</p>
    </aside>
    <aside className="classroom-tools classroom-glass" aria-label="Whiteboard drawing tools">
      <div className="classroom-panel-head"><div><span className="classroom-overline">YOUR WORKSPACE</span>
        <h2 className="classroom-tool-heading">Teaching tools</h2><p>Sketch · Measure · Explain</p></div><PenLine size={19}/></div>
      <div className="classroom-tool-section classroom-instrument-controls">
        <div className="classroom-section-title"><Ruler size={15}/> Teaching instruments</div>
        <div className="classroom-instrument-options">
          <button className={rulerVisible?"on":""} onClick={()=>setRulerVisible(x=>!x)}>
            <Ruler size={16}/> {rulerVisible?"Hide ruler":"Show ruler"}
          </button>
          <button className={protractorVisible?"on":""} onClick={()=>setProtractorVisible(x=>!x)}>
            <DraftingCompass size={16}/> {protractorVisible?"Hide protractor":"Show protractor"}
          </button>
        </div>
        <p className="classroom-hint">Use ruler ↔ to extend, grip to move, Rotate to turn. With Pen, trace along the transparent ruler edge to snap perfectly straight. The protractor supports 180°/360°, angle arms, snap increments and Draw mode.</p>
      </div>
      <div className="classroom-tool-section classroom-shape-toggle">
        <button className={"classroom-shape-button"+(shape?" on":"")} onClick={()=>{setShape(old=>!old);setPending(null);}}>
          <Shapes size={17}/><span><strong>Shape</strong><small>{shape?"ON · Surface-constrained curves":"OFF · Inside draws through hollow 3D space"}</small></span>
          <span className={"classroom-switch"+(shape?" on":"")}/>
        </button>
        <p className="classroom-hint">Shape ON: Pen and Line follow the ball skin. Shape OFF: outside = flat ink; inside = 3D straight chords, not surface arcs. A ruler guides pen strokes into a precise straight line.</p>
      </div>
      <div className="classroom-tool-section classroom-view-section">
        <div className="classroom-section-title"><Compass size={15}/> Sphere camera</div>
        <button type="button" className={"classroom-hide-sphere"+(!showSphere?" is-hidden":"")}
          aria-pressed={!showSphere} onClick={()=>setShowSphere(x=>!x)}>
          {showSphere?<EyeOff size={17}/>:<Eye size={17}/>}
          <span><strong>{showSphere?"Hide Sphere":"Show Sphere"}</strong>
            <small>{showSphere?"Show only the circles and draw between them":"Only circles visible · click the invisible sphere to draw"}</small>
          </span>
          <span className="classroom-hide-status">{showSphere?"SHOWING":"HIDDEN"}</span>
        </button>
        <div className="classroom-segmented">
          <button className={view==="outside"?"selected":""} onClick={()=>setView("outside")}>Outside</button>
          <button className={view==="inside"?"selected":""} onClick={()=>setView("inside")}>Inside view</button>
        </div>
        <div className="classroom-direction-buttons">
          {([["N",[0,0,-1]],["S",[0,0,1]],["E",[1,0,0]],["W",[-1,0,0]],["Top",[0,1,0.0001]],["Bottom",[0,-1,0.0001]]] as [string,Vec][]).map(([name,dir])=>(
            <button key={name} onClick={()=>setCmd(old=>({number:old.number+1,dir}))}>{name}</button>
          ))}
        </div>
        <p className="classroom-hint">{view==="inside"?"Inside: scroll / pinch to zoom from the center toward the inner surface. Shape ON paints on the inner wall.":"Outside: scroll / pinch to zoom. N/S/E/W moves across the complete visible hemisphere."}</p>
      </div>
      <div className="classroom-tool-section classroom-color-section"><div className="classroom-section-title"><Palette size={15}/> Ink color</div>
        <div className="classroom-current-color">
          <label className="classroom-current-color-picker" title="Edit selected color">
            <span className="classroom-current-color-preview" style={{background:color}}/>
            <input type="color" value={color} aria-label="Select drawing color"
              onChange={e=>applyColor(e.target.value)}/>
          </label>
          <div className="classroom-current-color-text">
            <strong>Selected drawing color</strong>
            <input type="text" spellCheck={false} aria-label="Editable color hex code"
              maxLength={7} value={hexDraft} onChange={e=>{
                const value=e.target.value;
                setHexDraft(value);
                if(/^#[0-9a-fA-F]{6}$/.test(value))applyColor(value);
              }} onBlur={()=>setHexDraft(color)} />
          </div>
          <span className="classroom-color-live" aria-live="polite">ACTIVE</span>
        </div>
        <div className="classroom-swatches">{[...PALETTE,...recentColors.filter(c=>!PALETTE.includes(c))].map(c=><button key={c} type="button"
          className={"classroom-swatch"+(color===c?" on":"")} aria-label={"Select color "+c}
          aria-pressed={color===c} title={c}
          style={{background:c}} onClick={()=>applyColor(c)}/>)}
        </div>
        <label className="classroom-width">Stroke width <output>{width}px</output>
          <input type="range" min="1" max="9" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label>
      </div>
      <div className="classroom-tool-section"><div className="classroom-section-title"><Ruler size={15}/> 3D line placement</div>
        <div className="classroom-segmented">
          <button className={placement==="inside"?"selected":""} onClick={()=>{setPlacement("inside");setPending(null);}}>Inside</button>
          <button className={placement==="outside"?"selected":""} onClick={()=>{setPlacement("outside");setPending(null);}}>Outside</button>
        </div>
        <p className="classroom-hint">Shape ON draws ball-surface arcs. Inside view + Shape OFF draws real straight 3D chords through the hollow interior. Outside view + Shape OFF draws screen-space lines.</p>
      </div>
      <div className="classroom-tool-section"><div className="classroom-section-title"><Compass size={15}/> Reference points</div>
        <div className="classroom-toggles">
          <button className={zenith?"on":""} onClick={()=>setZenith(v=>!v)}><span dir="rtl">سَمْتُ الرَّأْسِ</span><small>Zenith</small></button>
          <button className={nadir?"on":""} onClick={()=>setNadir(v=>!v)}><span dir="rtl">سَمْتُ الْقَدَمِ</span><small>Nadir</small></button>
          <button className={directions?"on":""} onClick={()=>setDirections(v=>!v)}><span>N · S · E · W</span><small>Directions</small></button>
        </div>
      </div>
      <div className="classroom-tool-section"><div className="classroom-section-title">Season markers</div>
        <div className="classroom-seasons">{SEASONS.map(s=><button key={s.longitude}
          className={seasons.includes(s.longitude)?"on":""}
          onClick={()=>setSeasons(old=>old.includes(s.longitude)?old.filter(n=>n!==s.longitude):[...old,s.longitude])}>
          <strong dir="rtl">{s.ar}</strong><small>{s.en}</small></button>)}</div>
      </div>
      <div className="classroom-actions">
        <button onClick={undo} disabled={!edit&&!pending&&!pendingScreen&&!pendingVertices.length&&!pendingScreenVertices.length&&!history.length}><Undo2 size={15}/> Undo</button>
        <button onClick={clear} disabled={!pending&&!pendingScreen&&!pendingVertices.length&&!pendingScreenVertices.length&&marks.length===0&&strokes.length===0}><Eraser size={15}/> Clear</button>
        <button onClick={()=>{setMarks([]);setStrokes([]);setHistory([]);setFuture([]);setCompassVisible(false);setPending(null);setPendingScreen(null);setPendingVertices([]);setPendingScreenVertices([]);setEdit(null);setShowSphere(true);setShowNames(true);setRulerVisible(false);setProtractorVisible(false);setVisible(DEFAULT_VISIBLE);setSeasons(SEASONS.map(s=>s.longitude));setZenith(true);setNadir(true);setDirections(true);setView("outside");setCmd(old=>({number:old.number+1,dir:[0,0,1]}));setShape(true);chooseTool("orbit");}}><RotateCcw size={15}/> Reset</button>
      </div>
    </aside>
    <div className="classroom-screenreader-status" role="status" aria-live="polite">{info}</div>
  </main>;
}