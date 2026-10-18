# Tashrihul Aflak 3D — Interactive Celestial Sphere

Interactive classical astronomy observatory using React, TanStack Start, React Three Fiber, Three.js and `astronomy-engine`.

## Repository & deployment

Source code: GitHub `rockshan123/astronomyf`  
Hosting: Vercel project `astronomyf` (team `english-567b`).  
Framework: TanStack Start, built with Nitro's official Vite plugin.

This project does not require the Lovable editor, Vite wrapper, or Lovable runtime telemetry.

## Local development

Use **Node.js 22 LTS** and **npm**. The migration consolidates dependency installation on npm and generates `package-lock.json`.

```bash
npm ci
npm run dev
```

## Validation before merge

```bash
npm run typecheck
npm run test
npm run build
```

Create a Pull Request, inspect the Vercel Preview Deployment, and only then merge into `main`.

## Astronomy source preservation

- `src/lib/astronomy/` contains astronomical coordinate calculations.
- `src/components/sky/` contains the 3D interactive scene.
- `src/data/layers.ts` contains the defined circles and arcs.
- `public/references/` contains 30 reference illustrations.

The Sun moves on the *apparent* ecliptic in this Earth-centered teaching visualization. It is not a physical geocentric model.

## Migration note

After the production deployment is verified, disconnect GitHub sync **in Lovable's project settings**. Removing `.lovable/` in Git alone does not disconnect the external integration.
