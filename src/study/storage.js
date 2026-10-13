import {
  isStudyDocument,
  mergeStudyProgressDeltas,
  normalizeStudySource
} from "./model.js";

const STORAGE_PREFIX = "lang-reader-study:v1:";
const API_PATH = "./api/study";
const CAPABILITIES_PATH = "./api/study/capabilities";
const TOKEN_KEY = "lang-reader-study-write-token";

export function createStudyRepository({ onStatus = () => {}, debounceMs = 600, isLocalPersistenceEnabled = () => false } = {}) {
  const records = new Map();
  let capabilityPromise = null;
  let lastCapabilityTime = 0;

  async function load(source, { legacySource = "", fileHash = "" } = {}) {
    const normalizedSource = normalizeStudySource(source);
    const existing = records.get(normalizedSource);
    if (existing?.dirty || existing?.syncing) {
      existing.clientDocument = clone(existing.document);
      return clone(existing.document);
    }
    if (existing?.timer) clearTimeout(existing.timer);

    const local = loadLocalRecord(normalizedSource);
    const record = {
      source: normalizedSource,
      document: local?.document || null,
      baseDocument: local ? clone(local.baseDocument) : null,
      etag: local?.etag || "",
      dirty: Boolean(local?.dirty),
      revision: 0,
      timer: 0,
      syncing: false,
      remoteKnown: false,
      replaceProgressRevision: local?.replaceProgress ? 0 : -1
    };
    records.set(normalizedSource, record);
    const loadedDocument = () => {
      if (records.get(normalizedSource) !== record) return clone(records.get(normalizedSource)?.document || null);
      record.clientDocument = clone(record.document);
      return clone(record.document);
    };
    const migrateLegacy = async (remoteEnabled) => {
      if (record.document || !legacySource || !fileHash) return;
      const legacy = normalizeStudySource(legacySource);
      const ownerKey = `${STORAGE_PREFIX}alias:${legacy}`;
      let owner;
      try { owner = localStorage.getItem(ownerKey); } catch { return; }
      if (owner && owner !== normalizedSource) return;
      const localLegacy = loadLocalRecord(legacy);
      let previous = localLegacy?.document;
      if (remoteEnabled) {
        try {
          const oldRemote = await readRemote(legacy);
          if (oldRemote.found) previous = localLegacy?.dirty
            ? mergeStudyProgressDeltas(localLegacy.baseDocument, previous, oldRemote.document, { replaceProgress: localLegacy.replaceProgress === true })
            : oldRemote.document;
        } catch (error) { onStatus({ type: "error", source: legacy, error }); }
      }
      if (records.get(normalizedSource) !== record) return;
      if (previous?.fileHash !== fileHash) return;
      if (!await claimLegacySource(ownerKey, normalizedSource)) return;
      if (records.get(normalizedSource) !== record) return;
      record.document = { ...clone(previous), source: normalizedSource };
      record.baseDocument = clone(record.document);
      record.replaceProgressRevision = localLegacy?.replaceProgress ? record.revision : -1;
      record.etag = "";
      record.dirty = true;
      writeLocalRecord(record);
      scheduleSync(record);
    };

    if (!await hasLocalServer()) {
      await migrateLegacy(false);
      return loadedDocument();
    }
    let remote;
    try {
      remote = await readRemote(normalizedSource);
    } catch (error) {
      if (records.get(normalizedSource) !== record) return loadedDocument();
      record.remoteKnown = false;
      onStatus({ type: "error", source: normalizedSource, error });
      await migrateLegacy(false);
      return loadedDocument();
    }
    if (records.get(normalizedSource) !== record) return loadedDocument();
    record.remoteKnown = true;
    if (!remote.found) {
      await migrateLegacy(true);
      if (record.dirty && record.document) scheduleSync(record);
      return loadedDocument();
    }

    record.etag = remote.etag;
    if (record.dirty && record.document) {
      record.document = mergeStudyProgressDeltas(
        record.baseDocument,
        record.document,
        remote.document,
        { replaceProgress: record.replaceProgressRevision >= 0 }
      );
      record.baseDocument = remote.document;
      writeLocalRecord(record);
      scheduleSync(record);
      return loadedDocument();
    }

    record.document = remote.document;
    record.baseDocument = remote.document;
    record.dirty = false;
    writeLocalRecord(record);
    return loadedDocument();
  }

  function save(source, document, { replaceProgress = false } = {}) {
    if (!isStudyDocument(document)) {
      onStatus({
        type: "error",
        source: normalizeStudySource(source),
        error: new Error("Invalid Study document")
      });
      return false;
    }
    const normalizedSource = normalizeStudySource(source);
    const existing = records.get(normalizedSource);
    const record = existing || {
      source: normalizedSource,
      document: null,
      baseDocument: null,
      etag: "",
      dirty: false,
      revision: 0,
      timer: 0,
      syncing: false,
      remoteKnown: false, replaceProgressRevision: -1
    };
    record.document = record.clientDocument && !replaceProgress
      ? mergeStudyProgressDeltas(record.clientDocument, document, record.document)
      : clone(document);
    record.clientDocument = clone(document);
    record.dirty = true;
    record.revision = (record.revision || 0) + 1;
    if (replaceProgress) record.replaceProgressRevision = record.revision;
    records.set(normalizedSource, record);
    const persistedLocally = writeLocalRecord(record);
    scheduleSync(record);
    return persistedLocally;
  }

  async function syncNow(source) {
    const record = records.get(normalizeStudySource(source));
    if (!record?.dirty || record.syncing || !record.document) return false;
    record.syncing = true;
    if (!await hasLocalServer()) { record.syncing = false; return false; }
    clearTimeout(record.timer);
    record.timer = 0;

    try {
      if (!record.remoteKnown) {
        const remote = await readRemote(record.source);
        if (remote.found) {
          record.document = mergeStudyProgressDeltas(
            record.baseDocument,
            record.document,
            remote.document,
            { replaceProgress: record.replaceProgressRevision >= 0 }
          );
          record.baseDocument = clone(remote.document);
          record.etag = remote.etag;
        } else {
          record.etag = "";
        }
        record.remoteKnown = true;
      }
      const targetRevision = record.revision;
      const pendingBaseDocument = clone(record.document);
      const replaceProgress = record.replaceProgressRevision >= 0;
      let sentDocument = clone(record.document);
      let sentBaseDocument = clone(record.baseDocument);
      let sentEtag = record.etag;
      let response = await writeRemoteWithDoc(record.source, sentDocument, sentEtag);
      if (response?.conflict) {
        const remote = await readRemote(record.source);
        if (!remote.found) throw new Error("Study progress conflict could not be reloaded");
        sentDocument = mergeStudyProgressDeltas(
          sentBaseDocument,
          sentDocument,
          remote.document,
          { replaceProgress }
        );
        sentBaseDocument = clone(remote.document);
        sentEtag = remote.etag;
        response = await writeRemoteWithDoc(record.source, sentDocument, sentEtag);
      }
      if (!response?.ok) throw new Error(response?.message || "Study progress sync failed");
      record.etag = response.etag || record.etag;
      record.baseDocument = clone(sentDocument);
      if (record.revision === targetRevision) {
        record.document = clone(sentDocument);
        record.dirty = false;
      } else {
        record.document = mergeStudyProgressDeltas(pendingBaseDocument, record.document, sentDocument,
          { replaceProgress: record.replaceProgressRevision > targetRevision });
      }
      if (record.replaceProgressRevision <= targetRevision) record.replaceProgressRevision = -1;
      writeLocalRecord(record);
      onStatus({
        type: record.dirty ? "pending" : "synced",
        source: record.source
      });
      return true;
    } catch (error) {
      record.remoteKnown = false;
      record.dirty = true;
      writeLocalRecord(record);
      onStatus({ type: "error", source: record.source, error });
      return false;
    } finally {
      record.syncing = false;
      if (record.dirty) scheduleSync(record);
    }
  }

  async function hasLocalServer() {
    if (isLocalPersistenceEnabled() !== true) return false;
    const now = Date.now();
    if (!capabilityPromise || (now - lastCapabilityTime > 30000)) {
      lastCapabilityTime = now;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      capabilityPromise = fetch(CAPABILITIES_PATH, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal
      })
        .then((response) => {
          clearTimeout(timer);
          return response.ok ? response.json() : null;
        })
        .then((value) => Boolean(value?.studyPersistence))
        .catch(() => {
          clearTimeout(timer);
          capabilityPromise = null;
          return false;
        });
    }
    return capabilityPromise;
  }

  function scheduleSync(record) {
    clearTimeout(record.timer);
    if (isLocalPersistenceEnabled() !== true) return;
    record.timer = window.setTimeout(() => syncNow(record.source), debounceMs);
  }

  function writeLocalRecord(record) {
    try {
      localStorage.setItem(getStorageKey(record.source), JSON.stringify({
        document: record.document,
        baseDocument: record.baseDocument,
        etag: record.etag,
        dirty: record.dirty,
        replaceProgress: record.replaceProgressRevision >= 0
      }));
      return true;
    } catch (error) {
      window.console.warn("Study progress save failed:", error);
      onStatus({ type: "error", source: record.source, error });
      return false;
    }
  }

  return { load, save, syncNow, hasLocalServer };
}

