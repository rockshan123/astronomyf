import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Link } from "@tanstack/react-router";
import { useSky, TOGGLES, type ToggleKey } from "@/store/useSky";
import { LAYERS, GROUPS, PRESETS, LAYER_BY_ID, type Group } from "@/data/layers";
import { buildLayer } from "@/lib/astronomy/layerGeometry";
import { computeSky, TARGET } from "@/lib/astronomy/sky";
import { localToAltAz } from "@/lib/astronomy/math";
import { Scene } from "./Scene";
import {
  Search, Eye, EyeOff, Crosshair, Focus, Play, Pause, RotateCcw, Maximize, Camera, Share2, X,
  PanelLeft, HelpCircle, MonitorPlay, MapPin, Orbit, Clock, Footprints, ImageOff, PenLine,
} from "lucide-react";

const MULTS: [string, number][] = [["1×", 1], ["10×", 10], ["100×", 100], ["1 h/s", 3600], ["1 day/10s", 8640], ["1 yr/30s", 365.25 * 86400 / 30]];
const LOCS: [string, number, number][] = [["Equator", 0, 0], ["11° N", 11, 75.8], ["45° N", 45, 7.7], ["30° S", -30, 31], ["N pole", 89.9, 0], ["S pole", -89.9, 0]];

function webglOk() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

function readShare() {
  const h = new URLSearchParams(window.location.hash.slice(1));
  if (!h.has("lat")) return;
  const v = h.get("v")?.split(",").map(Number) ?? [];
  useSky.getState().set({
    lat: Number(h.get("lat")), lon: Number(h.get("lon") ?? 0),
    simTime: Number(h.get("t") ?? Date.now()),
    visible: Object.fromEntries(LAYERS.map((l) => [l.id, v.includes(l.num)])),
  });
}

