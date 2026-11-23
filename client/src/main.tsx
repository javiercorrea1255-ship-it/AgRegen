import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "leaflet/dist/leaflet.css";
import { registerServiceWorker } from "./lib/register-sw";

// Defense-in-depth cleanup for legacy SEO shell elements. The current SSR
// pipeline (see `server/ssr/shell.ts`) no longer injects ANY visible SEO body
// in hybrid React routes (only head metadata + JSON-LD). These removals exist
// to handle stale HTML still in the wild from older deploys / service worker
// caches that could otherwise leak "ghost" English content behind the React
// tree on first paint.
document.getElementById("seo-shell-wrapper")?.remove();
document.getElementById("seo-shell-style")?.remove();

const rootEl = document.getElementById("root")!;
// Belt-and-suspenders: clear any unexpected children before React 18's
// createRoot mounts. createRoot does NOT auto-clear pre-existing DOM, so any
// leftover server-rendered content would otherwise persist underneath the
// React tree. REMOVE this line if migrating to `hydrateRoot()`.
rootEl.replaceChildren();
createRoot(rootEl).render(<App />);

registerServiceWorker();
