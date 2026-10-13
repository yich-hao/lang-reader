import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  realpath,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative as relativePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isStudyDocument } from "../src/study/model.js";
import { APP_CONFIG_PATHS, MANIFEST_FILE_NAME, SUPPORTED_FILE_RE, stableLocalSourceKey } from "../src/core/config.js";
import { normalizeRuntimeConfig } from "../src/app/runtimeConfig.js";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const options = parseArguments(process.argv.slice(2));
const DATA_ROOT = resolve(PROJECT_ROOT, options.dataDir);
const MAX_BYTES = 1024 * 1024;
const writes = new Map();
let sampleRefreshPromise = null;
let lastSampleRefresh = 0;
let runtimeConfig = normalizeRuntimeConfig({});
for (const configPath of APP_CONFIG_PATHS) {
  try {
    runtimeConfig = normalizeRuntimeConfig(JSON.parse(await readFile(join(PROJECT_ROOT, configPath), "utf8")));
    break;
  } catch {
    // Try the public example next.
  }
}

if (runtimeConfig.study.localPersistence) await mkdir(DATA_ROOT, { recursive: true });
await refreshLocalSamples();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (options.allowLan && options.token && url.searchParams.get("studyToken") === options.token) {
      response.setHeader("Set-Cookie", `lang-reader-local=${encodeURIComponent(options.token)}; HttpOnly; SameSite=Strict; Path=/`);
    }
    if (url.pathname.startsWith("/api/study") && !runtimeConfig.study.localPersistence) {
      return sendJson(response, 404, { error: "Local Study persistence is disabled" });
    }
    if (url.pathname === "/api/study/capabilities") {
      return sendJson(response, 200, {
        studyPersistence: true,
        maxBytes: MAX_BYTES,
        lanWrites: options.allowLan
      });
    }
    if (url.pathname === "/api/study") {
      if (request.method === "GET") return await readStudy(request, response, url);
      if (request.method === "PUT") return await writeStudy(request, response, url);
      return sendJson(response, 405, { error: "Method not allowed" });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { error: "Method not allowed" });
    }
    return await serveStatic(request, response, url);
  } catch (error) {
    if (!error.statusCode) console.error(error);
    return sendJson(response, error.statusCode || 500, {
      error: error.statusCode ? error.message : "Internal server error"
    });
  }
});

server.listen(options.port, options.host, () => {
  console.log(`Lang Reader local server: http://${displayHost(options.host)}:${options.port}`);
  console.log(`Study data: ${DATA_ROOT}`);
});

async function readStudy(request, response, url) {
  if (!canReadPrivate(request, url)) return sendJson(response, 403, { error: "Forbidden" });
  const paths = resolveStudyPaths(url.searchParams.get("source"));
  const current = await readExistingStudy(paths);
  if (!current) return sendJson(response, 404, { error: "Study progress not found" });
  response.setHeader("ETag", current.etag);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(current.content);
}

