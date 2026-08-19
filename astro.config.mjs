import { defineConfig } from "astro/config";
import { handleGeocodeRequest } from "./src/utilities/radius-map/lib/geocode.ts";

function radiusMapGeocodeDevProxy() {
  return {
    name: "radius-map-geocode-dev-proxy",
    configureServer(server) {
      server.middlewares.use(async (incoming, outgoing, next) => {
        const requestUrl = new URL(incoming.url ?? "/", "http://localhost:4321");
        if (requestUrl.pathname !== "/utilities/radius-map/api/geocode.php") {
          next();
          return;
        }

        try {
          const response = await handleGeocodeRequest(
            new Request(requestUrl, {
              headers: {
                "accept-language": String(incoming.headers["accept-language"] ?? "en"),
              },
            }),
            {},
          );
          outgoing.statusCode = response.status;
          response.headers.forEach((value, key) => outgoing.setHeader(key, value));
          outgoing.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          server.config.logger.error(String(error));
          outgoing.statusCode = 500;
          outgoing.setHeader("content-type", "application/json; charset=utf-8");
          outgoing.end(JSON.stringify({ error: "Location search is temporarily unavailable." }));
        }
      });
    },
  };
}

export default defineConfig({
  site: "https://austingarrod.ca",
  output: "static",
  vite: {
    plugins: [radiusMapGeocodeDevProxy()]
  }
});
