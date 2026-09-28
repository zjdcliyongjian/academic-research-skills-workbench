import { createServer } from "node:http";
import { handleCloudRequest } from "./handler.mjs";

const host = process.env.CLOUD_API_HOST || "127.0.0.1";
const port = Number(process.env.CLOUD_API_PORT || 4317);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  if (!url.pathname.startsWith("/api")) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "接口不存在" }));
    return;
  }

  // Vercel rewrites `/api/:path*` to `/api?path=:path*`. Mirror that
  // contract locally so the same cloud handler serves both environments.
  const path = url.pathname.replace(/^\/api\/?/, "");
  req.query = { ...(req.query || {}), path };
  await handleCloudRequest(req, res);
});

server.listen(port, host, () => {
  console.log(`Cloud API listening on http://${host}:${port}/api`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
