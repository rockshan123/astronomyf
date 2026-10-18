import * as THREE from "three";
import type { SkyState } from "./sky";
import {
  greatCircle, smallCircle, slerpArc, planeNormal, projectToPlane, angleDeg, fmt,
  EAST, WEST, ZENITH, NORTH, risingAmplitude, hourAngleToLocal, DEG, V,
} from "./math";

export interface LayerGeom {
  lines: THREE.Vector3[][];
  /** faint supporting reference circle for arc layers */
  reference?: THREE.Vector3[] | undefined;
  label?: THREE.Vector3 | undefined;
  measure?: string | undefined;
  note?: string;
}

function splitByHorizon(pts: THREE.Vector3[], above: boolean) {
  const out: THREE.Vector3[][] = [];
  let cur: THREE.Vector3[] = [];
  for (const p of pts) {
    if ((p.y >= 0) === above) cur.push(p);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  // merge wrap-around
  if (out.length > 1 && pts[0]!.y >= 0 === above && pts[pts.length - 1]!.y >= 0 === above) {
    const last = out.pop()!; out[0] = [...last, ...out[0]!];
  }
  return out.filter((s) => s.length > 1);
}

export function buildLayer(id: string, s: SkyState): LayerGeom {
  const { P, K, T, sun, Q } = s;
  switch (id) {
    case "01_equator": return { lines: [greatCircle(P)], label: Q.clone().addScaledVector(EAST, 0.46).normalize(), measure: "δ = 0°" };
    case "02_ecliptic": return { lines: [greatCircle(K)], label: s.eclToLocal(45), measure: `ε = ${fmt(s.eps)}` };
    case "03_four_poles": return { lines: [greatCircle(planeNormal(P, K))], label: P.clone().add(K).normalize(), measure: `P–K = ${fmt(angleDeg(P, K))}` };
    case "04_declination": return { lines: [greatCircle(planeNormal(P, T))], label: T.clone(), measure: "through P & target" };
    case "05_latitude": return { lines: [greatCircle(planeNormal(K, T))], label: K.clone().add(T).normalize(), measure: "through K & target" };
    case "06_horizon": return { lines: [greatCircle(ZENITH)], label: V(0.7, 0, 0.7).normalize(), measure: "altitude 0°" };
    case "07_meridian": return { lines: [greatCircle(EAST)], label: V(0, 0.7, -0.7).normalize() };
    case "08_first_vertical": return { lines: [greatCircle(NORTH)], label: V(0.7, 0.7, 0).normalize() };
    case "10_altitude": return { lines: [greatCircle(planeNormal(ZENITH, T))], label: T.clone(), measure: `target alt ${fmt(Math.asin(T.y) / DEG)}` };
    case "11_daily_circles": {
      const decs = [-45, -20, 20, 45];
      const td = Math.asin(T.dot(P));
      return { lines: [...decs.map((d) => smallCircle(P, Math.sin(d * DEG))), smallCircle(P, Math.sin(td))], label: T.clone(), measure: `target δ ${fmt(td / DEG)}` };
    }
    case "12_latitude_circles":
      return { lines: [-40, -15, 15, 40].map((b) => smallCircle(K, Math.sin(b * DEG))), label: s.eclToLocal(120, 15) };
    case "13_almucantars":
      return { lines: [15, 30, 45, 60].map((a) => smallCircle(ZENITH, Math.sin(a * DEG))), label: V(0, Math.sin(30 * DEG), Math.cos(30 * DEG)), measure: "15° 30° 45° 60°" };
    case "14_obliquity": {
      const sol = s.eclToLocal(90);
      const foot = projectToPlane(sol, P);
      return { lines: [slerpArc(foot, sol)], reference: greatCircle(P), label: sol, measure: `ε = ${fmt(angleDeg(foot, sol))}` };
    }
    case "15_first_declination": {
      const foot = projectToPlane(sun, P);
      return { lines: [slerpArc(sun, foot)], reference: greatCircle(planeNormal(P, sun)), label: sun.clone().add(foot).normalize(), measure: `δ☉ = ${fmt(s.sunDec)}` };
    }
    case "16_second_declination": {
      const n = planeNormal(K, sun);
      // intersection of latitude circle with equator nearest the Sun
      let x = new THREE.Vector3().crossVectors(n, P).normalize();
      if (x.dot(sun) < 0) x.negate();
      return { lines: [slerpArc(sun, x)], reference: greatCircle(n), label: sun.clone().add(x).normalize(), measure: fmt(angleDeg(sun, x)) };
    }
    case "17_star_declination": {
      const foot = projectToPlane(T, P);
      return { lines: [slerpArc(T, foot)], reference: greatCircle(planeNormal(P, T)), label: T.clone().add(foot).normalize(), measure: `δ = ${fmt(Math.asin(T.dot(P)) / DEG)}` };
    }
    case "18_star_latitude": {
      const foot = projectToPlane(T, K);
      return { lines: [slerpArc(T, foot)], reference: greatCircle(planeNormal(K, T)), label: T.clone().add(foot).normalize(), measure: `β = ${fmt(s.tEcl.lat)}` };
    }
    case "19_geographic_latitude": {
      const pole = s.lat >= 0 ? P : s.S;
      const hz = projectToPlane(pole, ZENITH);
      return { lines: [slerpArc(ZENITH, Q), slerpArc(hz, pole)], reference: greatCircle(EAST), label: ZENITH.clone().add(Q).normalize(), measure: `φ = ${fmt(Math.abs(s.lat))}` };
    }
    case "20_geographic_longitude": {
      const g = hourAngleToLocal(s.lon, 0, s.lat); // Greenwich meridian on the equator
      const pts = [] as THREE.Vector3[];
      const n = 48;
      for (let i = 0; i <= n; i++) pts.push(hourAngleToLocal((s.lon * i) / n, 0, s.lat));
      return { lines: [pts], reference: greatCircle(P), label: g, measure: `λ = ${fmt(s.lon)} (${(s.lon / 15).toFixed(2)} h)`, note: "Schematic" };
    }
    case "21_rising_amplitude":
    case "22_setting_amplitude": {
      const A = risingAmplitude(s.sunDec, s.lat);
      if (A === null) return { lines: [], note: "Sun does not rise/set at this latitude today", measure: "—" };
      const rising = id === "21_rising_amplitude";
      const p = V(rising ? Math.cos(A * DEG) : -Math.cos(A * DEG), 0, -Math.sin(A * DEG));
      const base = rising ? EAST : WEST;
      return { lines: [slerpArc(base, p)], reference: greatCircle(ZENITH), label: p, measure: `${fmt(Math.abs(A))} ${A >= 0 ? "N" : "S"} of ${rising ? "E" : "W"}` };
    }
    case "23_altitude_arc":
    case "24_depression_arc": {
      const foot = projectToPlane(sun, ZENITH);
      const alt = Math.asin(sun.y) / DEG;
      const ok = id === "23_altitude_arc" ? alt > 0 : alt < 0;
      if (!ok) return { lines: [], reference: greatCircle(planeNormal(ZENITH, sun)), note: id === "23_altitude_arc" ? "Sun is below the horizon now" : "Sun is above the horizon now", measure: `Sun alt ${fmt(alt)}` };
      return { lines: [slerpArc(foot, sun)], reference: greatCircle(planeNormal(ZENITH, sun)), label: sun.clone().add(foot).normalize(), measure: fmt(Math.abs(alt)) };
    }
    case "25_azimuth_arc": {
      const foot = projectToPlane(sun, ZENITH);
      const base = foot.x >= 0 ? EAST : WEST;
      return { lines: [slerpArc(base, foot)], reference: greatCircle(ZENITH), label: foot, measure: `${fmt(angleDeg(base, foot))} from ${foot.x >= 0 ? "E" : "W"} toward ${foot.z < 0 ? "N" : "S"}` };
    }
    case "26_day_arc":
    case "27_night_arc": {
      const circ = smallCircle(P, Math.sin(s.sunDec * DEG), 240);
      const above = id === "26_day_arc";
      const segs = splitByHorizon(circ, above);
      const total = circ.slice(1).filter((p) => (p.y >= 0) === above).length;
      const deg = (total / 240) * 360;
      return { lines: segs, reference: circ, label: segs[0]?.[Math.floor(segs[0].length / 2)], measure: `${fmt(deg)} ≈ ${(deg / 15).toFixed(2)} h` };
    }
    default:
      return { lines: [], note: "Source definition under review" };
  }
}
