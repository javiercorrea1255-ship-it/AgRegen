import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { maybeRenderSeo } from "./seo/middleware";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // index:false → never auto-serve index.html for "/"; force the catch-all
  // below so every public HTML response goes through the SEO renderer.
  app.use(express.static(distPath, { index: false }));

  app.use("/{*path}", async (req, res) => {
    try {
      const indexPath = path.resolve(distPath, "index.html");
      const template = await fs.promises.readFile(indexPath, "utf-8");
      const seo = await maybeRenderSeo(req, template);
      const headers: Record<string, string> = { "Content-Type": "text/html" };
      if (seo?.cacheControl) headers["Cache-Control"] = seo.cacheControl;
      res
        .status(seo?.status ?? 200)
        .set(headers)
        .end(seo ? seo.html : template);
    } catch (err) {
      console.error("[static] error serving index:", err);
      res.sendFile(path.resolve(distPath, "index.html"));
    }
  });
}