export function SkyApp() {
  const [gl, setGl] = useState<boolean | null>(null);
  const [help, setHelp] = useState(false);
  const [present, setPresent] = useState(false);
  const st = useSky();

  useEffect(() => {
    setGl(webglOk());
    readShare();
    if (window.innerWidth < 768) useSky.getState().set({ sidebarOpen: false, quality: "low" });
  }, []);

  // guided tour
  useEffect(() => {
    if (!st.touring) return;
    let i = 0;
    const step = () => {
      const l = LAYERS[i % LAYERS.length]!;
      const s = useSky.getState();
      s.solo(l.id);
      const g = buildLayer(l.id, computeSky(new Date(s.simTime), s.lat, s.lon));
      if (g.label) s.cam("focus", [g.label.x, g.label.y, g.label.z]);
      i++;
    };
    step();
    const id = setInterval(step, 6000);
    return () => clearInterval(id);
  }, [st.touring]);

  return (
    <div className="sky-root">
      <div className="sky-nebula" aria-hidden />
      {gl === false ? (
        <div className="sky-fallback glass">
          <h2>WebGL unavailable</h2>
          <p>Your browser cannot render the 3D sphere. The 30 layers and explanations are still listed on the left.</p>
        </div>
      ) : gl ? (
        <Canvas className="sky-canvas" dpr={[1, st.quality === "high" ? 2 : st.quality === "low" ? 1 : 1.5]}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
          camera={{ position: [2.6, 1.6, 3.2], fov: 50, near: 0.005, far: 200 }}
          onPointerMissed={() => st.set({ selected: null })}>
          <Suspense fallback={null}><Scene /></Suspense>
        </Canvas>
      ) : <div className="sky-loading">Loading celestial sphere…</div>}

      {!present && <TopBar onHelp={() => setHelp(true)} onPresent={() => setPresent(true)} />}
      {!present && st.sidebarOpen && <Sidebar />}
      {!present && <Drawer />}
      {!present && <BottomBar />}
      {present && <button className="sky-btn present-exit glass" onClick={() => setPresent(false)}><X size={16} /> Exit presentation</button>}
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}

function TopBar({ onHelp, onPresent }: { onHelp: () => void; onPresent: () => void }) {
  const { set, sidebarOpen } = useSky();
  return (
    <header className="sky-top glass">
      <button className="sky-icon" aria-label="Toggle layers" onClick={() => set({ sidebarOpen: !sidebarOpen })}><PanelLeft size={18} /></button>
      <div className="brand">
        <span className="brand-en">TASHRIHUL AFLAK 3D</span>
      </div>
      <Link to="/classroom" className="sky-btn classroom-nav-link"><PenLine size={14} /> Classroom</Link>
      <button className="sky-icon" aria-label="Help" onClick={onHelp}><HelpCircle size={18} /></button>
      <button className="sky-icon" aria-label="Presentation mode" onClick={onPresent}><MonitorPlay size={18} /></button>
    </header>
  );
}

function Sidebar() {
  const st = useSky();
  const [q, setQ] = useState("");
  const [showToggles, setShowToggles] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Set<Group>>(() => new Set());
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [beforePreset, setBeforePreset] = useState<Record<string, boolean> | null>(null);
  const isMatchingPreset = (name: string, ids: readonly string[] | null) =>
    activePreset === name && LAYERS.every(l =>
      !!st.visible[l.id] === (ids ? ids.includes(l.id) : !!st.custom[l.id])
    );
  const togglePreset = (name: string, ids: readonly string[] | null) => {
    if (isMatchingPreset(name, ids)) {
      st.set({ visible: beforePreset ?? st.custom, selected: null });
      setBeforePreset(null);
      setActivePreset(null);
      return;
    }
    if (activePreset === null) setBeforePreset({ ...st.visible });
    st.set({
      visible: ids
        ? Object.fromEntries(LAYERS.map(l => [l.id, ids.includes(l.id)]))
        : { ...st.custom },
      selected: null,
    });
    setActivePreset(name);
  };
  const flipGroup = (group: Group) => setClosedGroups((previous) => { const next = new Set(previous); next.has(group) ? next.delete(group) : next.add(group); return next; });
  const ql = q.trim().toLowerCase();
  const strip = (s: string) => s.replace(/[\u064B-\u0652\u0670]/g, "");
  const match = (l: (typeof LAYERS)[number]) => !ql || l.en.toLowerCase().includes(ql) || strip(l.ar).includes(strip(q.trim())) || l.ml.includes(q.trim()) || String(l.num) === ql;
  const sky = useMemo(() => computeSky(new Date(st.simTime), st.lat, st.lon), [st.simTime, st.lat, st.lon]);

  const focus = (id: string) => {
    const g = buildLayer(id, sky);
    const p = g.label ?? g.lines[0]?.[0];
    if (p) st.cam("focus", [p.x, p.y, p.z]);
    st.set({ selected: id });
  };

  return (
    <aside className="sky-side glass">
      <div className="side-search">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Arabic / English…" aria-label="Search layers" />
      </div>
      <div className="presets">
        {Object.entries(PRESETS).map(([name, ids]) => {
          const active = isMatchingPreset(name, ids);
          return <button key={name} type="button"
            className={`chip ${active ? "chip-on" : ""}`}
            aria-pressed={active}
            onClick={() => togglePreset(name, ids)}>{name}</button>;
        })}
        <button className={`chip ${st.touring ? "chip-on" : ""}`} onClick={() => st.set({ touring: !st.touring })}>{st.touring ? "Stop tour" : "▶ Guided tour"}</button>
      </div>
      <div className="side-scroll">
        {(Object.keys(GROUPS) as Group[]).map((g) => {
          const items = LAYERS.filter((l) => l.group === g && match(l));
          if (!items.length) return null;
          const on = items.filter((l) => st.visible[l.id]).length;
          return (
            <section key={g} className="grp">
              <div className="grp-head">
                <button className="grp-collapse" type="button" aria-expanded={!closedGroups.has(g)}
                  onClick={() => flipGroup(g)}>
                  <span className="grp-chevron">{closedGroups.has(g) ? "▸" : "▾"}</span>
                  <span dir="rtl" className="ar">{GROUPS[g].ar}</span>
                  <span className="muted">{GROUPS[g].en} · {on}/{items.length}</span>
                </button>
                <span className="grp-actions">
                  <button onClick={() => st.setMany(items.map((i) => i.id), true)}>all</button>
                  <button onClick={() => st.setMany(items.map((i) => i.id), false)}>none</button>
                </span>
              </div>
              {!closedGroups.has(g) && items.map((l) => (
                <div key={l.id} className={`row ${st.selected === l.id ? "row-sel" : ""}`}
                  onMouseEnter={() => st.set({ hovered: l.id })} onMouseLeave={() => st.set({ hovered: null })}>
                  <input type="checkbox" checked={!!st.visible[l.id]} onChange={() => st.toggleLayer(l.id)} aria-label={`Show ${l.en}`} />
                  <span className="sw" style={{ background: l.color }} />
                  <button className="row-name" aria-pressed={st.selected === l.id}
                    onClick={() => st.set({ selected: st.selected === l.id ? null : l.id })}>
                    <span className="num">{String(l.num).padStart(2, "0")}</span>
                    <span className="ar" dir="rtl">{l.ar}</span>
                    <span className="en">{l.en}{l.status !== "computed" && <em className="badge">{l.status === "review" ? "under review" : "schematic"}</em>}</span>
                  </button>
                  <button className="mini" title="Solo / deselect"
                    aria-pressed={st.selected === l.id && LAYERS.every(item => !!st.visible[item.id] === (item.id === l.id))}
                    aria-label="Solo / deselect"
                    onClick={() => {
                      const alreadySolo = st.selected === l.id &&
                        LAYERS.every(item => !!st.visible[item.id] === (item.id === l.id));
                      if (alreadySolo) st.set({ visible: { ...st.custom }, selected: null });
                      else st.solo(l.id);
                      setActivePreset(null);
                      setBeforePreset(null);
                    }}><Crosshair size={13} /></button>
                  <button className="mini" title="Focus camera" aria-label="Focus camera" onClick={() => focus(l.id)}><Focus size={13} /></button>
                </div>
              ))}
            </section>
          );
        })}
        <section className="grp">
          <div className="view-options">
            <label className="xray-toggle" title="Reveal faint, hidden far-side arcs">
              <input type="checkbox" checked={st.xray} onChange={(e) => st.set({ xray: e.target.checked })} />
              <span className="xray-indicator" />
              <span>X-Ray hemisphere</span>
              <small>{st.xray ? "On" : "Off"}</small>
            </label>
          </div>
          <button className="grp-head toggle-head" onClick={() => setShowToggles(!showToggles)}>
            <span>Scene objects</span><span className="muted">{showToggles ? "hide" : "show"}</span>
          </button>
          {showToggles && (
            <div className="toggles">
              {(Object.keys(TOGGLES) as ToggleKey[]).map((k) => (
                <label key={k} className="tg">
                  <input type="checkbox" checked={st.toggles[k]} onChange={() => st.set({ toggles: { ...st.toggles, [k]: !st.toggles[k] } })} />
                  {TOGGLES[k]}
                </label>
              ))}
            </div>
          )}
        </section>
        <Location />
      </div>
    </aside>
  );
}

function Location() {
  const { lat, lon, set } = useSky();
  const [msg, setMsg] = useState("");
  return (
    <section className="grp">
      <div className="grp-head"><span><MapPin size={13} /> Observer</span><span className="muted">φ {lat.toFixed(2)}° · λ {lon.toFixed(2)}°</span></div>
      <div className="loc">
        <label>Lat<input type="number" min={-90} max={90} step={0.1} value={lat} onChange={(e) => set({ lat: Math.max(-89.9, Math.min(89.9, Number(e.target.value))) })} /></label>
        <label>Lon<input type="number" min={-180} max={180} step={0.1} value={lon} onChange={(e) => set({ lon: Math.max(-180, Math.min(180, Number(e.target.value))) })} /></label>
      </div>
      <div className="presets">
        {LOCS.map(([n, a, o]) => <button key={n} className="chip" onClick={() => set({ lat: a, lon: o })}>{n}</button>)}
        <button className="chip equator-align" title="At latitude zero the celestial equator passes through Zenith and Nadir"
          onClick={() => set({ lat: 0 })}>Align مُعَدِّلُ النَّهَارِ · φ 0°</button>
        <button className="chip" onClick={() => {
          if (!navigator.geolocation) return setMsg("Geolocation not supported");
          navigator.geolocation.getCurrentPosition((p) => { set({ lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3) }); setMsg(""); }, () => setMsg("Permission denied"));
        }}>Use my location</button>
      </div>
      <p className="equator-note muted small">
        {Math.abs(lat) < 0.00001
          ? "Equatorial alignment: مُعَدِّلُ النَّهَارِ passes through Zenith and Nadir."
          : "At this latitude, the meridian passes through Zenith and Nadir; the celestial equator changes with observer latitude."}
      </p>
      {msg && <p className="muted small">{msg}</p>}
    </section>
  );
}

