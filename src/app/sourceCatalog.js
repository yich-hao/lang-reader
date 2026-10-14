import { DEFAULT_APP_CONFIG, DEFAULT_DOCUMENT_PATH, MANIFEST_FILE_NAME, SUPPORTED_FILE_RE, migrateDocumentPath } from "../core/config.js";

export async function getSamplesWithManifest(config, environment) {
  const samples = [];
  const sources = [...(config.defaultSources || []), ...(config.otherSources || [])];
  if (config.local?.enabled === true) sources.push("local-default/content/imported/manifest.json");
  const seenSources = new Set();
  for (const source of sources) {
    if (config.local?.enabled !== true && normalizeSampleSource(source).path === "local-default/content/imported/manifest.json") continue;
    const path = normalizeSampleSource(source).path;
    if (seenSources.has(path)) continue;
    seenSources.add(path);
    const sourceSamples = await resolveSampleSource(source, environment);
    samples.push(...sourceSamples);
  }
  return dedupeSamples(samples);
}

export async function getDocumentsWithManifest(config, environment) {
  const documents = [];
  const sources = config.documentSources || DEFAULT_APP_CONFIG.documentSources;
  for (const source of sources) {
    const sourceDocuments = await resolveSampleSource(source, environment);
    documents.push(...sourceDocuments.map((documentEntry) => ({
      ...documentEntry,
      label: documentLabelFromPath(documentEntry.path, documentEntry.label)
    })));
  }
  const deduped = dedupeSamples(documents);
  deduped.sort((a, b) => documentSortScore(a.path) - documentSortScore(b.path) || a.label.localeCompare(b.label));
  return deduped;
}

async function resolveSampleSource(source, environment) {
  const entry = normalizeSampleSource(source);
  if (!entry.path) return [];
  if (entry.path.endsWith("/")) return readSampleManifest(`${entry.path}${MANIFEST_FILE_NAME}`, environment);
  if (/\.json$/i.test(entry.path)) return readSampleManifest(entry.path, environment);
  if (SUPPORTED_FILE_RE.test(entry.path)) return filterAvailableFiles([{
    label: entry.label || sampleLabelFromPath(entry.path),
    path: entry.path
  }], environment);
  return [];
}

function normalizeSampleSource(source) {
  if (typeof source === "string") return { path: migrateDocumentPath(source.trim()) };
  if (!source || typeof source !== "object") return { path: "" };
  return {
    label: typeof source.label === "string" ? source.label.trim() : "",
    path: typeof source.path === "string" ? migrateDocumentPath(source.path.trim()) : ""
  };
}

async function readSampleManifest(path, {
  baseUrl = window.location.href, fetchImpl = fetch, now = Date.now,
  warn = (...args) => window.console.warn(...args), onFailure
} = {}) {
  try {
    const manifestUrl = new URL(path, baseUrl);
    manifestUrl.searchParams.set("t", String(now()));
    const response = await fetchImpl(manifestUrl.href, { cache: "no-store" });
    if (!response.ok) {
      onFailure?.({ path, reason: `HTTP ${response.status}` });
      return [];
    }
    const manifest = await response.json();
    for (const warning of manifest.warnings || []) if (typeof warning?.path === "string") onFailure?.(warning);
    const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
    return filterAvailableFiles(manifestFiles.map((file) => normalizeManifestFile(file)).filter(Boolean), { baseUrl, fetchImpl, onFailure });
  } catch (error) {
    warn(`Sample manifest is unavailable: ${path}`, error);
    onFailure?.({ path, reason: error.message });
    return [];
  }
}

async function filterAvailableFiles(files, { baseUrl = window.location.href, fetchImpl = fetch, onFailure } = {}) {
  if (!onFailure) return files;
  const available = await Promise.all(files.map(async file => {
    try {
      const response = await fetchImpl(new URL(file.path, baseUrl).href, { method: "HEAD", cache: "no-store" });
      if (response.ok) return file;
      // Some static servers only support GET.
      if ([405, 501].includes(response.status)) {
        const fallback = await fetchImpl(new URL(file.path, baseUrl).href, { cache: "no-store" });
        if (fallback.ok) return file;
      }
      onFailure({ path: file.path, reason: `HTTP ${response.status}` });
    } catch (error) {
      onFailure({ path: file.path, reason: error.message });
    }
    return null;
  }));
  return available.filter(Boolean);
}

function normalizeManifestFile(file) {
  if (typeof file === "string" && SUPPORTED_FILE_RE.test(file)) {
    return { label: sampleLabelFromPath(file), path: migrateDocumentPath(file) };
  }
  if (!file || typeof file !== "object" || !SUPPORTED_FILE_RE.test(file.path || "")) return null;
  return {
    label: file.label || sampleLabelFromPath(file.path),
    path: migrateDocumentPath(file.path)
  };
}

export function sampleLabelFromPath(path) {
  return String(path || "").replace(/^\.\//, "");
}

export function documentLabelFromPath(path, label = "") {
  if (label) return label;
  const cleanPath = String(path || "")
    .replace(/^\.\//, "")
    .replace(/^docs\/templates\//, "")
    .replace(/\.(md|txt|tsv|csv)$/i, "");
  const baseName = cleanPath.split("/").pop() || cleanPath;
  return baseName.replace(/[-\s]+/g, "_");
}

function documentSortScore(path) {
  const fixedOrder = [DEFAULT_DOCUMENT_PATH, "docs/templates/reader-template.md",
    "docs/templates/vocabulary-template.md", "docs/templates/reformat-notes.md"];
  const index = fixedOrder.indexOf(String(path).replace(/^\.\//, ""));
  return index < 0 ? fixedOrder.length : index;
}

function dedupeSamples(samples) {
  const seen = new Set();
  return samples.filter((sample) => {
    if (seen.has(sample.path)) return false;
    seen.add(sample.path);
    return true;
  });
}

export async function requestText(url, {
  fetchImpl = window.fetch ? fetch : null,
  createRequest = () => new XMLHttpRequest()
} = {}) {
  if (fetchImpl) {
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }
  return new Promise((resolve, reject) => {
    const request = createRequest();
    request.open("GET", url, true);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve(request.responseText);
      else reject(new Error(`HTTP ${request.status}`));
    };
    request.onerror = () => reject(new Error("Network error"));
    request.send();
  });
}