export function exportStudyDocument(document, fileName = "study-progress.study.json") {
  if (!isStudyDocument(document)) return;
  const blob = new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = documentElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function importStudyDocument(file) {
  const value = JSON.parse(await file.text());
  if (!isStudyDocument(value)) throw new Error("Unsupported Study JSON");
  return value;
}

export function getStudyExportName(source) {
  const name = normalizeStudySource(source).split("/").pop() || "study";
  return `${name.replace(/\.(md|txt|csv|tsv)$/i, "")}.study.json`;
}

function loadLocalRecord(source) {
  try {
    const value = JSON.parse(localStorage.getItem(getStorageKey(source)) || "null");
    if (!isStudyDocument(value?.document)) return null;
    return {
      ...value,
      baseDocument: value.baseDocument === null ? null : isStudyDocument(value.baseDocument) ? value.baseDocument : value.document
    };
  } catch {
    return null;
  }
}

async function claimLegacySource(ownerKey, source) {
  const claim = () => {
    const owner = localStorage.getItem(ownerKey);
    if (owner && owner !== source) return false;
    localStorage.setItem(ownerKey, source);
    return true;
  };
  try {
    if (globalThis.navigator?.locks?.request) {
      return await globalThis.navigator.locks.request(ownerKey, claim);
    }
    if (!globalThis.indexedDB) return false;
    // Read-write transactions serialize claims across insecure-origin tabs too.
    return await new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      const opening = indexedDB.open("lang-reader-study-aliases", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("owners");
      opening.onerror = opening.onblocked = () => finish(false);
      opening.onsuccess = () => {
        const database = opening.result;
        if (settled) { database.close(); return; }
        let allowed = false;
        try {
          const transaction = database.transaction("owners", "readwrite");
          const store = transaction.objectStore("owners");
          const request = store.get(ownerKey);
          request.onsuccess = () => {
            try {
              const owner = localStorage.getItem(ownerKey);
              if (owner && owner !== source || request.result && request.result !== source) return;
              store.put(source, ownerKey);
              allowed = true;
            } catch { transaction.abort(); }
          };
          transaction.oncomplete = () => {
            database.close();
            try { finish(allowed && claim()); } catch { finish(false); }
          };
          transaction.onerror = transaction.onabort = () => { database.close(); finish(false); };
        } catch { database.close(); finish(false); }
      };
    });
  } catch { return false; }
}

