# Tashrihul Aflak 3D — developer notes

- Production is hosted by Vercel with code stored in GitHub.
- Framework: TanStack Start + React + Three.js + Nitro.
- Preserve astronomical math in `src/lib/astronomy` and all 30 reference diagrams in `public/references`.
- The observer coordinate frame is fixed: +X East, +Y Zenith, -Z North.
- Develop on a feature branch, pass build/tests, then merge through a PR. Never force push `main`.
- Configure environment variables in Vercel, never commit secrets.
