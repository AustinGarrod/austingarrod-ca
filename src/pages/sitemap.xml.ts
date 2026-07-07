const site = "https://austingarrod.ca";
const pages = ["/", "/about/", "/projects/", "/contact/"];

export function GET() {
  const updated = new Date().toISOString();
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map(
      (path) =>
        `  <url><loc>${site}${path}</loc><lastmod>${updated}</lastmod><changefreq>monthly</changefreq></url>`
    )
    .join("\n")}\n</urlset>\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8"
    }
  });
}
