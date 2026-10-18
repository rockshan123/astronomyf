import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

// Use the official TanStack Start fetch handler on Vercel / Nitro.
// Preserves the app's existing routes and src/start.ts request middleware.
export default createServerEntry({
  fetch(request, opts) {
    return handler.fetch(request, opts);
  },
});