async function writeStudy(request, response, url) {
  if (!canWrite(request)) return sendJson(response, 403, { error: "Study writes are not allowed" });
  if (!hasSameOrigin(request)) return sendJson(response, 403, { error: "Cross-origin write rejected" });
  const paths = resolveStudyPaths(url.searchParams.get("source"));
  const body = await readRequestBody(request, MAX_BYTES);
  let document;
  try {
    document = JSON.parse(body);
  } catch {
    return sendJson(response, 400, { error: "Invalid JSON" });
  }
  if (!isStudyDocument(document)) return sendJson(response, 400, { error: "Invalid Study document" });
  if (document.source !== paths.source) {
    return sendJson(response, 400, { error: "Document source does not match URL source" });
  }

  return queueWrite(paths.primary, async () => {
    const current = await readExistingStudy(paths);
    const expected = request.headers["if-match"];
    if (current && expected && expected !== current.etag) {
      response.setHeader("ETag", current.etag);
      return sendJson(response, 412, { error: "Study progress changed" });
    }
    if (current && !expected) {
      response.setHeader("ETag", current.etag);
      return sendJson(response, 409, { error: "If-Match is required for existing progress" });
    }

    const content = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
    await mkdir(resolve(paths.primary, ".."), { recursive: true });
    const temporaryPath = `${paths.primary}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, content, { flag: "wx" });
      await rename(temporaryPath, paths.primary);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
    const etag = getEtag(content);
    response.setHeader("ETag", etag);
    return sendJson(response, 200, { saved: true });
  });
}

async function serveStatic(request, response, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(response, 400, { error: "Invalid path" });
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (isProtectedStaticPath(relative)) return sendJson(response, 403, { error: "Forbidden" });
  const parts = relative.split("/");
  const linkedSample = relative.startsWith("local-default/content/imported/");
  if (linkedSample && !/\.(md|txt|csv|tsv)$/i.test(relative) && !relative.endsWith("/manifest.json")) {
    return sendJson(response, 403, { error: "Forbidden" });
  }
  const publicPath = ["index.html", "README.md", "LICENSE"].includes(relative)
    || ["src", "styles", "docs", "previews"].includes(parts[0])
    || ["config/app.config.json", "config/app.config.example.json"].includes(relative)
    || linkedSample;
  const configuredContent = !publicPath && canReadPrivate(request, url) && await isConfiguredContentPath(relative);
  if (!publicPath && !configuredContent) return sendJson(response, 403, { error: "Forbidden" });
  if ((linkedSample || configuredContent || relative === "config/app.config.json") && !canReadPrivate(request, url)) {
    return sendJson(response, 403, { error: "Forbidden" });
  }
  if (relative === "local-default/content/imported/manifest.json") {
    await refreshLocalSamples();
  }
  const filePath = resolve(PROJECT_ROOT, relative);
  if (!isInside(PROJECT_ROOT, filePath)) return sendJson(response, 403, { error: "Forbidden" });
  try {
    const info = await stat(filePath);
    const target = info.isDirectory() ? join(filePath, "index.html") : filePath;
    const targetInfo = info.isDirectory() ? await stat(target) : info;
    const realRoot = await realpath(PROJECT_ROOT);
    const realTarget = await realpath(target);
    if (!targetInfo.isFile() || (!linkedSample && (!isInside(realRoot, realTarget)
      || isProtectedStaticPath(relativePath(realRoot, realTarget))))) {
      return sendJson(response, 403, { error: "Forbidden" });
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", getContentType(target));
    response.setHeader("Content-Length", targetInfo.size);
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "HEAD") return response.end();
    createReadStream(target).on("error", error => response.destroy(error)).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") return sendJson(response, 404, { error: "Not found" });
    throw error;
  }
}

function isProtectedStaticPath(path) {
  const normalizedPath = path.replace(/\\/g, "/").toLowerCase();
  const parts = normalizedPath.split("/");
  return parts.some(part => part.startsWith("."))
    || ["internal", "node_modules", "tests", "demo"].includes(parts[0])
    || ["package.json", "package-lock.json", "agents.md"].includes(normalizedPath)
    || normalizedPath === "local-default/study-data" || normalizedPath.startsWith("local-default/study-data/")
    || isInside(DATA_ROOT.toLowerCase(), resolve(PROJECT_ROOT, path).toLowerCase());
}

function configuredContentPath(value) {
  try {
    const raw = typeof value === "string" ? value : value?.path;
    if (typeof raw !== "string" || !raw.trim()) return "";
    const url = new URL(raw, "http://local.invalid/");
    if (url.origin !== "http://local.invalid") return "";
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "/";
    return path && !isProtectedStaticPath(path) ? path : "";
  } catch { return ""; }
}

async function isConfiguredContentPath(path) {
  const sources = [...runtimeConfig.defaultSources, ...runtimeConfig.otherSources, ...runtimeConfig.documentSources];
  for (const source of sources) {
    const configured = configuredContentPath(source);
    if (!configured) continue;
    if (SUPPORTED_FILE_RE.test(configured) && path === configured) return true;
    const directory = configured.endsWith("/");
    const prefix = configured === "/" ? "" : configured;
    const manifest = directory ? `${prefix}${MANIFEST_FILE_NAME}` : /\.json$/i.test(configured) ? configured : "";
    if (!manifest) continue;
    if (path === manifest || directory && path.startsWith(prefix) && SUPPORTED_FILE_RE.test(path)) return true;
    if (!SUPPORTED_FILE_RE.test(path)) continue;
    try {
      const root = await realpath(PROJECT_ROOT);
      const target = await realpath(resolve(PROJECT_ROOT, manifest));
      if (!isInside(root, target) || isProtectedStaticPath(relativePath(root, target))) continue;
      const content = JSON.parse(await readFile(target, "utf8"));
      if (Array.isArray(content.files) && content.files.some(file => configuredContentPath(file) === path)) return true;
    } catch { /* Missing manifests do not grant access. */ }
  }
  return false;
}

function resolveStudyPaths(source) {
  const value = String(source || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = value.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || part.includes(":"))) {
    const error = new Error("Invalid Study source path");
    error.statusCode = 400;
    throw error;
  }
  const sourcePath = stableLocalSourceKey(parts.join("/"));
  const extension = extname(sourcePath);
  const legacySource = extension ? sourcePath.slice(0, -extension.length) : sourcePath;
  const primary = resolve(DATA_ROOT, `${sourcePath}.study.json`);
  const legacy = resolve(DATA_ROOT, `${legacySource}.study.json`);
  if (!isInside(DATA_ROOT, primary) || !isInside(DATA_ROOT, legacy)) {
    const error = new Error("Study path escapes data directory");
    error.statusCode = 400;
    throw error;
  }
  return { source: sourcePath, primary, legacy };
}

function canWrite(request) {
  const remote = request.socket.remoteAddress || "";
  const localRequest = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (localRequest) return true;
  if (!options.allowLan || !options.token) return false;
  return request.headers["x-study-token"] === options.token;
}

function hasSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function canReadPrivate(request, url) {
  if (canWrite(request)) return true;
  const cookie = String(request.headers.cookie || "").split(";").map(value => value.trim())
    .find(value => value.startsWith("lang-reader-local="))?.slice("lang-reader-local=".length);
  return Boolean(options.allowLan && options.token
    && (cookie === encodeURIComponent(options.token) || url.searchParams.get("studyToken") === options.token));
}

async function readRequestBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readExistingStudy(paths) {
  for (const filePath of new Set([paths.primary, paths.legacy])) {
    try {
      const content = await readFile(filePath);
      const document = JSON.parse(content);
      if (!isStudyDocument(document) || document.source !== paths.source) continue;
      return { content, etag: getEtag(content), filePath };
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return null;
}

function queueWrite(filePath, operation) {
  const previous = writes.get(filePath) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  writes.set(filePath, next);
  const cleanup = () => {
    if (writes.get(filePath) === next) writes.delete(filePath);
  };
  next.then(cleanup, cleanup);
  return next;
}

async function refreshLocalSamples() {
  const now = Date.now();
  if (sampleRefreshPromise) return sampleRefreshPromise;
  if (now - lastSampleRefresh < 750) return;
  sampleRefreshPromise = execFileAsync(
    process.execPath,
    [resolve(PROJECT_ROOT, "local-runtime/build-local-samples.js")],
    { cwd: PROJECT_ROOT }
  )
    .catch((error) => {
      console.warn("Local sample refresh failed:", error.message);
    })
    .finally(() => {
      lastSampleRefresh = Date.now();
      sampleRefreshPromise = null;
    });
  return sampleRefreshPromise;
}

function getEtag(content) {
  return `"${createHash("sha256").update(content).digest("hex")}"`;
}

function sendJson(response, statusCode, value) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(`${JSON.stringify(value)}\n`);
}

function isInside(root, value) {
  const normalizedRoot = `${normalize(root)}${sep}`;
  const normalizedValue = normalize(value);
  return normalizedValue === normalize(root) || normalizedValue.startsWith(normalizedRoot);
}

function getContentType(filePath) {
  return {
    ".css": "text/css; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml",
    ".tsv": "text/tab-separated-values; charset=utf-8",
    ".txt": "text/plain; charset=utf-8"
  }[extname(filePath).toLowerCase()] || "application/octet-stream";
}

function parseArguments(args) {
  const result = {
    host: "127.0.0.1",
    port: 5173,
    dataDir: "local-default/study-data",
    allowLan: false,
    token: process.env.LANG_READER_STUDY_TOKEN || ""
  };
  args.forEach((argument, index) => {
    if (argument === "--host") result.host = args[index + 1] || result.host;
    if (argument === "--port") result.port = Number(args[index + 1]) || result.port;
    if (argument === "--data-dir") result.dataDir = args[index + 1] || result.dataDir;
    if (argument === "--allow-lan") result.allowLan = true;
  });
  return result;
}

function displayHost(host) {
  return host === "0.0.0.0" ? "localhost" : host;
}
