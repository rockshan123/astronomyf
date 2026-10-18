import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Link } from "@tanstack/react-router";
import * as THREE from "three";
import type { OrbitControls as OrbitImpl } from "three-stdlib";
import { ArrowLeft, Check, Compass, Eraser, Maximize2, MousePointer2, Palette, PenLine, RotateCcw, Ruler, Slash, Undo2, X, Shapes } from "lucide-react";
import { LAYERS } from "@/data/layers";
import { buildLayer } from "@/lib/astronomy/layerGeometry";
import { computeSky } from "@/lib/astronomy/sky";
import { greatCircle, planeNormal, slerpArc, V } from "@/lib/astronomy/math";
import "./Classroom.css";

type Vec = [number,number,number];
type XY = [number,number];
type Tool = "orbit" | "pen" | "line" | "ruler" | "eraser";
type Place = "inside" | "outside";
type View = "outside" | "inside";
type Mark = {id:string;points:Vec[];color:string;width:number;surface:boolean;inside:boolean;measure?:string};
type Stroke = {id:string;points:XY[];color:string;width:number};
type Snapshot = {marks:Mark[];strokes:Stroke[]};
type Gesture = {pointer:number;kind:"screen"|"erase";x:number;y:number;dragged:boolean};
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
function shapePath(a:Vec,b:Vec):Vec[] {
  return slerpArc(v(a),v(b),Math.max(32,Math.ceil(angle(a,b)*95))).map(p=>t(p.multiplyScalar(1.022)));
}
function straightPath(a:Vec,b:Vec,place:Place):Vec[] {
  const A=v(a),B=v(b),theta=A.angleTo(B);
  const radius=place==="outside"?1.065/Math.max(0.18,Math.cos(theta/2)):0.975;
  const p=A.multiplyScalar(radius),q=B.multiplyScalar(radius);
  return Array.from({length:Math.max(45,Math.ceil(theta*90))},(_,i)=>
    t(p.clone().lerp(q,i/(Math.max(45,Math.ceil(theta*90))-1))));
}
function split3D(mark:Mark,location:Vec,radius:number):Mark[] {
  if(mark.points.every(p=>spherePointDistance(p,location)>=radius))return [mark];
  let part:Vec[]=[];
  const result:Mark[]=[];
  const finish=()=>{if(part.length>1)result.push({...mark,id:mark.id+"-cut-"+result.length,points:part,measure:undefined});part=[];};
  for(const p of mark.points) {
    if(spherePointDistance(p,location)<radius)finish();
    else part.push(p);
  }
  finish();
  return result;
}
function splitInk(stroke:Stroke,location:XY,radius:number):Stroke[] {
  if(stroke.points.every(p=>dist2(p,location)>=radius))return [stroke];
  const result:Stroke[]=[];let part:XY[]=[];
  const finish=()=>{if(part.length>1)result.push({...stroke,id:stroke.id+"-cut-"+result.length,points:part});part=[];};
  for(const p of stroke.points){if(dist2(p,location)<radius)finish();else part.push(p);}
  finish();return result;
}
function nearestMark(marks:Mark[],position:Vec) {
  let best:string|null=null,min=0.075;
  for(const m of marks)for(const p of m.points){
    const d=spherePointDistance(position,p);
    if(d<min){min=d;best=m.id;}
  }
  return best;
}
function nearestStroke(strokes:Stroke[],position:XY) {
  let best:string|null=null,min=0.024;
  for(const m of strokes)for(const p of m.points){
    const d=dist2(position,p);
    if(d<min){min=d;best=m.id;}
  }
  return best;
}
function inkPath(points:XY[]){
  return points.map((p,i)=>(i?"L":"M")+(p[0]*1000).toFixed(2)+" "+(p[1]*1000).toFixed(2)).join(" ");
}

