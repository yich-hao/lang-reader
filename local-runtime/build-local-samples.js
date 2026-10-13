import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { APP_CONFIG_PATHS } from "../src/core/config.js";

const root = "local-default/content/imported";
const supportedFileRe = /\.(md|txt|tsv|csv)$/i;
const projectRoot = process.cwd();
const outputRoot = resolve(projectRoot, root);

const local = (await readLocalConfig())?.local || {};
const sources = local.enabled === true ? [...normalizeList(local.defaultSources), ...normalizeList(local.otherSources)] : [];
const excludes = normalizeList(local.exclude).map((entry) => createExcludeMatcher(entry));
const warnings = [];
const report = (path, error) => warnings.push({ path, reason: error.code || "UNAVAILABLE" });

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await linkSourceDocs();
const files = await collectFiles(outputRoot);
const manifest = {
  files: files
    .filter((path) => supportedFileRe.test(path))
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      label: path.replace(/^local-default\/content\/imported\//, ""),
      path
    })),
  warnings
};

await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Linked ${manifest.files.length} local source files in ${root}`);

async function readLocalConfig() {
  for (const path of APP_CONFIG_PATHS) {
    try {
      return JSON.parse(await readFile(resolve(projectRoot, path), "utf8"));
    } catch {
      // Try the next config path.
    }
  }
  return {};
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry || "").trim()).filter(Boolean) : [];
}

async function linkSourceDocs() {
  for (const source of sources) {
    const sourcePath = resolveSourcePath(source);
    if (isExcluded(sourcePath) || isInsideOutput(sourcePath)) continue;
    let sourceStat;
    try {
      sourceStat = await stat(sourcePath);
    } catch (error) {
      report(source, error);
      continue;
    }

    if (sourceStat.isDirectory()) {
      const files = await collectSourceFiles(sourcePath);
      for (const file of files) {
        const targetPath = join(outputRoot, sourceLabel(sourcePath), normalizePath(relative(sourcePath, file)));
        await linkSourceFile(file, targetPath);
      }
      continue;
    }

    if (sourceStat.isFile() && supportedFileRe.test(sourcePath)) {
      const targetPath = join(outputRoot, basename(sourcePath));
      await linkSourceFile(sourcePath, targetPath);
    }
  }
}

async function linkSourceFile(sourcePath, targetPath) {
  try {
    await mkdir(dirname(targetPath), { recursive: true });
    await rm(targetPath, { force: true });
    await symlink(sourcePath, targetPath, "file");
  } catch (error) {
    report(sourcePath, error);
  }
}

async function collectSourceFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    report(dir, error);
    return [];
  }
  const results = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (isExcluded(fullPath) || isInsideOutput(fullPath)) continue;
    if (entry.isDirectory()) {
      results.push(...await collectSourceFiles(fullPath));
    } else if (entry.isFile() && supportedFileRe.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.name === "manifest.json") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectFiles(fullPath));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      results.push(normalizePath(relative(projectRoot, fullPath)));
    }
  }
  return results;
}

function resolveSourcePath(path) {
  const expanded = expandHome(path);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(projectRoot, expanded);
}

function expandHome(path) {
  return String(path || "").replace(/^~\/+/, `${homedir()}/`);
}

function isExcluded(path) {
  return excludes.some((matcher) => matcher(path));
}

function createExcludeMatcher(pattern) {
  const isDirectory = /\/$/.test(String(pattern || ""));
  const source = normalizePath(resolveSourcePath(pattern));
  if (source.includes("*")) {
    const regex = new RegExp(`^${source.split("*").map(escapeRegExp).join(".*")}$`);
    return (path) => regex.test(normalizePath(path));
  }
  return (path) => {
    const normalized = normalizePath(path);
    return isDirectory ? normalized === source || normalized.startsWith(`${source}/`) : normalized === source;
  };
}

function isInsideOutput(path) {
  const relativePath = relative(outputRoot, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function sourceLabel(path) {
  return sanitizeSegment(basename(path.replace(/\/$/, "")) || "source");
}

function sanitizeSegment(value) {
  return String(value).replace(/[^\p{L}\p{N}._-]+/gu, "_");
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

function escapeRegExp(value) {
  return String(value).replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
