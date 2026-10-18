import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitImpl } from "three-stdlib";
import { useSky } from "@/store/useSky";
import { FloatingSun, FloatingMoon } from "./CelestialBodies";
import { LAYERS } from "@/data/layers";
import { computeSky } from "@/lib/astronomy/sky";
import { buildLayer } from "@/lib/astronomy/layerGeometry";
import { greatCircle, smallCircle, DEG, V, slerpArc } from "@/lib/astronomy/math";

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function StarField({ count }: { count: number }) {
  const geo = useMemo(() => {
    const r = seeded(42);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.9, 0.3, 0.5));
    for (let i = 0; i < count; i++) {
      const band = i < count * 0.55;
      let v: THREE.Vector3;
      if (band) {
        const a = r() * Math.PI * 2;
        const h = (r() + r() + r() - 1.5) * 0.18;
        v = V(Math.cos(a), h, Math.sin(a)).normalize().applyMatrix4(tilt);
      } else {
        const u = r() * 2 - 1, a = r() * Math.PI * 2;
        v = V(Math.sqrt(1 - u * u) * Math.cos(a), u, Math.sqrt(1 - u * u) * Math.sin(a));
      }
      v.multiplyScalar(40 + r() * 20);
      pos.set([v.x, v.y, v.z], i * 3);
      const w = 0.5 + r() * 0.5;
      const tint = r();
      col.set([w * (tint > 0.8 ? 1 : 0.85), w * 0.9, w * (tint < 0.3 ? 1 : 0.8)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, [count]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <points geometry={geo}>
      <pointsMaterial size={0.12} vertexColors transparent opacity={0.9} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function Label({ pos, text, color, sub, size = "sm", seasonal = false }: { pos: THREE.Vector3; text: string; color?: string; sub?: string | undefined; size?: "sm" | "lg"; seasonal?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const inside = useSky((state) => state.view === "inside");
  const xray = useSky((state) => state.xray);
  const direction = useMemo(() => new THREE.Vector3(), []);
  // HTML labels live outside the WebGL depth buffer. Occlude against the
  // 0.995-radius depth sphere using a camera-to-label segment test.
  useFrame(({ camera }) => {
    if (!element.current) return;
    if (inside || xray) {
      element.current.style.visibility = "visible";
      element.current.style.opacity = "1";
      return;
    }
    const cameraPosition = camera.position;
    direction.copy(pos).sub(cameraPosition);
    const a = direction.lengthSq();
    const b = 2 * cameraPosition.dot(direction);
    const c = cameraPosition.lengthSq() - 0.995 * 0.995;
    const disc = b * b - 4 * a * c;
    let hidden = false;
    if (a > 0.000001 && c > 0 && disc >= 0) {
      const near = (-b - Math.sqrt(disc)) / (2 * a);
      hidden = near > 0.0001 && near < 0.999;
    }
    element.current.style.visibility = hidden ? "hidden" : "visible";
    element.current.style.opacity = hidden ? "0" : "1";
  });
  return (
    <Html position={pos} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
      <div ref={element} className={`sky-label ${size === "lg" ? "sky-label-lg" : ""} ${seasonal ? "sky-label-season" : ""}`} style={{ color }}>
        <span>{text}</span>
        {sub && <small>{sub}</small>}
      </div>
    </Html>
  );
}

function Dot({ pos, color, r = 0.025 }: { pos: THREE.Vector3; color: string; r?: number }) {
  return (
    <mesh position={pos}>
      <sphereGeometry args={[r, 16, 16]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

/** Depth-tested surface arcs; far-side dashes only in optional X-Ray mode. */
function SkyLine({ pts, color, width, opacity, onClick, onOver, onOut, occlude, xray }: {
  pts: THREE.Vector3[]; color: string; width: number; opacity: number; occlude: boolean; xray: boolean;
  onClick?: () => void; onOver?: () => void; onOut?: () => void;
}) {
  return (
    <>
      <Line points={pts} color={color} lineWidth={width} transparent opacity={opacity}
        depthTest depthWrite={false}
        onClick={(e) => { e.stopPropagation(); onClick?.(); }}
        onPointerOver={(e) => { e.stopPropagation(); onOver?.(); }}
        onPointerOut={() => onOut?.()} />
      {occlude && xray && (
        <Line points={pts} color={color} lineWidth={Math.max(0.8, width * 0.6)}
          transparent opacity={Math.min(0.28, opacity * 0.25)}
          dashed dashSize={0.04} gapSize={0.035}
          depthTest depthFunc={THREE.GreaterDepth} depthWrite={false}
          raycast={() => null} />
      )}
    </>
  );
}

function Human() {
  return (
    <group scale={0.09}>
      <mesh position={[0, 0.45, 0]}><capsuleGeometry args={[0.16, 0.5, 4, 12]} /><meshStandardMaterial color="#d6c7a1" /></mesh>
      <mesh position={[0, 0.95, 0]}><sphereGeometry args={[0.14, 16, 16]} /><meshStandardMaterial color="#e8d9b5" /></mesh>
      <mesh position={[0, 0.98, -0.13]}><sphereGeometry args={[0.035, 8, 8]} /><meshBasicMaterial color="#38bdf8" /></mesh>
    </group>
  );
}

function CameraRig() {
  const controls = useRef<OrbitImpl>(null);
  const { camera } = useThree();
  const autoOrbit = useSky((s) => s.autoOrbit);
  const speed = useSky((s) => s.orbitSpeed);
  const view = useSky((s) => s.view);
  const cmd = useSky((s) => s.camCmd);
  const goal = useRef<THREE.Vector3 | null>(null);
  const resumeAt = useRef(0);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!cmd) return;
    if (cmd.kind === "reset") goal.current = view === "inside" ? V(0.02, 0.06, 0.06) : V(2.6, 1.6, 3.2);
    else if (cmd.dir) {
      const d = V(...cmd.dir).normalize();
      goal.current = view === "inside" ? d.multiplyScalar(-0.08).add(V(0, 0.06, 0)) : d.multiplyScalar(3.6);
    }
  }, [cmd, view]);
  useEffect(() => { goal.current = view === "inside" ? V(0.02, 0.06, 0.08) : V(2.6, 1.6, 3.2); }, [view]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    if (goal.current) {
      camera.position.lerp(goal.current, 1 - Math.exp(-6 * Math.min(dt, 0.05)));
      if (camera.position.distanceTo(goal.current) < 0.005) goal.current = null;
    }
    c.autoRotate = autoOrbit && !reduced && !goal.current && performance.now() > resumeAt.current;
    c.update();
  });

  return (
    <OrbitControls ref={controls as never} enableRotate enablePan={false} enableDamping dampingFactor={0.07}
      autoRotateSpeed={speed} rotateSpeed={0.65} zoomSpeed={0.9}
      minPolarAngle={0.015} maxPolarAngle={Math.PI - 0.015}
      minAzimuthAngle={-Infinity} maxAzimuthAngle={Infinity}
      target={view === "inside" ? [0, 0.06, 0] : [0, 0, 0]}
      minDistance={view === "inside" ? 0.025 : 1.4} maxDistance={view === "inside" ? 0.6 : 12}
      onStart={() => { goal.current = null; resumeAt.current = performance.now() + 4000; }}
      onEnd={() => (resumeAt.current = performance.now() + 4000)} />
  );
}

function TimeDriver() {
  const acc = useRef(0);
  useFrame((_, dt) => {
    const s = useSky.getState();
    if (!s.timePlaying) return;
    acc.current += Math.min(dt, 0.1);
    if (acc.current > 0.1) {
      s.set({ simTime: s.simTime + acc.current * s.timeMult * 1000 });
      acc.current = 0;
    }
  });
  return null;
}

export function Scene() {
  const st = useSky();
  const sky = useMemo(() => computeSky(new Date(st.simTime), st.lat, st.lon), [st.simTime, st.lat, st.lon]);
  const t = st.toggles;
  const inside = st.view === "inside";
  const occlude = !inside;
  const lowQ = st.quality === "low";
  const lineW = st.quality === "high" ? 2.6 : lowQ ? 1.6 : 2.2;

  const layerGeoms = useMemo(
    () => LAYERS.filter((l) => st.visible[l.id] || st.selected === l.id).map((l) => ({ l, g: buildLayer(l.id, sky) })),
    [sky, st.visible, st.selected],
  );

  const sunTrail = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) pts.push(sky.eclToLocal(sky.sunLon - 40 + i));
    return pts;
  }, [sky]);
  const sunAhead = useMemo(() => slerpArc(sky.sun, sky.eclToLocal(sky.sunLon + 8), 8), [sky]);
  const dailySun = useMemo(() => smallCircle(sky.P, Math.sin(sky.sunDec * DEG), 200), [sky]);
  const graticule = useMemo(() => {
    const out: THREE.Vector3[][] = [];
    for (let a = 0; a < 180; a += 30) out.push(greatCircle(V(Math.cos(a * DEG), 0, Math.sin(a * DEG)), 96));
    for (const h of [-60, -30, 30, 60]) out.push(smallCircle(V(0, 1, 0), Math.sin(h * DEG), 96));
    return out;
  }, []);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} />
      <TimeDriver />
      <CameraRig />
      {t.stars && <StarField count={lowQ ? 1500 : st.quality === "high" ? 6000 : 3500} />}

      {/* Invisible depth-writing sphere hides the far hemisphere in normal mode. */}
      {occlude && (
        <mesh renderOrder={-1}>
          <sphereGeometry args={[0.995, 64, 64]} />
          <meshBasicMaterial colorWrite={false} />
        </mesh>
      )}
      {t.shell && (
        <mesh>
          <sphereGeometry args={[1, 64, 64]} />
          <meshBasicMaterial color="#6ea8ff" transparent opacity={inside ? 0.03 : 0.07} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {/* horizon disk */}
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1, 96]} />
        <meshBasicMaterial color="#4ade80" transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {t.graticule && graticule.map((g, i) => <Line key={i} points={g} color="#5b6b8c" lineWidth={0.7} transparent opacity={0.35} />)}
      {t.human && <Human />}
      {t.sight && <Line points={[V(0, 0.09, 0), sky.T.clone()]} color="#38bdf8" lineWidth={1.5} dashed dashSize={0.04} gapSize={0.02} />}
      {t.axes && (
        <>
          <Line points={[V(-1.2, 0, 0), V(1.2, 0, 0)]} color="#ef4444" lineWidth={1} />
          <Line points={[V(0, -1.2, 0), V(0, 1.2, 0)]} color="#22c55e" lineWidth={1} />
          <Line points={[V(0, 0, -1.2), V(0, 0, 1.2)]} color="#3b82f6" lineWidth={1} />
          {t.labels && <><Label pos={V(1.28, 0, 0)} text="+X" /><Label pos={V(0, 1.28, 0)} text="+Y" /><Label pos={V(0, 0, 1.28)} text="+Z" /></>}
        </>
      )}

      {layerGeoms.map(({ l, g }) => {
        const hot = st.hovered === l.id || st.selected === l.id;
        const op = st.opacity[l.id] ?? 1;
        const isArc = l.group === "arc";
        return (
          <group key={l.id}>
            {g.reference && hot && <Line points={g.reference} color={l.color} lineWidth={0.8} transparent opacity={0.25} />}
            {g.lines.map((pts, i) => (
              <SkyLine key={i} pts={pts} color={l.color} width={(isArc ? lineW * 1.8 : lineW) * (hot ? 1.8 : 1)} opacity={op} occlude={occlude} xray={st.xray}
                onClick={() => st.set({ selected: l.id })}
                onOver={() => { st.set({ hovered: l.id }); document.body.style.cursor = "pointer"; }}
                onOut={() => { st.set({ hovered: null }); document.body.style.cursor = ""; }} />
            ))}
            {t.labels && g.label && (hot || !isArc || st.visible[l.id]) && (
              <Label pos={g.label.clone().multiplyScalar(1.04)} text={l.ar} color={l.color} sub={hot ? `${l.en}${g.measure ? " · " + g.measure : ""}` : g.measure} />
            )}
          </group>
        );
      })}

      {t.cardinals && ([["N", V(0, 0, -1.08), "North · شمال"], ["S", V(0, 0, 1.08), "South · جنوب"], ["E", V(1.08, 0, 0), "East · مشرق"], ["W", V(-1.08, 0, 0), "West · مغرب"]] as const).map(([k, p, sub]) => (
        <Label key={k} pos={p} text={k} sub={sub} size="lg" />
      ))}
      {t.zenith && <><Dot pos={V(0, 1, 0)} color="#ffffff" /><Dot pos={V(0, -1, 0)} color="#9ca3af" />
        {t.labels && <><Label pos={V(0, 1.1, 0)} text="سمت الرأس" sub="Zenith (+Y)" /><Label pos={V(0, -1.1, 0)} text="سمت القدم" sub="Nadir (−Y)" /></>}</>}
      {t.poles && <><Dot pos={sky.P} color="#f5c542" r={0.03} /><Dot pos={sky.S} color="#f5c542" r={0.03} />
        <Line points={[sky.S.clone().multiplyScalar(1.1), sky.P.clone().multiplyScalar(1.1)]} color="#f5c542" lineWidth={0.8} transparent opacity={0.4} />
        {t.labels && <><Label pos={sky.P.clone().multiplyScalar(1.12)} text="القطب الشمالي" sub="North celestial pole" color="#f5c542" /><Label pos={sky.S.clone().multiplyScalar(1.12)} text="القطب الجنوبي" sub="South celestial pole" color="#f5c542" /></>}</>}
      {t.eclPoles && <><Dot pos={sky.K} color="#ff5d5d" /><Dot pos={sky.K.clone().negate()} color="#ff5d5d" />
        {t.labels && <><Label pos={sky.K.clone().multiplyScalar(1.12)} text="قطب البروج" sub="N ecliptic pole" color="#ff5d5d" /><Label pos={sky.K.clone().negate().multiplyScalar(1.12)} text="قطب البروج" sub="S ecliptic pole" color="#ff5d5d" /></>}</>}
      {t.markers && ([
        [0, "الاعتدال الربيعي", "Vernal Equinox"],
        [90, "الانقلاب الصيفي", "June Solstice"],
        [180, "الاعتدال الخريفي", "Autumnal Equinox"],
        [270, "الانقلاب الشتوي", "December Solstice"],
      ] as const).map(([lon, ar, en]) => (
        <group key={lon}>
          <Dot pos={sky.eclToLocal(lon)} color="#ffb4b4" r={0.018} />
          {t.labels && <Label pos={sky.eclToLocal(lon).multiplyScalar(1.08)}
            text={ar} sub={en} color="#ffb4b4" seasonal />}
        </group>
      ))}
      {t.dailySun && <Line points={dailySun} color="#ffd27a" lineWidth={1.4} dashed dashSize={0.05} gapSize={0.03} />}
      {t.sun && (
        <group>
          <Line points={sunTrail} color="#ffcf5a" lineWidth={4} transparent opacity={0.45} />
          <Line points={sunAhead} color="#fff3c4" lineWidth={2} />
          <FloatingSun direction={sky.sun} />
          {t.labels && <Label pos={sky.sun.clone().multiplyScalar(1.27)} text="الشمس" sub={`Sun · λ ${sky.sunLon.toFixed(1)}°`} color="#ffd54a" />}
        </group>
      )}
      {t.moon && sky.moon && <><FloatingMoon direction={sky.moon} />
        {t.labels && <Label pos={sky.moon.clone().multiplyScalar(1.25)} text="القمر" sub="Moon" color="#d9dde6" />}</>}
      {t.target && <><Dot pos={sky.T} color="#7dd3fc" r={0.028} />{t.labels && <Label pos={sky.T.clone().multiplyScalar(1.1)} text="الدبران" sub="Aldebaran (target)" color="#7dd3fc" />}</>}
    </>
  );
}