function Tag({p,ar,en,color,view}:{p:THREE.Vector3;ar:string;en?:string;color?:string;view:View}) {
  const ref=useRef<HTMLDivElement>(null);
  const delta=useMemo(()=>new THREE.Vector3(),[]);
  // Hide far-side HTML labels when viewing the outside of the globe.
  useFrame(({camera})=>{
    if(!ref.current)return;
    if(view==="inside"){ref.current.style.visibility="visible";return;}
    delta.copy(p).sub(camera.position);
    const a=delta.lengthSq(),b=2*camera.position.dot(delta),c=camera.position.lengthSq()-1;
    const discriminant=b*b-4*a*c;
    const near=discriminant>0?(-b-Math.sqrt(discriminant))/(2*a):2;
    ref.current.style.visibility=c>0 && near>0.0001 && near<0.999?"hidden":"visible";
  });
  return <Html position={p} center style={{pointerEvents:"none"}} zIndexRange={[4,0]}>
    <div ref={ref} className="classroom-space-label" style={{color}}><strong dir="rtl">{ar}</strong>{en&&<small>{en}</small>}</div>
  </Html>;
}
function ClassroomCamera({view,cmd,tool}:{view:View;cmd:CameraCmd;tool:Tool}){
  const {camera}=useThree();
  const controls=useRef<OrbitImpl>(null);
  useEffect(()=>{
    const d=v(cmd.dir);
    const dist=view==="inside"?-0.055:3.25;
    camera.position.copy(d.multiplyScalar(dist));
    const perspective=camera as THREE.PerspectiveCamera;
    perspective.fov=view==="inside"?78:45;
    perspective.near=0.002;
    perspective.updateProjectionMatrix();
    controls.current?.target.set(0,0,0);
    controls.current?.update();
  },[view,cmd,camera]);
  return <OrbitControls ref={controls as never} makeDefault enabled={tool!=="eraser"} enablePan={false}
    enableDamping dampingFactor={0.08} rotateSpeed={0.8} zoomSpeed={0.85}
    minPolarAngle={0.0001} maxPolarAngle={Math.PI-0.0001}
    minAzimuthAngle={-Infinity} maxAzimuthAngle={Infinity}
    minDistance={view==="inside"?0.025:1.45}
    maxDistance={view==="inside"?0.14:9}/>;
}
function MarkLine({mark}:{mark:Mark}){
  if(mark.points.length<2)return null;
  const middle=mark.points[Math.floor(mark.points.length/2)]!;
  return <group>
    <Line points={mark.points.map(p=>new THREE.Vector3(...p))}
      color={mark.color} lineWidth={mark.width+0.7}
      transparent opacity={mark.inside?0.9:1}
      dashed={mark.inside&&!mark.surface} dashSize={0.029} gapSize={0.014}
      depthTest={mark.surface} depthWrite={false} raycast={()=>null}/>
    {mark.measure&&<Html position={new THREE.Vector3(...middle)} center style={{pointerEvents:"none"}}>
      <span className="classroom-measure-label">{mark.measure}</span></Html>}
  </group>;
}
function Sphere({visible,zenith,nadir,directions,seasons,marks,pending,tool,color,view,cmd,onPoint,onErase,onEraseBegin}:{
 visible:string[];zenith:boolean;nadir:boolean;directions:boolean;seasons:number[];
 marks:Mark[];pending:Vec|null;tool:Tool;color:string;view:View;cmd:CameraCmd;
 onPoint:(p:Vec)=>void;onErase:(p:Vec,drag:boolean)=>void;onEraseBegin:()=>void;
}){
  const sky=useMemo(()=>computeSky(SKY_DATE,0,75.8),[]);
  const great=useMemo(()=>GREAT.map(layer=>{
    const geom=buildLayer(layer.id,sky);
    const lines=geom.lines.length?geom.lines:layer.num===9?[greatCircle(planeNormal(sky.K,V(0,1,0)))]:[];
    return {layer,lines};
  }),[sky]);
  const pointer=useRef<{start:XY;last:XY;erased:boolean}|null>(null);
  const down=(e:ThreeEvent<PointerEvent>)=>{
    if(tool==="orbit")return;
    pointer.current={start:[e.clientX,e.clientY],last:[e.clientX,e.clientY],erased:false};
    if(tool==="eraser")onEraseBegin();
  };
  const move=(e:ThreeEvent<PointerEvent>)=>{
    if(tool!=="eraser"||!pointer.current)return;
    const xy:XY=[e.clientX,e.clientY];
    if(dist2(xy,pointer.current.start)>7){
      pointer.current.erased=true;
      onErase(t(e.point.clone().normalize()),true);
    }
    pointer.current.last=xy;
  };
  const up=(e:ThreeEvent<PointerEvent>)=>{
    if(!pointer.current)return;
    const was=pointer.current;
    pointer.current=null;
    const p=t(e.point.clone().normalize());
    if(tool==="eraser"){if(!was.erased)onErase(p,false);return;}
    if(dist2(was.start,[e.clientX,e.clientY])<7)onPoint(p);
    // Gestures beyond 7px are handed to OrbitControls, not drawing.
  };
  return <>
    <ambientLight intensity={0.9}/>
    <ClassroomCamera view={view} cmd={cmd} tool={tool}/>
    {view==="outside"&&<mesh renderOrder={-2}>
      <sphereGeometry args={[0.997,72,56]}/><meshBasicMaterial colorWrite={false}/>
    </mesh>}
    <mesh onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <sphereGeometry args={[1,96,72]}/>
      <meshBasicMaterial side={THREE.DoubleSide} color="#a9c9ef" transparent
        opacity={0.10} depthWrite={false}/>
    </mesh>
    <mesh scale={1.001}><sphereGeometry args={[1,32,24]}/>
      <meshBasicMaterial side={THREE.DoubleSide} color="#80a7cf" wireframe
        transparent opacity={0.085} depthWrite={false}/></mesh>
    {great.filter(({layer})=>visible.includes(layer.id)).map(({layer,lines})=><group key={layer.id}>
      {lines.map((pts,i)=><Line key={i} points={pts.map(p=>p.clone().multiplyScalar(1.008))}
        color={layer.color} lineWidth={layer.num<=2?3.2:2.2}
        transparent opacity={0.98} depthTest depthWrite={false} raycast={()=>null}/>)}
    </group>)}
    {directions&&([
      [V(0,0,-1.16),"N","North"],[V(0,0,1.16),"S","South"],
      [V(1.16,0,0),"E","East"],[V(-1.16,0,0),"W","West"]
    ] as const).map(([p,ar,en])=><Tag key={ar} p={p} ar={ar} en={en} view={view} color="#b8ddff"/>)}
    {zenith&&<Tag p={V(0,1.18,0)} ar="سَمْتُ الرَّأْسِ" en="Zenith" color="#cfe8ff" view={view}/>}
    {nadir&&<Tag p={V(0,-1.18,0)} ar="سَمْتُ الْقَدَمِ" en="Nadir" color="#cfe8ff" view={view}/>}
    {SEASONS.filter(s=>seasons.includes(s.longitude)).map(s=>{
      const p=sky.eclToLocal(s.longitude);
      return <group key={s.longitude}>
        <mesh position={p}><sphereGeometry args={[0.018,12,12]}/><meshBasicMaterial color="#ffb883"/></mesh>
        <Tag p={p.clone().multiplyScalar(1.17)} ar={s.ar} en={s.en} view={view} color="#ffcb93"/>
      </group>;
    })}
    {marks.map(mark=><MarkLine key={mark.id} mark={mark}/>)}
    {pending&&<mesh position={v(pending).multiplyScalar(1.025)}>
      <sphereGeometry args={[0.022,18,18]}/><meshBasicMaterial color={color} depthTest={false}/></mesh>}
  </>;
}
function ToolButton({active,onClick,children,label}:{active:boolean;onClick:()=>void;children:ReactNode;label:string}){
  return <button type="button" className={"classroom-tool"+(active?" is-active":"")}
    onClick={onClick} aria-pressed={active} aria-label={label} title={label}>{children}</button>;
}

