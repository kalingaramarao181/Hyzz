import { loadConfig } from "./config.js";
import { createProvider } from "./lib/provider.js";
import { createApp } from "./app.js";
const config = loadConfig();
const app = createApp({ config, provider: createProvider(config) });
const server = app.listen(config.PORT, config.HOST, () =>
  console.log(
    JSON.stringify({
      event: "api_started",
      host: config.HOST,
      port: config.PORT,
      publicUrl: config.PUBLIC_API_URL,
    }),
  ),
);
server.requestTimeout = 30000;
server.headersTimeout = 15000;
for (const event of ["SIGINT", "SIGTERM"])
  process.on(event, () => server.close(() => process.exit(0)));
