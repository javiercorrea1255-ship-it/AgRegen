// The shell builder lives in `server/ssr/shell.ts`. This file is kept as a
// thin re-export to preserve the existing import path used by the SEO
// middleware and any tests.
export { renderSeoHtml, buildShellHtml } from "../ssr/shell";
export type { SeoRenderInput, ShellArgs } from "../ssr/shell";
