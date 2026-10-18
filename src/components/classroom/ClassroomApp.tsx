import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Link } from "@tanstack/react-router";
import * as THREE from "three";
import { ArrowLeft, Check, Compass, Eraser, Maximize2, MousePointer2, Palette, PenLine, RotateCcw, Ruler, Slash, Undo2, X } from "lucide-react";
import { LAYERS } from "@/data/layers";
import { buildLayer } from "@/lib/astronomy/layerGeometry";
import { computeSky } from "@/lib/astronomy/sky";
import { greatCircle, planeNormal, V } from "@/lib/astronomy/math";
import "./Classroom.css";

type Position = [number, number, number];
type Tool = "orbit" | "pen" | "line" | "ruler";
type Placement = "inside" | "outside";
type Stroke = { id: number; color: string; width: number; points: [number, number][] };
type Segment = { id: number; a: Position; b: Position; color: string; width: number; place: Placement; measurement: boolean };
type Action = { id: number; kind: "stroke" | "segment" };
const SEASONS = [
  { longitude: 0, ar: "الاعتدال الربيعي", en: "Vernal Equinox" },
  { longitude: 90, ar: "الانقلاب الصيفي", en: "June Solstice" },
  { longitude: 180, ar: "الاعتدال الخريفي", en: "Autumnal Equinox" },
  { longitude: 270, ar: "الانقلاب الشتوي", en: "December Solstice" },
] as const;
const GREAT = LAYERS.filter(l => l.group === "great").slice(0, 10);
const DEFAULT_VISIBLE = GREAT.filter(l => [1, 2, 6, 7].includes(l.num)).map(l => l.id);
const PALETTE = ["#111827", "#E14749", "#2872D4", "#12A17F", "#A367DC", "#E9A328"];
const SKY_DATE = new Date("2026-03-20T12:00:00Z");
const unit = (p: Position) => new THREE.Vector3(...p).normalize();
const tuple = (p: THREE.Vector3): Position => [p.x,p.y,p.z];
const angleOf = (a: Position,b: Position) => unit(a).angleTo(unit(b)) * 180 / Math.PI;

function SphereTag({at,ar,en,color="#334155"}:{at:THREE.Vector3;ar:string;en?:string;color?:string}) {
  return <Html position={at} center zIndexRange={[2,0]} style={{pointerEvents:"none"}}>
    <div className="classroom-space-label" style={{color}}><strong dir="rtl">{ar}</strong>{en&&<small>{en}</small>}</div>
  </Html>;
}
function InkLine({segment}:{segment:Segment}) {
  const a=unit(segment.a),b=unit(segment.b), theta=a.angleTo(b);
  // An outside stroke is a straight elevated segment; its midpoint clears the sphere.
  const lift=segment.place==="outside"?1.075/Math.max(0.19,Math.cos(theta/2)):0.98;
  const p1=a.clone().multiplyScalar(lift),p2=b.clone().multiplyScalar(lift);
  return <group>
    <Line points={[p1,p2]} color={segment.color} lineWidth={segment.width+0.8}
      dashed={segment.place==="inside"} dashSize={0.032} gapSize={0.02} depthTest={false}/>
    {[p1,p2].map((p,i)=><mesh key={i} position={p}><sphereGeometry args={[0.013,12,12]}/><meshBasicMaterial color={segment.color} depthTest={false}/></mesh>)}
    {segment.measurement&&<Html position={p1.clone().add(p2).multiplyScalar(0.5)} center style={{pointerEvents:"none"}}>
      <span className="classroom-measure-label">{angleOf(segment.a,segment.b).toFixed(1)}°</span>
    </Html>}
  </group>;
}

