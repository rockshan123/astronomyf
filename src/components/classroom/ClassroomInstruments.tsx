import { useRef, useState, type PointerEvent } from "react";
import { RotateCcw, Grip } from "lucide-react";

type Instrument = "ruler" | "protractor";
type Placement = { x: number; y: number; angle: number };
type Gesture = { id: number; startX: number; startY: number; x: number; y: number; mode: "move" | "rotate"; startAngle: number };

const rulerTicks = Array.from({ length: 201 }, (_, i) => i);
const angleTicks = Array.from({ length: 37 }, (_, i) => i * 5);

function ProtractorFace() {
  const cX = 170, cY = 181, radius = 148;
  return (
    <svg viewBox="0 0 340 203" className="classroom-protractor-face" aria-label="180-degree translucent protractor, with five-degree ticks">
      <defs>
        <linearGradient id="protractor-glass" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.88" />
          <stop offset="1" stopColor="#d7edff" stopOpacity="0.54" />
        </linearGradient>
      </defs>
      <path d="M 9 181 A 161 161 0 0 0 331 181 L 9 181" fill="url(#protractor-glass)" stroke="#3b77ac" strokeWidth="1.8" />
      <path d="M 34 181 A 136 136 0 0 0 306 181" stroke="#719dc6" strokeWidth="0.9" strokeDasharray="3 4" fill="none" />
      <path d="M 9 181 H 331" stroke="#3d699c" strokeWidth="1.6" />
      {angleTicks.map((degree) => {
        const theta = (180 - degree) * Math.PI / 180;
        const major = degree % 10 === 0;
        const outer = radius + 7, inner = radius - (major ? 16 : 9);
        const point = (r: number) => ({ x: cX + Math.cos(theta) * r, y: cY - Math.sin(theta) * r });
        const p1 = point(inner), p2 = point(outer), label = point(radius - 32);
        return <g key={degree}>
          <path d={"M " + p1.x + " " + p1.y + " L " + p2.x + " " + p2.y}
            stroke="#376c9f" strokeWidth={major ? 1.5 : 0.9} />
          {degree % 20 === 0 && <text x={label.x} y={label.y + 3} textAnchor="middle" fontSize="11"
            fontWeight="600" fill="#2d5a8e">{degree}</text>}
        </g>;
      })}
      <circle cx={cX} cy={cY} r="8" fill="#e8f5ff" stroke="#256caa" strokeWidth="1.5" />
      <path d="M 158 181 H 182 M 170 169 V 193" stroke="#285d9a" strokeWidth="1.1" />
      <text x="170" y="16" textAnchor="middle" fontSize="10" fontWeight="700" fill="#45698d">PROTRACTOR · 0°–180°</text>
    </svg>
  );
}

export function ClassroomInstrument({ type, onClose }: { type: Instrument; onClose: () => void }) {
  const [placement, setPlacement] = useState<Placement>({
    x: type === "ruler" ? 360 : 430,
    y: type === "ruler" ? 130 : 260,
    angle: 0,
  });
  const action = useRef<Gesture | null>(null);
  const onDown = (e: PointerEvent<HTMLDivElement>, mode: Gesture["mode"]) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    action.current = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY,
      x: placement.x, y: placement.y, mode, startAngle: placement.angle,
    };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = action.current;
    if (!g || g.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (g.mode === "move") {
      setPlacement(old => ({
        ...old, x: g.x + e.clientX - g.startX, y: g.y + e.clientY - g.startY,
      }));
    } else {
      setPlacement(old => ({ ...old, angle: g.startAngle + (e.clientX - g.startX) * 0.75 }));
    }
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (action.current?.id !== e.pointerId) return;
    e.stopPropagation();
    action.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return (
    <div className={"classroom-instrument classroom-instrument-" + type}
      style={{ left: placement.x, top: placement.y, transform: "rotate(" + placement.angle + "deg)" }}
      onPointerDown={e => e.stopPropagation()}>
      <div className="classroom-instrument-grip" role="button" tabIndex={0}
        aria-label={"Drag " + type} title="Drag to move instrument"
        onPointerDown={e => onDown(e, "move")} onPointerMove={onMove}
        onPointerUp={onUp} onPointerCancel={onUp}>
        <Grip size={14} /><span>{type === "ruler" ? "RULER · diagram scale" : "PROTRACTOR · angular guide"}</span>
        <button type="button" title="Remove instrument"
          onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onClose(); }}>×</button>
      </div>
      {type === "ruler" ? (
        <div className="classroom-ruler-face" aria-label="Transparent ruler with 0–20 diagram-centimetre marks">
          <span className="classroom-ruler-units">0–20 · diagram cm</span>
          <div className="classroom-ruler-ticks">
            {rulerTicks.map(i => <span key={i} className={i % 10 === 0 ? "major" : i % 5 === 0 ? "medium" : "minor"}
              style={{ left: i * 1.75 }}>{i % 10 === 0 && <small>{i / 10}</small>}</span>)}
          </div>
        </div>
      ) : <ProtractorFace />}
      <div className="classroom-instrument-footer">
        <div className="classroom-instrument-rotate" onPointerDown={e => onDown(e, "rotate")}
          onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          title="Drag horizontally to rotate"><RotateCcw size={13} /> Rotate</div>
        <span>{Math.round(placement.angle % 360)}°</span>
      </div>
    </div>
  );
}
