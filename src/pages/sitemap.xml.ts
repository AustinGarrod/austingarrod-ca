import { projects } from "@data/profile";
import { getAbsoluteUrl, getProjectPath, pageLastModified } from "@data/seo";

const pages = ["/", "/about/", "/projects/", "/contact/", ...projects.map(getProjectPath)];

export function GET() {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map(
      (path) =>
        `  <url><loc>${getAbsoluteUrl(path)}</loc><lastmod>${pageLastModified[path]}</lastmod><changefreq>monthly</changefreq></url>`
    )
    .join("\n")}\n</urlset>\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8"
    }
  });
}