async function readRemote(source) {
  const url = new URL(API_PATH, window.location.href);
  url.searchParams.set("source", source);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  let response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 404) return { found: false };
  if (!response.ok) throw new Error(`Study progress read failed: HTTP ${response.status}`);
  const document = await response.json();
  if (!isStudyDocument(document)) throw new Error("Invalid Study JSON from local server");
  return { found: true, document, etag: response.headers.get("ETag") || "" };
}

async function writeRemoteWithDoc(source, document, etag = "") {
  const url = new URL(API_PATH, window.location.href);
  url.searchParams.set("source", source);
  const headers = { "Content-Type": "application/json" };
  if (etag) headers["If-Match"] = etag;
  const token = getWriteToken();
  if (token) headers["X-Study-Token"] = token;
  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(document)
  });
  if (response.status === 409 || response.status === 412) return { conflict: true };
  if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
  return { ok: true, etag: response.headers.get("ETag") || "" };
}

function getWriteToken() {
  try {
    const url = new URL(window.location.href);
    const queryToken = url.searchParams.get("studyToken");
    if (queryToken) {
      sessionStorage.setItem(TOKEN_KEY, queryToken);
      url.searchParams.delete("studyToken");
      window.history.replaceState(null, "", url);
      return queryToken;
    }
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function getStorageKey(source) {
  return `${STORAGE_PREFIX}${encodeURIComponent(source)}`;
}

function documentElement(tagName) {
  return window.document.createElement(tagName);
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