function Drawer() {
  const st = useSky();
  const l = st.selected ? LAYER_BY_ID[st.selected] : null;
  const [imgErr, setImgErr] = useState(false);
  useEffect(() => setImgErr(false), [st.selected]);
  const sky = useMemo(() => computeSky(new Date(st.simTime), st.lat, st.lon), [st.simTime, st.lat, st.lon]);
  if (!l) return null;
  const g = buildLayer(l.id, sky);
  const primary = st.lang === "ml" ? l.ml : st.lang === "ar" ? l.ar : l.def;
  const tAA = localToAltAz(sky.T);
  return (
    <aside className="sky-drawer glass" aria-label="Layer details">
      <button className="sky-icon close" aria-label="Close" onClick={() => st.set({ selected: null })}><X size={16} /></button>
      <div className="sw-bar" style={{ background: l.color }} />
      <p className="muted small">#{String(l.num).padStart(2, "0")} · {GROUPS[l.group].en}</p>
      <h2 className="ar ar-title" dir="rtl">{l.ar}</h2>
      <h3>{l.en}</h3>
      {l.status === "review" && <p className="review">Source definition under review — no 3D geometry is fabricated for this term.</p>}
      {l.status === "schematic" && <p className="review">Schematic visualization.</p>}
      <p className={st.lang === "ml" ? "ml" : st.lang === "ar" ? "ar" : ""} dir={st.lang === "ar" ? "rtl" : "ltr"}>{primary}</p>
      {st.lang !== "en" && <p className="muted small">{l.def}</p>}
      {st.lang !== "ml" && <p className="ml muted small">{l.ml}</p>}
      {g.measure && <div className="measure"><span>Current value</span><b>{g.measure}</b></div>}
      {g.note && <p className="muted small">{g.note}</p>}
      <div className="drawer-actions">
        <button className="chip" onClick={() => st.toggleLayer(l.id)}>{st.visible[l.id] ? <><EyeOff size={12} /> Hide</> : <><Eye size={12} /> Show</>}</button>
        <button className="chip" onClick={() => st.solo(l.id)}><Crosshair size={12} /> Solo</button>
        <button className="chip" onClick={() => { const p = g.label ?? g.lines[0]?.[0]; if (p) st.cam("focus", [p.x, p.y, p.z]); }}><Focus size={12} /> Focus</button>
        <a className="chip" href={`/references/${l.file}`} target="_blank" rel="noreferrer">Open PNG</a>
      </div>
      <label className="op">Opacity
        <input type="range" min={0.1} max={1} step={0.05} value={st.opacity[l.id] ?? 1} onChange={(e) => st.set({ opacity: { ...st.opacity, [l.id]: Number(e.target.value) } })} />
      </label>
      <div className="ref">
        {imgErr ? <div className="ref-missing"><ImageOff size={18} /><span>Reference <code>{l.file}</code> not uploaded yet</span></div>
          : <img src={`/references/${l.file}`} alt={`Reference diagram: ${l.en}`} onError={() => setImgErr(true)} loading="lazy" />}
        <p className="muted small">Reference diagrams are not to scale and are terminology aids only.</p>
      </div>
      {["04_declination", "05_latitude", "10_altitude", "17_star_declination", "18_star_latitude"].includes(l.id) && (
        <p className="muted small">Target {TARGET.name} ({TARGET.ar}): alt {tAA.alt.toFixed(1)}°, az {tAA.az.toFixed(1)}° · J2000 position, precession ignored.</p>
      )}
    </aside>
  );
}

