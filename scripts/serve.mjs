// 개발용 정적 서버 — node scripts/serve.mjs (http://localhost:8788)
import http from "http";
import fs from "fs";
import path from "path";
import { ROOT } from "./fda-common.mjs";

const PUB = path.join(ROOT, "public");
const TYPES = { ".html":"text/html; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8" };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(PUB, path.normalize(p).replace(/^[\/]+/, ""));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("404");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(8788, () => console.error("http://localhost:8788"));
