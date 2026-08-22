import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Strip `crossorigin` from the tags Vite emits for our OWN bundle.
 *
 * Vite marks the emitted <script type="module"> and <link rel="stylesheet">
 * with `crossorigin`, which puts them in CORS mode. That is correct when your
 * assets sit on a separate CDN host. Ours do not — they are served from
 * app.truhq.co, the same origin as the page — so it buys nothing and costs
 * this:
 *
 *   Cloudflare caches ONE copy of each asset, and the response carries no
 *   `Vary: Origin`. A plain request (no Origin header) gets a response with no
 *   `Access-Control-Allow-Origin`, and that copy can be stored and then handed
 *   to the browser's CORS-mode request. The check fails, and a stylesheet that
 *   returned a perfectly good 200 is discarded in full.
 *
 * The symptom is the whole app rendering as unstyled black-on-white text after
 * a deploy. It looks like a broken build; it is a cache variant. Seen twice on
 * production, and confirmed each time by the sheet loading 200 while
 * `cssRules` threw SecurityError.
 *
 * Same-origin subresources need no CORS mode, so the attribute simply goes.
 */
function sameOriginAssets(): Plugin {
  return {
    name: 'tru-same-origin-assets',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(?:=(?:"[^"]*"|'[^']*'|\S+))?/g, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), sameOriginAssets()],
  // allow importing the shared flag logic from ../shared
  server: { fs: { allow: ['..'] } },
});