function BottomBar() {
  const st = useSky();
  const d = new Date(st.simTime);
  const yStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const doy = Math.floor((st.simTime - yStart) / 86400000);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();

  const screenshot = () => {
    const c = document.querySelector<HTMLCanvasElement>(".sky-canvas canvas");
    if (!c) return;
    const o = document.createElement("canvas");
    o.width = c.width; o.height = c.height;
    const ctx = o.getContext("2d")!;
    ctx.fillStyle = "#03040a"; ctx.fillRect(0, 0, o.width, o.height); ctx.drawImage(c, 0, 0);
    const a = document.createElement("a"); a.download = "tashrihul-aflak.png"; a.href = o.toDataURL("image/png"); a.click();
  };
  const share = async () => {
    const v = LAYERS.filter((l) => st.visible[l.id]).map((l) => l.num).join(",");
    const url = `${location.origin}${location.pathname}#lat=${st.lat}&lon=${st.lon}&t=${Math.round(st.simTime)}&v=${v}`;
    history.replaceState(null, "", url);
    try { await navigator.clipboard.writeText(url); alert("Link copied"); } catch { prompt("Copy this link", url); }
  };

  return (
    <footer className="sky-bottom glass">
      <div className="bgrp">
        <button className="sky-btn" onClick={() => st.set({ autoOrbit: !st.autoOrbit })} aria-label="Toggle camera orbit"><Orbit size={14} />{st.autoOrbit ? <Pause size={12} /> : <Play size={12} />}</button>
        <input className="w-16" type="range" min={0.1} max={3} step={0.1} value={st.orbitSpeed} onChange={(e) => st.set({ orbitSpeed: Number(e.target.value) })} aria-label="Orbit speed" />
      </div>
      <div className="bgrp">
        <button className="sky-btn" onClick={() => st.set({ timePlaying: !st.timePlaying })} aria-label="Play simulated time"><Clock size={14} />{st.timePlaying ? <Pause size={12} /> : <Play size={12} />}</button>
        <select value={st.timeMult} onChange={(e) => st.set({ timeMult: Number(e.target.value) })} aria-label="Time speed">
          {MULTS.map(([n, m]) => <option key={n} value={m}>{n}</option>)}
        </select>
        <button className="sky-btn" onClick={() => st.set({ simTime: Date.now() })}>Now</button>
      </div>
      <div className="bgrp grow">
        <label className="slider">Day {doy + 1}
          <input type="range" min={0} max={365} value={doy} onChange={(e) => st.set({ simTime: yStart + Number(e.target.value) * 86400000 + minutes * 60000 })} />
        </label>
        <label className="slider">{String(d.getUTCHours()).padStart(2, "0")}:{String(d.getUTCMinutes()).padStart(2, "0")} UTC
          <input type="range" min={0} max={1439} value={minutes} onChange={(e) => st.set({ simTime: yStart + doy * 86400000 + Number(e.target.value) * 60000 })} />
        </label>
        <span className="muted small date">{d.toISOString().slice(0, 10)}</span>
      </div>
      <div className="bgrp">
        <button className={`sky-btn ${st.view === "inside" ? "on" : ""}`} onClick={() => st.set({ view: st.view === "inside" ? "outside" : "inside" })}><Footprints size={14} />{st.view === "inside" ? "Inside" : "Outside"}</button>
        {([["N", [0, 0.12, -1]], ["S", [0, 0.12, 1]], ["E", [1, 0.12, 0]], ["W", [-1, 0.12, 0]], ["Top", [0, 1, 0.001]], ["Bottom", [0, -1, 0.001]]] as const).map(([n, dir]) => (
          <button key={n} className="sky-btn" onClick={() => st.cam("view", [...dir] as [number, number, number])}>{n}</button>
        ))}
        <button className="sky-btn" onClick={() => st.cam("reset")} aria-label="Reset camera"><RotateCcw size={14} /></button>
        <select value={st.quality} onChange={(e) => st.set({ quality: e.target.value as never })} aria-label="Quality">
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
        <button className="sky-btn" aria-label="Fullscreen" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}><Maximize size={14} /></button>
        <button className="sky-btn" aria-label="Screenshot" onClick={screenshot}><Camera size={14} /></button>
        <button className="sky-btn" aria-label="Share link" onClick={share}><Share2 size={14} /></button>
      </div>
    </footer>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="sky-modal" onClick={onClose}>
      <div className="glass help" onClick={(e) => e.stopPropagation()}>
        <button className="sky-icon close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <h2>How to read the sphere</h2>
        <ul>
          <li><b>Frame:</b> +X East, −X West, +Y Zenith, −Y Nadir, −Z North, +Z South. Compass labels are fixed to the horizon.</li>
          <li>The celestial north pole sits φ° above the northern horizon (latitude φ).</li>
          <li>The ecliptic is tilted to the equator by the epoch's obliquity (≈23.44°). The Sun marker moves on it with the date — this is its <i>apparent</i> annual path, not a physical orbit around Earth.</li>
          <li>The camera orbit is decoration only; astronomy changes come from the date/time sliders.</li>
          <li>Hidden hemisphere arcs and labels are occluded in standard outside view. Enable X-Ray hemisphere in the sidebar for faint back-side arcs.</li>
          <li>The human, Sun and Moon sizes are schematic exaggerations. Positions are computed with astronomy-engine.</li>
          <li>Terms marked <em>under review</em> await verification against the primary Arabic text.</li>
          <li>Drag freely in all directions to orbit (including north-to-south), scroll or pinch to zoom. Use the N / S / E / W presets to orient the camera. Panning is disabled to keep the sphere centered.</li>
        </ul>
      </div>
    </div>
  );
}
