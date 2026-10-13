import { SAMPLE_TEXT } from "../core/sampleText.js";
import { requestText } from "./sourceCatalog.js";

export function createDocumentLoader({
  getDraft, getProtocol, buildSourceUrls, commitSource, onLoading, onFailure,
  readText = requestText, warn = (...args) => window.console.warn(...args), now = Date.now
}) {
  let generation = 0;

  function invalidate() {
    generation += 1;
    return generation;
  }

  async function loadSourcePath(sourcePath, { sourceMode } = {}) {
    const loadId = invalidate();
    if (typeof sourcePath === "string" && sourcePath.startsWith("draft:")) {
      const draft = getDraft(sourcePath.substring(6));
      if (!draft) return false;
      commitSource({ key: sourcePath, name: draft.name, text: draft.content, draft: true, ...(sourceMode ? { sourceMode } : {}) });
      return true;
    }
    const name = sourcePath.substring(sourcePath.lastIndexOf("/") + 1);
    if (getProtocol() === "file:") {
      commitSource({ key: sourcePath, name, text: SAMPLE_TEXT, ...(sourceMode ? { sourceMode } : {}) });
      return true;
    }
    onLoading();
    const urls = buildSourceUrls(sourcePath);
    let lastError = "";
    try {
      for (const url of urls) {
        url.searchParams.set("t", String(now()));
        try {
          const text = await readText(url.href);
          if (loadId !== generation) return false;
          commitSource({ key: sourcePath, name, text, ...(sourceMode ? { sourceMode } : {}) });
          return true;
        } catch (error) {
          lastError = `${url.pathname}: ${error.message || error}`;
        }
      }
      if (loadId !== generation) return false;
      onFailure("actionFailed", lastError);
      if (lastError) warn("Failed to load document:", lastError);
      return false;
    } catch (error) {
      if (loadId !== generation) return false;
      onFailure("loadFailed", error.message || "");
      return false;
    }
  }

  async function loadFileObject(file, sourceKey = "", displayName = "", { sourceMode } = {}) {
    const loadId = invalidate();
    try {
      const text = await file.text();
      if (loadId !== generation) return false;
      commitSource({
        key: sourceKey || `local-file:${file.name}:${file.size}:${file.lastModified}`,
        editKey: sourceKey, name: displayName || file.name, text, file: true, ...(sourceMode ? { sourceMode } : {})
      });
      return true;
    } catch (error) {
      if (loadId !== generation) return false;
      onFailure("loadFailed", error.message || "");
      return false;
    }
  }

  return { loadSourcePath, loadFileObject, invalidate };
}