export function ClassroomApp(){
  const [mobilePanel,setMobilePanel]=useState<"layers"|"tools">("tools");
  const [visible,setVisible]=useState<string[]>(DEFAULT_VISIBLE);
  const [zenith,setZenith]=useState(true);
  const [nadir,setNadir]=useState(true);
  const [directions,setDirections]=useState(true);
  const [seasons,setSeasons]=useState<number[]>(SEASONS.map(s=>s.longitude));
  const [tool,setTool]=useState<Tool>("orbit");
  const [shape,setShape]=useState(true);
  const [view,setView]=useState<View>("outside");
  const [cmd,setCmd]=useState<CameraCmd>({number:0,dir:[0,0,1]});
  const [placement,setPlacement]=useState<Place>("inside");
  const [color,setColor]=useState("#51a1ff");
  const [width,setWidth]=useState(3);
  const [pending,setPending]=useState<Vec|null>(null);
  const [marks,setMarks]=useState<Mark[]>([]);
  const [strokes,setStrokes]=useState<Stroke[]>([]);
  const [drawing,setDrawing]=useState<Stroke|null>(null);
  const [history,setHistory]=useState<Snapshot[]>([]);
  const [info,setInfo]=useState("N / S / E / W · Drag to rotate · Shape ON draws on sphere.");
  const cameraRef=useRef<THREE.Camera|null>(null);
  const screenGesture=useRef<Gesture|null>(null);
  const nextId=useRef(1);
  const makeId=()=>String(nextId.current++);
  const snapshot=useCallback(()=>setHistory(old=>[...old,{marks,strokes}]),[marks,strokes]);

  const chooseTool=(next:Tool)=>{
    setTool(next);setPending(null);setDrawing(null);
    setInfo(next==="orbit"?"Drag to rotate freely north-to-south and east-to-west.":next==="eraser"?
      "Eraser: click a drawn line to remove it; drag to erase only part.":
      next==="pen"?"Shape ON: click points on the globe; drag globe to rotate. Shape OFF: freehand ink.":
      "Click two sphere points to create a line or measure the angle.");
  };
  const onPoint=useCallback((point:Vec)=>{
    if(tool==="pen"&&!shape)return;
    if(tool==="eraser"||tool==="orbit")return;
    if(!pending){setPending(point);setInfo("First point set. Click another point.");return;}
    if(angle(pending,point)<0.006){setInfo("Choose a different point.");return;}
    if(tool==="pen"&&shape){
      snapshot();
      setMarks(old=>[...old,{id:makeId(),points:shapePath(pending,point),
        color,width,surface:true,inside:false}]);
      setPending(point);
      setInfo("Stroke added on sphere surface. Drag the globe to rotate; click to continue.");
      return;
    }
    const theta=angle(pending,point);
    if(placement==="outside"&&theta>2.7){
      setInfo("Outside straight lines need two points less than 155° apart.");return;
    }
    snapshot();
    setMarks(old=>[...old,{id:makeId(),points:straightPath(pending,point,placement),
      color,width,surface:false,inside:placement==="inside",
      measure:tool==="ruler"?deg(pending,point)+"°":undefined}]);
    setPending(null);
    setInfo((tool==="ruler"?"Measured":"Drawn") + " · " + deg(pending,point)+"° · "+placement);
  },[pending,tool,shape,color,width,placement,snapshot]);
  const erase3D=useCallback((point:Vec,drag:boolean)=>{
    setMarks(old=>{
      if(drag)return old.flatMap(m=>split3D(m,point,0.052));
      const selected=nearestMark(old,point);
      return selected?old.filter(m=>m.id!==selected):old;
    });
    setInfo(drag?"Erasing selected area of 3D drawing.":"Erased selected user-drawn 3D line.");
  },[]);

  const normalized=(e:ReactPointerEvent<HTMLElement>):XY=>{
    const rect=e.currentTarget.getBoundingClientRect();
    return [(e.clientX-rect.left)/Math.max(1,rect.width),(e.clientY-rect.top)/Math.max(1,rect.height)];
  };
  const hitsGlobe=(e:ReactPointerEvent<HTMLElement>)=>{
    if(!cameraRef.current)return false;
    const pos=normalized(e);
    const raycaster=new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(pos[0]*2-1,1-pos[1]*2),cameraRef.current);
    return raycaster.ray.intersectsSphere(new THREE.Sphere(new THREE.Vector3(),1));
  };
  const screenDown=(e:ReactPointerEvent<HTMLElement>)=>{
    if(e.button!==0||screenGesture.current)return;
    const free=tool==="pen"&&!shape;
    const erasing=tool==="eraser";
    if(!free&&!erasing)return;
    // A pointer starting on the sphere goes to the 3D scene, not free ink.
    // Inside free-ink mode intentionally writes over the classroom screen.
    if(hitsGlobe(e)&&!(free&&view==="inside"))return;
    e.stopPropagation();e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    screenGesture.current={pointer:e.pointerId,kind:free?"screen":"erase",x:e.clientX,y:e.clientY,dragged:false};
    snapshot();
    if(free)setDrawing({id:makeId(),points:[normalized(e)],color,width});
  };
  const screenMove=(e:ReactPointerEvent<HTMLElement>)=>{
    const g=screenGesture.current;
    if(!g||g.pointer!==e.pointerId)return;
    e.stopPropagation();
    const moved=Math.hypot(e.clientX-g.x,e.clientY-g.y)>6;
    if(moved)g.dragged=true;
    const p=normalized(e);
    if(g.kind==="screen"){
      setDrawing(old=>old?{...old,points:[...old.points,p]}:null);
    }else if(g.dragged){
      setStrokes(old=>old.flatMap(s=>splitInk(s,p,0.022)));
      setInfo("Erasing portions of freehand ink.");
    }
  };
  const screenUp=(e:ReactPointerEvent<HTMLElement>)=>{
    const g=screenGesture.current;
    if(!g||g.pointer!==e.pointerId)return;
    e.stopPropagation();
    if(g.kind==="screen"){
      if(drawing)setStrokes(old=>[...old,drawing]);
      setDrawing(null);
    }else if(!g.dragged){
      const p=normalized(e);
      setStrokes(old=>{
        const selected=nearestStroke(old,p);
        return selected?old.filter(s=>s.id!==selected):old;
      });
    }
    screenGesture.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const undo=()=>{
    if(pending){setPending(null);return;}
    const last=history[history.length-1];if(!last)return;
    setMarks(last.marks);setStrokes(last.strokes);setHistory(old=>old.slice(0,-1));
  };
  const clear=()=>{
    if(!marks.length&&!strokes.length&&!pending)return;
    if(!window.confirm("Clear all classroom drawings?"))return;
    snapshot();setMarks([]);setStrokes([]);setPending(null);setDrawing(null);
    setInfo("Drawings cleared; built-in astronomical circles retained.");
  };

  return <main className="classroom-root classroom-v2" data-panel={mobilePanel} data-view={view}>
    <header className="classroom-top classroom-glass">
      <Link to="/" className="classroom-back" aria-label="Back to Observatory"><ArrowLeft size={18}/></Link>
      <div className="classroom-title"><span className="classroom-kicker">TASHRIHUL AFLAK · TEACHING STUDIO</span>
        <span className="classroom-heading">Celestial Whiteboard <b dir="rtl">تَشْرِيحُ الْأَفْلَاكِ</b></span></div>
      <div className="classroom-mobile-tabs">
        <button className={mobilePanel==="layers"?"selected":""} onClick={()=>setMobilePanel("layers")}>Circles</button>
        <button className={mobilePanel==="tools"?"selected":""} onClick={()=>setMobilePanel("tools")}>Tools</button>
      </div>
      <button className="classroom-fullscreen" type="button" title="Fullscreen" onClick={()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()}><Maximize2 size={17}/></button>
    </header>
    <section className="classroom-stage" aria-label="Interactive celestial sphere"
      onPointerDownCapture={screenDown} onPointerMoveCapture={screenMove} onPointerUpCapture={screenUp} onPointerCancelCapture={screenUp}>
      <Canvas className="classroom-canvas" dpr={[1,1.7]}
        gl={{alpha:true,antialias:true}} camera={{position:[0,0,3.25],fov:45,near:0.002,far:80}}
        onCreated={({camera})=>{cameraRef.current=camera;}}>
        <Sphere visible={visible} zenith={zenith} nadir={nadir} directions={directions} seasons={seasons}
          marks={marks} pending={pending} tool={tool} color={color} view={view} cmd={cmd} onPoint={onPoint} onErase={erase3D} onEraseBegin={snapshot}/>
      </Canvas>
      <svg className="classroom-ink-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none"
        aria-label="Freehand annotation surface">
        {[...strokes,...(drawing?[drawing]:[])].map(s=><path key={s.id} d={inkPath(s.points)}
          fill="none" stroke={s.color} strokeWidth={s.width*1.8}
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>)}
      </svg>
    </section>
    <aside className="classroom-layers classroom-glass" aria-label="Great circle controls">
      <div className="classroom-panel-head"><div><span className="classroom-overline">GEOMETRY</span><h2 dir="rtl">الدَّوَائِرُ الْعِظَامُ</h2><p>10 Great Circles</p></div>
        <button className="classroom-tiny" onClick={()=>setVisible(visible.length===GREAT.length?[]:GREAT.map(l=>l.id))}>{visible.length===GREAT.length?"Hide all":"Show all"}</button></div>
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
      <div className="classroom-toolstrip" role="group" aria-label="Drawing mode">
        <ToolButton active={tool==="orbit"} onClick={()=>chooseTool("orbit")} label="Rotate the sphere"><MousePointer2 size={19}/>Orbit</ToolButton>
        <ToolButton active={tool==="pen"} onClick={()=>chooseTool("pen")} label="Freehand pen"><PenLine size={19}/>Pen</ToolButton>
        <ToolButton active={tool==="line"} onClick={()=>chooseTool("line")} label="Straight point-to-point line"><Slash size={19}/>Line</ToolButton>
        <ToolButton active={tool==="ruler"} onClick={()=>chooseTool("ruler")} label="Angular scale"><Ruler size={19}/>Scale</ToolButton>
        <ToolButton active={tool==="eraser"} onClick={()=>chooseTool("eraser")} label="Click to erase a line; drag to erase a portion"><Eraser size={19}/>Eraser</ToolButton>
      </div>
      <div className="classroom-tool-section classroom-shape-toggle">
        <button className={"classroom-shape-button"+(shape?" on":"")} onClick={()=>{setShape(old=>!old);setPending(null);}}>
          <Shapes size={17}/><span><strong>Shape</strong><small>{shape?"ON · Click points on sphere surface":"OFF · Freehand anywhere off the sphere"}</small></span>
          <span className={"classroom-switch"+(shape?" on":"")}/>
        </button>
        <p className="classroom-hint">Shape ON: click to draw on the sphere. Drag rotates the sphere without drawing. Shape OFF: freehand board ink.</p>
      </div>
      <div className="classroom-tool-section classroom-view-section">
        <div className="classroom-section-title"><Compass size={15}/> Sphere camera</div>
        <div className="classroom-segmented">
          <button className={view==="outside"?"selected":""} onClick={()=>setView("outside")}>Outside</button>
          <button className={view==="inside"?"selected":""} onClick={()=>setView("inside")}>Inside view</button>
        </div>
        <div className="classroom-direction-buttons">
          {([["N",[0,0,-1]],["S",[0,0,1]],["E",[1,0,0]],["W",[-1,0,0]],["Top",[0,1,0.0001]],["Bottom",[0,-1,0.0001]]] as [string,Vec][]).map(([name,dir])=>(
            <button key={name} onClick={()=>setCmd(old=>({number:old.number+1,dir}))}>{name}</button>
          ))}
        </div>
        <p className="classroom-hint">{view==="inside"?"Camera is inside the globe. Rotate in all directions; Shape ON can mark any point on the inner surface.":"Outside view shows a full visible hemisphere. Use N/S/E/W and Top/Bottom for every side."}</p>
      </div>
      <div className="classroom-tool-section"><div className="classroom-section-title"><Palette size={15}/> Ink color</div>
        <div className="classroom-swatches">{PALETTE.map(c=><button key={c} type="button"
          className={"classroom-swatch"+(color===c?" on":"")} aria-label={"Color "+c}
          style={{background:c}} onClick={()=>setColor(c)}/>)}
          <label className="classroom-color-input" title="Custom color"><input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
        </div>
        <label className="classroom-width">Stroke width <output>{width}px</output>
          <input type="range" min="1" max="9" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label>
      </div>
      <div className="classroom-tool-section"><div className="classroom-section-title"><Ruler size={15}/> 3D line placement</div>
        <div className="classroom-segmented">
          <button className={placement==="inside"?"selected":""} onClick={()=>{setPlacement("inside");setPending(null);}}>Inside</button>
          <button className={placement==="outside"?"selected":""} onClick={()=>{setPlacement("outside");setPending(null);}}>Outside</button>
        </div>
        <p className="classroom-hint">With Line or Scale, click two points on the globe. Inside creates a chord; Outside makes a raised straight line. Scale shows angular separation.</p>
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
        <button onClick={undo} disabled={!pending&&!history.length}><Undo2 size={15}/> Undo</button>
        <button onClick={clear} disabled={!pending&&!history.length&&marks.length===0&&strokes.length===0}><Eraser size={15}/> Clear</button>
        <button onClick={()=>{setMarks([]);setStrokes([]);setHistory([]);setPending(null);setVisible(DEFAULT_VISIBLE);setSeasons(SEASONS.map(s=>s.longitude));setZenith(true);setNadir(true);setDirections(true);setView("outside");setCmd(old=>({number:old.number+1,dir:[0,0,1]}));setShape(true);chooseTool("orbit");}}><RotateCcw size={15}/> Reset</button>
      </div>
    </aside>
    <div className="classroom-status classroom-glass" role="status"><span className="classroom-status-dot"/><span>{info}</span>
      {pending&&<button onClick={()=>setPending(null)}><X size={14}/> Cancel</button>}</div>
  </main>;
}