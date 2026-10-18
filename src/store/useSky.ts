import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LAYERS } from "@/data/layers";

export type Lang = "ml" | "ar" | "en";
export type Quality = "low" | "medium" | "high";
export const TOGGLES = {
  human: "Human observer", shell: "Sphere shell", graticule: "Alt-az graticule", poles: "Celestial poles",
  eclPoles: "Ecliptic poles", cardinals: "N / S / E / W", zenith: "Zenith / Nadir", sun: "Sun",
  dailySun: "Daily Sun path", moon: "Moon", target: "Target star", stars: "Star field",
  axes: "Coordinate axes", labels: "Labels", sight: "Line of sight", markers: "Equinoxes / solstices",
} as const;
export type ToggleKey = keyof typeof TOGGLES;

interface State {
  visible: Record<string, boolean>;
  custom: Record<string, boolean>;
  opacity: Record<string, number>;
  toggles: Record<ToggleKey, boolean>;
  selected: string | null;
  hovered: string | null;
  lat: number; lon: number;
  simTime: number; timePlaying: boolean; timeMult: number;
  autoOrbit: boolean; orbitSpeed: number;
  quality: Quality; lang: Lang; view: "outside" | "inside";
  sidebarOpen: boolean; touring: boolean; xray: boolean;
  camCmd: { kind: "reset" | "focus" | "view"; dir?: [number, number, number] | undefined; n: number } | null;
  set: (p: Partial<State>) => void;
  toggleLayer: (id: string) => void;
  setMany: (ids: string[], v: boolean) => void;
  solo: (id: string) => void;
  cam: (kind: "reset" | "focus" | "view", dir?: [number, number, number]) => void;
}

const allOn = Object.fromEntries(LAYERS.map((l) => [l.id, ["01_equator", "02_ecliptic", "06_horizon", "07_meridian"].includes(l.id)]));

export const useSky = create<State>()(
  persist(
    (set, get) => ({
      visible: allOn, custom: allOn,
      opacity: Object.fromEntries(LAYERS.map((l) => [l.id, 1])),
      toggles: { human: true, shell: true, graticule: false, poles: true, eclPoles: true, cardinals: true, zenith: true, sun: true, dailySun: false, moon: true, target: true, stars: true, axes: false, labels: true, sight: false, markers: true },
      selected: null, hovered: null,
      lat: 0, lon: 75.8,
      simTime: Date.now(), timePlaying: false, timeMult: 1,
      autoOrbit: true, orbitSpeed: 0.4,
      quality: "medium", lang: "en", view: "outside",
      sidebarOpen: true, touring: false, xray: false, camCmd: null,
      set: (p) => set(p),
      toggleLayer: (id) => {
        const visible = { ...get().visible, [id]: !get().visible[id] };
        set({ visible, custom: visible });
      },
      setMany: (ids, v) => {
        const visible = { ...get().visible };
        ids.forEach((i) => (visible[i] = v));
        set({ visible, custom: visible });
      },
      solo: (id) => set({ visible: Object.fromEntries(LAYERS.map((l) => [l.id, l.id === id])), selected: id }),
      cam: (kind, dir) => set({ camCmd: { kind, dir, n: (get().camCmd?.n ?? 0) + 1 } }),
    }),
    {
      name: "tashrihul-aflak-3d",
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2 && persisted && typeof persisted === "object") {
          return { ...(persisted as Partial<State>), lat: 0 } as State;
        }
        return persisted as State;
      },
      partialize: (s) => ({ visible: s.visible, custom: s.custom, opacity: s.opacity, toggles: s.toggles, lat: s.lat, lon: s.lon, autoOrbit: s.autoOrbit, orbitSpeed: s.orbitSpeed, quality: s.quality, lang: s.lang, xray: s.xray }),
    },
  ),
);