function Sphere({visible,zenith,nadir,directions,seasons,segments,pending,tool,color,onPick}:{
  visible:string[];zenith:boolean;nadir:boolean;directions:boolean;seasons:number[];
  segments:Segment[];pending:Position|null;tool:Tool;color:string;onPick:(p:Position)=>void;
}) {
  const sky=useMemo(()=>computeSky(SKY_DATE,0,75.8),[]);
  const great=useMemo(()=>GREAT.map(layer=>{
    const geom=buildLayer(layer.id,sky);
    // No authoritative geometry exists for #9 in the source.
    // Draw an explicitly labelled schematic circle rather than claiming certainty.
    const lines=geom.lines.length?geom.lines:layer.num===9?[greatCircle(planeNormal(sky.K,V(0,1,0)))]:[];
    return {layer,lines};
  }),[sky]);
  const pick=useCallback((e:ThreeEvent<PointerEvent>)=>{
    if(tool!=="line"&&tool!=="ruler")return;
    e.stopPropagation();onPick(tuple(e.point.clone().normalize()));
  },[tool,onPick]);
  return <>
    <ambientLight intensity={1}/>
    <OrbitControls makeDefault enabled={tool==="orbit"} enablePan={false} enableDamping
      minDistance={1.45} maxDistance={9} minPolarAngle={0.015} maxPolarAngle={Math.PI-0.015}/>
    <mesh onPointerDown={pick}>
      <sphereGeometry args={[1,80,60]}/>
      <meshBasicMaterial color="#e4efff" transparent opacity={0.13} side={THREE.FrontSide} depthWrite={false}/>
    </mesh>
    <mesh scale={1.001}><sphereGeometry args={[1,32,24]}/>
      <meshBasicMaterial color="#8eaccd" wireframe transparent opacity={0.05} depthWrite={false}/></mesh>
    {great.filter(({layer})=>visible.includes(layer.id)).map(({layer,lines})=><group key={layer.id}>
      {lines.map((pts,i)=><Line key={i} points={pts.map(p=>p.clone().multiplyScalar(1.006))}
        color={layer.color} lineWidth={layer.num<=2?3:2} transparent opacity={0.9}
        depthTest={false} raycast={()=>null}/>)}
    </group>)}
    {directions&&([
      [V(0,0,-1.16),"N","North"],[V(0,0,1.16),"S","South"],
      [V(1.16,0,0),"E","East"],[V(-1.16,0,0),"W","West"],
    ] as const).map(([p,ar,en])=><SphereTag key={ar} at={p} ar={ar} en={en} color="#546782"/>)}
    {zenith&&<><mesh position={[0,1,0]}><sphereGeometry args={[0.016,12,12]}/><meshBasicMaterial color="#146bb7"/></mesh>
      <SphereTag at={V(0,1.18,0)} ar="سَمْتُ الرَّأْسِ" en="Zenith" color="#146bb7"/></>}
    {nadir&&<><mesh position={[0,-1,0]}><sphereGeometry args={[0.016,12,12]}/><meshBasicMaterial color="#146bb7"/></mesh>
      <SphereTag at={V(0,-1.18,0)} ar="سَمْتُ الْقَدَمِ" en="Nadir" color="#146bb7"/></>}
    {SEASONS.filter(s=>seasons.includes(s.longitude)).map(s=>{
      const p=sky.eclToLocal(s.longitude);
      return <group key={s.longitude}>
        <mesh position={p}><sphereGeometry args={[0.022,16,16]}/><meshBasicMaterial color="#b97548"/></mesh>
        <SphereTag at={p.clone().multiplyScalar(1.16)} ar={s.ar} en={s.en} color="#89532D"/>
      </group>;
    })}
    {segments.map(seg=><InkLine key={seg.id} segment={seg}/>)}
    {pending&&<mesh position={unit(pending).multiplyScalar(1.015)}>
      <sphereGeometry args={[0.023,20,20]}/><meshBasicMaterial color={color} depthTest={false}/></mesh>}
  </>;
}
function ToolButton({active,onClick,children,label}:{active:boolean;onClick:()=>void;children:ReactNode;label:string}) {
  return <button type="button" className={"classroom-tool"+(active?" is-active":"")}
    onClick={onClick} aria-pressed={active} title={label}>{children}</button>;
}
function inkPath(points:[number,number][]) {
  return points.map((p,i)=>(i?"L":"M")+(p[0]*1000).toFixed(2)+" "+(p[1]*1000).toFixed(2)).join(" ");
}
export function ClassroomApp(){
  const [visible,setVisible]=useState<string[]>(DEFAULT_VISIBLE);
  const [mobilePanel,setMobilePanel]=useState<"layers"|"tools">("tools");
  const [zenith,setZenith]=useState(true);
  const [nadir,setNadir]=useState(true);
  const [directions,setDirections]=useState(true);
  const [seasons,setSeasons]=useState<number[]>(SEASONS.map(s=>s.longitude));
  const [tool,setTool]=useState<Tool>("orbit");
  const [placement,setPlacement]=useState<Placement>("inside");
  const [color,setColor]=useState("#2872D4");
  const [width,setWidth]=useState(3);
  const [pending,setPending]=useState<Position|null>(null);
  const [segments,setSegments]=useState<Segment[]>([]);
  const [strokes,setStrokes]=useState<Stroke[]>([]);
  const [drawing,setDrawing]=useState<Stroke|null>(null);
  const [history,setHistory]=useState<Action[]>([]);
  const [info,setInfo]=useState("Drag to orbit · Line and Scale use two points.");
  const nextId=useRef(1);
  const chooseTool=(next:Tool)=>{
    setTool(next);setPending(null);setDrawing(null);
    setInfo(next==="orbit"?"Drag to rotate the sphere. Scroll or pinch to zoom.":next==="pen"?
      "Draw on the whiteboard with your mouse or stylus.":"Click two points on the sphere.");
  };
  const onPick=useCallback((pos:Position)=>{
    if(!pending){setPending(pos);setInfo("Point 1 selected. Click the second point.");return;}
    const theta=angleOf(pending,pos);
    if(theta<0.5){setInfo("Choose a different second point.");return;}
    if(placement==="outside"&&theta>155){setInfo("For outside straight lines, choose points less than 155° apart.");return;}
    const id=nextId.current++;
    setSegments(old=>[...old,{id,a:pending,b:pos,color,width,place:placement,measurement:tool==="ruler"}]);
    setHistory(old=>[...old,{id,kind:"segment"}]);
    setInfo((tool==="ruler"?"Angle":"Line") + ": "+theta.toFixed(1)+"° · "+placement);
    setPending(null);
  },[pending,color,width,placement,tool]);
  const inkPos=(e:ReactPointerEvent<SVGSVGElement>):[number,number]=>{
    const rect=e.currentTarget.getBoundingClientRect();
    return [(e.clientX-rect.left)/Math.max(1,rect.width),(e.clientY-rect.top)/Math.max(1,rect.height)];
  };
  const beginInk=(e:ReactPointerEvent<SVGSVGElement>)=>{
    if(tool!=="pen")return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing({id:nextId.current++,color,width,points:[inkPos(e)]});
  };
  const moveInk=(e:ReactPointerEvent<SVGSVGElement>)=>{
    if(tool!=="pen")return;
    const point=inkPos(e);
    setDrawing(old=>old?{...old,points:[...old.points,point]}:null);
  };
  const endInk=()=>{
    if(!drawing)return;
    setStrokes(old=>[...old,drawing]);setHistory(old=>[...old,{id:drawing.id,kind:"stroke"}]);setDrawing(null);
  };
  const undo=()=>{
    if(pending){setPending(null);return;}
    const last=history[history.length-1];if(!last)return;
    if(last.kind==="stroke")setStrokes(old=>old.filter(item=>item.id!==last.id));
    else setSegments(old=>old.filter(item=>item.id!==last.id));
    setHistory(old=>old.slice(0,-1));
  };
  const clear=()=>{
    if(!history.length&&!pending)return;
    if(!window.confirm("Clear all drawings?"))return;
    setSegments([]);setStrokes([]);setHistory([]);setPending(null);setDrawing(null);
  };
  return <main className="classroom-root" data-panel={mobilePanel}>
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
    <section className="classroom-stage" aria-label="Interactive celestial sphere">
      <Canvas className="classroom-canvas" dpr={[1,1.7]}
        gl={{alpha:true,antialias:true}} camera={{position:[2.15,1.15,3.6],fov:43,near:0.01,far:80}}>
        <Sphere visible={visible} zenith={zenith} nadir={nadir} directions={directions} seasons={seasons}
          segments={segments} pending={pending} tool={tool} color={color} onPick={onPick}/>
      </Canvas>
      <svg className={"classroom-ink-layer"+(tool==="pen"?" can-draw":"")}
        viewBox="0 0 1000 1000" preserveAspectRatio="none"
        onPointerDown={beginInk} onPointerMove={moveInk} onPointerUp={endInk} onPointerCancel={endInk}
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
        <p className="classroom-hint">Click two points with Line or Scale. Inside: straight chord. Outside: elevated straight line. Scale shows their angle.</p>
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
        <button onClick={clear} disabled={!pending&&!history.length}><Eraser size={15}/> Clear</button>
        <button onClick={()=>{setSegments([]);setStrokes([]);setHistory([]);setPending(null);setVisible(DEFAULT_VISIBLE);setSeasons(SEASONS.map(s=>s.longitude));setZenith(true);setNadir(true);setDirections(true);chooseTool("orbit");}}><RotateCcw size={15}/> Reset</button>
      </div>
    </aside>
    <div className="classroom-status classroom-glass" role="status"><span className="classroom-status-dot"/><span>{info}</span>
      {pending&&<button onClick={()=>setPending(null)}><X size={14}/> Cancel</button>}</div>
  </main>;
}
