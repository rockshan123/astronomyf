import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Sizes are deliberately schematic. Astronomical directions are taken from
 * computeSky; radial offsets only keep the visual objects clear of the shell.
 * Sphere radius = 1. Sun clearance = 1.16 - .084 - 1 = .076.
 * Moon clearance = 1.14 - .054 - 1 = .086.
 */
const SUN_RADIUS = 0.084;
const MOON_RADIUS = 0.054;

function rand3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function noise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const n = (a: number, b: number, c: number) => rand3(ix + a, iy + b, iz + c);
  return lerp(
    lerp(lerp(n(0,0,0), n(1,0,0),u), lerp(n(0,1,0),n(1,1,0),u),v),
    lerp(lerp(n(0,0,1), n(1,0,1),u), lerp(n(0,1,1),n(1,1,1),u),v),w);
}
function fbm(x: number, y: number, z: number, octaves = 4): number {
  let total = 0, amp = 0.5, scale = 1, sum = 0;
  for (let i = 0; i < octaves; i++) {
    total += noise(x * scale, y * scale, z * scale) * amp;
    sum += amp;
    scale *= 2.03; amp *= 0.5;
  }
  return total / sum;
}
function clamp255(v: number) { return Math.max(0, Math.min(255, Math.round(v))); }

function makeTexture(data: Uint8Array, width: number, height: number, color: boolean) {
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

/** Seamless spherical 3D noise: no flat disc or horizontal image seam. */
function buildSunMap(): THREE.DataTexture {
  const width = 768, height = 384;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const phi = Math.PI * (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const theta = 2 * Math.PI * (x + 0.5) / width;
      const X = Math.sin(phi) * Math.cos(theta), Y = Math.cos(phi), Z = Math.sin(phi) * Math.sin(theta);
      const large = fbm(X * 6.4, Y * 6.4, Z * 6.4);
      const fine = fbm(X * 37.0, Y * 37.0, Z * 37.0, 3);
      const streak = Math.abs(Math.sin((large * 7.2 + fine * 2.8) * Math.PI));
      const heat = Math.max(0, Math.min(1, large * 0.67 + fine * 0.24 + streak * 0.18));
      const i = (y * width + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = clamp255(30 + Math.pow(heat, 1.5) * 237);
      pixels[i + 2] = clamp255(2 + Math.pow(Math.max(0, heat - 0.42) * 2, 1.6) * 68);
      pixels[i + 3] = 255;
    }
  }
  return makeTexture(pixels, width, height, true);
}

/** A shaded, cratered greyscale lunar globe with an optional bump map. */
function buildMoonMaps(): { color: THREE.DataTexture; bump: THREE.DataTexture } {
  const width = 768, height = 384;
  const color = new Uint8Array(width * height * 4);
  const bump = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const phi = Math.PI * (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const theta = 2 * Math.PI * (x + 0.5) / width;
      const X = Math.sin(phi) * Math.cos(theta), Y = Math.cos(phi), Z = Math.sin(phi) * Math.sin(theta);
      const broad = fbm(X * 3.1, Y * 3.1, Z * 3.1, 3);
      const fine = fbm(X * 35, Y * 35, Z * 35, 3);
      const maria = Math.max(0, Math.min(1, (broad - 0.40) * 4));
      const brightness = clamp255(100 + maria * 84 + fine * 49);
      const i = (y * width + x) * 4;
      color.set([brightness, brightness, clamp255(brightness * 1.015), 255], i);
      const h = clamp255(fine * 190 + broad * 60);
      bump.set([h, h, h, 255], i);
    }
  }
  // Deterministically add crisp circular craters and raised rims with seam wrap.
  let seed = 9817;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let crater = 0; crater < 570; crater++) {
    const cx = Math.floor(random() * width);
    const cy = Math.floor((0.08 + random() * 0.84) * height);
    const radius = 2 + Math.pow(random(), 2.2) * 22;
    const span = Math.ceil(radius * 1.55);
    for (let dy = -span; dy <= span; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -span; dx <= span; dx++) {
        const d = Math.hypot(dx, dy) / radius;
        if (d >= 1.35) continue;
        const xx = ((cx + dx) % width + width) % width;
        const i = (yy * width + xx) * 4;
        const pit = d < 0.8 ? -19 * (1 - d / 0.8) : 0;
        const rim = Math.exp(-Math.pow((d - 0.91) * 11, 2)) * 24;
        const change = pit + rim;
        for (let ch = 0; ch < 3; ch++) {
          color[i + ch] = clamp255(color[i + ch] + change * 0.8);
          bump[i + ch] = clamp255(bump[i + ch] + change * 2.4);
        }
      }
    }
  }
  return { color: makeTexture(color, width, height, true), bump: makeTexture(bump, width, height, false) };
}

function makeGlow() {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot((x + 0.5 - size / 2) / (size / 2), (y + 0.5 - size / 2) / (size / 2));
    const a = Math.pow(Math.max(0, 1 - d), 2.5) * 90;
    const i = (y * size + x) * 4;
    pixels.set([255, 105, 6, clamp255(a)], i);
  }
  return makeTexture(pixels, size, size, true);
}

/** Apparent annual Sun position is supplied by the ecliptic computation. */
export function FloatingSun({ direction }: { direction: THREE.Vector3 }) {
  const surface = useRef<THREE.Mesh>(null);
  const map = useMemo(buildSunMap, []);
  const glow = useMemo(makeGlow, []);
  const pos = useMemo(() => direction.clone().normalize().multiplyScalar(1.16), [direction]);
  useEffect(() => () => { map.dispose(); glow.dispose(); }, [map, glow]);
  useFrame((_, dt) => { if (surface.current) surface.current.rotation.y += Math.min(dt, 0.1) * 0.045; });
  return (
    <group position={pos}>
      <sprite scale={[SUN_RADIUS * 4.8, SUN_RADIUS * 4.8, 1]}>
        <spriteMaterial map={glow} transparent blending={THREE.AdditiveBlending}
          depthWrite={false} toneMapped={false} />
      </sprite>
      <mesh ref={surface}>
        <sphereGeometry args={[SUN_RADIUS, 64, 48]} />
        <meshBasicMaterial map={map} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Moon direction is independent of the Sun's ecliptic longitude. */
export function FloatingMoon({ direction }: { direction: THREE.Vector3 }) {
  const textures = useMemo(buildMoonMaps, []);
  const pos = useMemo(() => direction.clone().normalize().multiplyScalar(1.14), [direction]);
  useEffect(() => () => { textures.color.dispose(); textures.bump.dispose(); }, [textures]);
  return (
    <mesh position={pos}>
      <sphereGeometry args={[MOON_RADIUS, 64, 48]} />
      <meshStandardMaterial map={textures.color} bumpMap={textures.bump}
        bumpScale={0.008} metalness={0} roughness={0.95} />
    </mesh>
  );
}
