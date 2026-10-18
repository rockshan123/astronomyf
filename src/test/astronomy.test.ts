import { describe, it, expect } from "vitest";
import { computeSky } from "@/lib/astronomy/sky";
import { localFrame, localToAltAz, angleDeg, risingAmplitude, eclipticToRaDec, raDecToEcliptic, hourAngleToLocal, ZENITH, NADIR } from "@/lib/astronomy/math";
import { buildLayer } from "@/lib/astronomy/layerGeometry";
import { LAYERS } from "@/data/layers";

const date = new Date("2026-06-21T12:00:00Z");

describe("observer frame", () => {
  it("pole altitude equals latitude, toward north", () => {
    for (const lat of [0, 11, 45, -30]) {
      const { P } = localFrame(lat);
      expect(localToAltAz(P).alt).toBeCloseTo(lat, 6);
      if (lat > 0) expect(P.z).toBeLessThan(0);
    }
  });
  it("equator passes through zenith and nadir at latitude zero", () => {
    const s = computeSky(date, 0, 75.8);
    expect(Math.abs(s.P.dot(ZENITH))).toBeLessThan(1e-9);
    expect(Math.abs(s.P.dot(NADIR))).toBeLessThan(1e-9);
    const offEquator = computeSky(date, 11, 75.8);
    expect(Math.abs(offEquator.P.dot(ZENITH))).toBeGreaterThan(0.18);
    expect(Math.abs(s.sun.dot(s.K))).toBeLessThan(1e-6);
    expect(buildLayer("01_equator", s).lines.length).toBeGreaterThan(0);
  });
  it("east point is hour angle -90°", () => {
    const v = hourAngleToLocal(-90, 0, 30);
    expect(v.x).toBeCloseTo(1, 6);
  });
});

describe("ecliptic", () => {
  it("is inclined ~23.44° to the equator", () => {
    const s = computeSky(date, 45, 0);
    expect(angleDeg(s.P, s.K)).toBeGreaterThan(23.4);
    expect(angleDeg(s.P, s.K)).toBeLessThan(23.46);
  });
  it("sun lies on the ecliptic", () => {
    const s = computeSky(date, 11, 75);
    expect(Math.abs(s.sun.dot(s.K))).toBeLessThan(1e-6);
    expect(s.sunDec).toBeGreaterThan(23.3); // June solstice
  });
  it("ecliptic <-> equatorial round trip", () => {
    const { ra, dec } = eclipticToRaDec(123, 4, 23.44);
    const e = raDecToEcliptic(ra, dec, 23.44);
    expect(e.lon).toBeCloseTo(123, 6);
    expect(e.lat).toBeCloseTo(4, 6);
  });
});

describe("arcs", () => {
  it("rising amplitude is zero at equinox declination", () => {
    expect(risingAmplitude(0, 40)).toBeCloseTo(0, 9);
  });
  it("day + night arcs sum to 360°", () => {
    const s = computeSky(date, 45, 0);
    const parse = (m?: string) => parseFloat(m ?? "0");
    const t = parse(buildLayer("26_day_arc", s).measure) + parse(buildLayer("27_night_arc", s).measure);
    expect(t).toBeCloseTo(360, 0);
  });
  it("every one of the 30 layers builds without throwing", () => {
    const s = computeSky(date, 11, 75);
    expect(LAYERS).toHaveLength(30);
    for (const l of LAYERS) expect(() => buildLayer(l.id, s)).not.toThrow();
  });
});
