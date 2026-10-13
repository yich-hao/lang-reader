import { documentActionState, exportFileName } from "../files/documentActions.js";
import { DEFAULT_DOCUMENT_PATH, inferParseModeFromName, inferParagraphSplitFromName } from "../core/config.js";
import { sampleLabelFromPath, documentLabelFromPath } from "./sourceCatalog.js";
import { uploadEntries, droppedEntries } from "../files/fileImports.js";
import { setEditorActionButton } from "../ui/editorActions.js";

export function createDocumentController({ state, document, window, navigator, elements, t, saveSettings, stopPlayback, parseAndShow, initTranslateWidget, setSidePanelTab, isMobileSettings, setSettingsSheetState, syncParseModeToggle, updateParagraphOptionsVisibility, syncStudyAvailability, setStatus, updateTranslateLink, syncTranslationButtons, filesPanel, studyController, documentLoader, loadSourcePath, loadFileObject, importedFiles, originalSourceTexts, sourceEdits, exportedFiles, unsavedSourceKeys, currentSourceChanged, isFileUnexported, hasUnsavedSources, saveSourceInputSettings }) {
  let recentSourceKeys = Array.isArray(state.saved?.recentSourceKeys)
    ? state.saved.recentSourceKeys.filter(key => typeof key === "string" && key).slice(0, 20)
    : [];
  let openRequestId = 0;

  function rememberOpenedSource(previousKey, key = state.activeSourceKey) {
    recentSourceKeys = [...new Set([key, previousKey, ...recentSourceKeys].filter(Boolean))].slice(0, 20);
    state.saved ||= {};
    state.saved.recentSourceKeys = recentSourceKeys;
  }

  function initializeDrafts() {
    if (state.userDrafts && typeof state.userDrafts === "object") {
      Object.keys(state.userDrafts).forEach((id) => {
        const draft = state.userDrafts[id];
        if (!draft || typeof draft.name !== "string" || typeof draft.content !== "string") {
          delete state.userDrafts[id];
          unsavedSourceKeys.delete(`draft:${id}`);
          return;
        }
        if (draft.unsaved !== false) {
          draft.unsaved = true;
          unsavedSourceKeys.add(`draft:${id}`);
        }
      });
    }
  }

  function syncSourceContext() {
    state.lastDocumentPath = getValidDocumentPath(state.lastDocumentPath);
    initTranslateWidget();
  }

  function rememberCurrentSourceSelection() {
    if (state.sourceMode === "document") {
      state.lastDocumentPath = getValidDocumentPath(state.activeSourceKey || state.lastDocumentPath);
    } else if (state.activeSourceKey) {
      state.lastImportSourceKey = state.activeSourceKey;
    }
  }

  async function autoLoadSample() {
    const requestId = ++openRequestId;
    const cached = {
      text: state.saved?.sourceText,
      key: state.saved?.activeSourceKey || state.saved?.documentPath || "",
      name: state.saved?.activeFileName || "",
      mode: state.sourceMode
    };
    const restorableImport = state.sourceMode === "import"
      ? getRestorableImportSource(state.lastImportSourceKey)
      : "";
    const candidates = [
      ...(restorableImport ? [{ path: restorableImport, mode: "import" }] : []),
      ...[...new Set([getValidDocumentPath(state.lastDocumentPath), ...state.documentOptions.map(option => option.path)])]
        .filter(path => state.documentOptions.some(option => option.path === path))
        .map(path => ({ path, mode: "document" })),
      ...state.sampleOptions.map(option => ({ path: option.path, mode: "import" }))
    ];
    let loaded = false;
    const attempted = new Set();
    for (const candidate of candidates) {
      if (attempted.has(candidate.path)) continue;
      attempted.add(candidate.path);
      loaded = await loadSourcePath(candidate.path, { sourceMode: candidate.mode });
      if (requestId !== openRequestId) return;
      if (loaded) {
        state.sourceMode = candidate.mode;
        syncSourceContext();
      }
      if (loaded) break;
    }
    if (!loaded && typeof cached.text === "string" && cached.text.trim()) {
      elements.sourceInput.value = cached.text;
      state.activeSourceKey = cached.key || "untitled.md";
      state.activeFileName = cached.name || state.activeSourceKey.split("/").pop();
      state.sourceMode = cached.key ? cached.mode : "import";
      if (state.sourceMode === "document") state.lastDocumentPath = state.activeSourceKey;
      else state.lastImportSourceKey = state.activeSourceKey;
      loaded = true;
    } else if (!loaded) {
      // Do not mislabel the embedded example as a successfully loaded guide.
      elements.sourceInput.value = "";
      state.activeSourceKey = "";
      state.activeFileName = "";
      state.sourceMode = "import";
      state.lastImportSourceKey = "";
      setStatus(t("empty"));
    }
    if (loaded && elements.sourceInput.value.trim()) parseAndShow(false);
    else if (loaded) setStatus(t("empty"));
    if (loaded) {
      rememberOpenedSource("");
      saveSettings();
    }
    renderFilesPanel();
  }

  async function loadDocument(force) {
    if (!force && elements.sourceInput.value.trim()) return true;
    const documentPath = getValidDocumentPath(state.lastDocumentPath);
    return loadSourcePath(documentPath);
  }

  function getFileDisplayPath(file) {
    return file.webkitRelativePath || file.name;
  }

  function registerImportedFile(file, key, name, metadata = {}, render = true) {
    importedFiles.set(key, { ...metadata, file, key, name: name || file.name, kind: "imported" });
    if (render) renderFilesPanel();
  }

  function addUploadedEntries(entries) {
    if (!entries.length) return;
    entries.forEach(entry => registerImportedFile(entry.file, entry.key, entry.name, entry, false));
    renderFilesPanel();
    for (const [kind, fromFolder] of [["uploaded-files", false], ["uploaded-folders", true]]) {
      const keys = entries.filter(entry => entry.fromFolder === fromFolder).map(entry => entry.key);
      if (keys.length) filesPanel.expandGroup(kind, keys);
    }
  }

  function getRestorableImportSource(sourceKey = state.lastImportSourceKey) {
    if (sourceKey.startsWith("draft:")) {
      const id = sourceKey.slice("draft:".length);
      if (state.userDrafts[id]) return sourceKey;
    }
    if (state.sampleOptions.some((option) => option.path === sourceKey)) return sourceKey;
    if (importedFiles.has(sourceKey)) return sourceKey;
    return "";
  }

  function getImportEntry(sourceKey) {
    if (!sourceKey) return null;
    if (sourceKey.startsWith("draft:")) {
      const draft = state.userDrafts[sourceKey.slice("draft:".length)];
      return draft ? { key: sourceKey, name: draft.name, kind: "draft" } : null;
    }
    const configured = state.sampleOptions.find((option) => option.path === sourceKey);
    if (configured) {
      return {
        key: configured.path,
        name: configured.label || sampleLabelFromPath(configured.path),
        kind: "configured"
      };
    }
    const imported = importedFiles.get(sourceKey);
    return imported ? { key: sourceKey, name: imported.name, kind: "imported" } : null;
  }

  function renderFilesPanel() {
    const drafts = Object.entries(state.userDrafts).map(([id, draft]) => ({
      key: `draft:${id}`,
      name: draft.name,
      kind: "draft",
      modified: isFileUnexported(`draft:${id}`),
      deletable: true
    }));
    const configured = state.sampleOptions.map((option) => ({
      key: option.path,
      name: option.label || sampleLabelFromPath(option.path),
      kind: "configured",
      modified: isFileUnexported(option.path),
      deletable: false
    }));
    const imported = [...importedFiles.values()].map(({ key, name, file, treePath, fromFolder }) => ({
      key,
      name,
      treePath: treePath || file.webkitRelativePath || file.name,
      fromFolder: fromFolder ?? Boolean(file.webkitRelativePath),
      kind: "imported",
      modified: isFileUnexported(key),
      deletable: true
    }));
    filesPanel.render({
      selectedKey: state.activeSourceKey,
      groups: [
        { kind: "documents", label: t("document"), entries: state.documentOptions.map(option => ({ key: option.path, name: option.label || documentLabelFromPath(option.path), kind: "document", deletable: false })) },
        { kind: "drafts", label: t("drafts"), entries: drafts },
        { kind: "uploaded-files", label: t("uploadedFiles"), entries: imported.filter(entry => !entry.fromFolder) },
        { kind: "uploaded-folders", label: t("uploadedFolders"), entries: imported.filter(entry => entry.fromFolder) },
        { kind: "configured", label: t("configuredFiles"), entries: configured }
      ].filter(group => group.kind !== "configured" || group.entries.length > 0),
      labels: {
        deleteFile: t("deleteFile"),
        clearGroup: (kind) => t(kind === "drafts" ? "clearDrafts" : kind === "uploaded-files" ? "clearUploadedFiles" : "clearUploadedFolders"),
        groupInteraction: t("fileGroupInteraction"),
        newDraft: t("newFile"),
        uploadFiles: t("importFileAction"),
        uploadFolders: t("importFolderAction"),
        collapseAll: t("collapseAllFiles"),
        expandAll: t("expandAllFiles"),
        fileCount: (count) => t("fileCount", count)
      }
    });
  }

  async function openFileEntry(entry) {
    if (!entry?.key) return false;
    const requestId = ++openRequestId;
    const previousKey = state.activeSourceKey;
    const provisionalId = getActiveDraftId();
    const discardProvisional = entry.key !== previousKey && provisionalId
      && state.userDrafts[provisionalId].provisional && !elements.sourceInput.value.trim();
    saveSettings();
    stopPlayback();
    let loaded;
    if (entry.kind === "document") {
      rememberCurrentSourceSelection();
      loaded = await loadSourcePath(entry.key, { sourceMode: "document" });
    } else if (entry.kind === "imported") {
      const imported = importedFiles.get(entry.key);
      loaded = imported && await loadFileObject(imported.file, entry.key, imported.name, { sourceMode: "import" });
    } else {
      loaded = await loadSourcePath(entry.key, { sourceMode: "import" });
    }
    if (requestId !== openRequestId) return false;
    if (!loaded) {
      renderFilesPanel();
      return false;
    }
    state.sourceMode = entry.kind === "document" ? "document" : "import";
    if (entry.kind === "document") state.lastDocumentPath = entry.key;
    else state.lastImportSourceKey = entry.key;
    if (discardProvisional) {
      delete state.userDrafts[provisionalId];
      unsavedSourceKeys.delete(previousKey);
    }
    syncSourceContext();
    rememberOpenedSource(previousKey);
    saveSettings();
    applyParseModeFromName(entry.kind === "document" ? entry.key : entry.name || getActiveFileName());
    parseAndShow(false);
    renderFilesPanel();
    updateTitleDisplay();
    return true;
  }

  function getActiveDraftId() {
    if (!state.activeSourceKey.startsWith("draft:")) return "";
    const id = state.activeSourceKey.slice("draft:".length);
    return state.userDrafts[id] ? id : "";
  }

  function stripMarkdownExtension(name) {
    return String(name || "").replace(/\.md$/i, "");
  }

  function normalizeDraftName(value) {
    const base = String(value || "").trim().replace(/\.[^.]+$/, "") || "untitled";
    return `${base}.md`;
  }

  function getUniqueDraftName(preferredName) {
    const normalized = normalizeDraftName(preferredName);
    const existing = new Set(Object.values(state.userDrafts).map((draft) => draft.name.toLowerCase()));
    if (!existing.has(normalized.toLowerCase())) return normalized;
    const base = stripMarkdownExtension(normalized);
    let index = 1;
    let candidate = `${base}_${index}.md`;
    while (existing.has(candidate.toLowerCase())) {
      index += 1;
      candidate = `${base}_${index}.md`;
    }
    return candidate;
  }

  function createBrowserDraft({ name, content = "", parse = false }) {
    openRequestId++;
    documentLoader.invalidate();
    const currentId = getActiveDraftId();
    if (!String(content).trim() && currentId && state.userDrafts[currentId].provisional && !elements.sourceInput.value.trim()) {
      showEditor();
      setSidePanelTab("files", { expand: !isMobileSettings() });
      filesPanel.reveal(state.activeSourceKey);
      elements.sourceInput.focus();
      return state.activeSourceKey;
    }
    const returnSource = { key: state.activeSourceKey, kind: currentDocumentKind() };
    saveSettings();
    const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const draftName = getUniqueDraftName(name);
    state.userDrafts[id] = { name: draftName, content: String(content), unsaved: true, provisional: !String(content).trim(), returnSource };
    state.activeFileName = draftName;
    state.activeSourceKey = `draft:${id}`;
    rememberOpenedSource(returnSource.key);
    state.lastImportSourceKey = state.activeSourceKey;
    unsavedSourceKeys.add(state.activeSourceKey);
    state.sourceMode = "import";
    elements.sourceInput.value = String(content);
    syncSourceContext();
    saveSettings();
    renderFilesPanel();
    if (parse && elements.sourceInput.value.trim()) parseAndShow(true);
    else {
      showEditor();
      elements.sourceInput.focus();
      elements.sourceInput.setSelectionRange(0, 0);
    }
    setSidePanelTab("files", { expand: !isMobileSettings() });
    filesPanel.reveal(state.activeSourceKey);
    if (isMobileSettings()) setSettingsSheetState("collapsed");
    triggerTitlePulse();
    return state.activeSourceKey;
  }

  async function discardEmptyDraft() {
    const id = getActiveDraftId();
    if (!id || elements.sourceInput.value.trim()) return false;
    const previous = state.userDrafts[id].returnSource;
    const key = state.activeSourceKey;
    delete state.userDrafts[id];
    unsavedSourceKeys.delete(key);
    exportedFiles.delete(key);
    state.activeSourceKey = "";
    state.activeFileName = "";
    state.lastImportSourceKey = "";
    const entry = previous?.kind === "document"
      ? state.documentOptions.find(option => option.path === previous.key) && previous
      : getImportEntry(previous?.key);
    if (!entry || !await openFileEntry(entry)) await openFilesFallback();
    saveSettings();
    renderFilesPanel();
    return true;
  }

  function duplicateActiveFile() {
    closeDocumentMenu();
    saveSettings();
    stopPlayback();
    const currentName = stripMarkdownExtension(getActiveFileName()) || "untitled";
    createBrowserDraft({
      name: getUniqueDraftName(`${currentName}_copy.md`),
      content: elements.sourceInput.value,
      parse: false
    });
  }

  function currentDocumentKind() {
    return state.sourceMode === "document" ? "document" : (getImportEntry(state.activeSourceKey)?.kind || "configured");
  }

  function closeDocumentMenu(focus = false) {
    const wasOpen = elements.documentMoreButton.getAttribute("aria-expanded") === "true";
    if (elements.documentMoreMenu.hidePopover && elements.documentMoreMenu.matches(":popover-open")) elements.documentMoreMenu.hidePopover();
    elements.documentMoreMenu.classList.remove("is-open");
    elements.documentMoreMenu.hidden = true;
    elements.documentMoreButton.setAttribute("aria-expanded", "false");
    if (focus && wasOpen) elements.documentMoreButton.focus();
  }

  function openDocumentMenu(last = false) {
    syncDocumentActions();
    const menu = elements.documentMoreMenu;
    menu.hidden = false;
    if (menu.showPopover) menu.showPopover();
    else menu.classList.add("is-open");
    const button = elements.documentMoreButton.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(button.right - bounds.width, window.innerWidth - bounds.width - 12))}px`;
    menu.style.top = `${Math.max(12, Math.min(button.bottom + 6, window.innerHeight - bounds.height - 12))}px`;
    elements.documentMoreButton.setAttribute("aria-expanded", "true");
    const buttons = [...menu.querySelectorAll("button:not([hidden])")];
    (last ? buttons.at(-1) : buttons[0])?.focus();
  }

  function syncDocumentActions() {
    const kind = currentDocumentKind();
    const actions = documentActionState({ kind, parsed: state.isParsedView, study: studyController.isActive(), changed: currentSourceChanged() });
    elements.sourceInput.readOnly = actions.readOnly;
    elements.newFileButton.hidden = actions.hidden;
    elements.copyContentButton.hidden = actions.hidden;
    elements.documentMoreActions.hidden = actions.hidden;
    elements.deleteCurrentFileButton.hidden = !actions.deletable;
    elements.restoreFileButton.hidden = !actions.restore;
    elements.duplicateFileButton.hidden = false;
    elements.restoreFileButton.textContent = t("restoreOriginal");
    setEditorActionButton(elements.newFileButton, "new", t("newDraftAction"));
    setEditorActionButton(elements.documentMoreButton, "more", t("moreActions"));
    setEditorActionButton(elements.deleteCurrentFileButton, "delete", t(kind === "imported" ? "removeFromApp" : "deleteFile"));
    elements.parseToggleButton.hidden = actions.hidden;
    setEditorActionButton(elements.parseToggleButton, actions.toggle, t(actions.toggleLabel));
  }

  async function deleteActiveFile() {
    const entry = getImportEntry(state.activeSourceKey);
    if (!entry || !["draft", "imported"].includes(entry.kind)) return;
    const message = t(entry.kind === "draft" ? "confirmDeleteDraft" : "confirmRemoveUpload", getActiveFileName());
    if (!window.confirm(message + (isFileUnexported(entry.key) ? `\n${t("unexportedDeleteWarning")}` : ""))) return;
    closeDocumentMenu();
    stopPlayback();
    await deleteFileEntry({ ...entry, deletable: true });
  }

  function downloadActiveFile() {
    closeDocumentMenu(true);
    const name = exportFileName(getActiveFileName());
    const extension = name.split(".").at(-1).toLowerCase();
    const type = { md: "text/markdown", txt: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values" }[extension];
    const url = URL.createObjectURL(new Blob([elements.sourceInput.value], { type: `${type};charset=utf-8` }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    exportedFiles.set(state.activeSourceKey, { name: getImportEntry(state.activeSourceKey)?.name || getActiveFileName(), content: elements.sourceInput.value });
    unsavedSourceKeys.delete(state.activeSourceKey);
    saveSettings();
    filesPanel.setModified(state.activeSourceKey, isFileUnexported(state.activeSourceKey));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function restoreActiveFile() {
    const original = originalSourceTexts.get(state.activeSourceKey);
    if (typeof original !== "string" || !currentSourceChanged() || ["document", "draft"].includes(currentDocumentKind())) return;
    closeDocumentMenu();
    stopPlayback();
    elements.sourceInput.value = original;
    sourceEdits.delete(state.activeSourceKey);
    saveSettings();
    if (state.isParsedView) parseAndShow(false);
    syncDocumentActions();
    syncStudyAvailability();
    if (!state.isParsedView) elements.sourceInput.focus();
  }

  async function removeFileEntries(keys) {
    const removed = keys.filter((key) => {
      if (key.startsWith("draft:")) {
        const id = key.slice("draft:".length);
        if (!state.userDrafts[id]) return false;
        delete state.userDrafts[id];
      } else if (!importedFiles.delete(key)) return false;
      unsavedSourceKeys.delete(key);
      sourceEdits.delete(key);
      originalSourceTexts.delete(key);
      exportedFiles.delete(key);
      return true;
    });
    if (!removed.length) return;
    const deletingActive = removed.includes(state.activeSourceKey);
    if (removed.includes(state.lastImportSourceKey)) state.lastImportSourceKey = "";
    if (deletingActive) {
      openRequestId += 1;
      documentLoader.invalidate();
      stopPlayback();
      state.activeSourceKey = "";
      state.activeFileName = "";
      elements.sourceInput.value = "";
      await openFilesFallback();
    } else {
      saveSettings();
      renderFilesPanel();
    }
  }

  async function deleteFileEntry(entry) {
    if (entry?.deletable) await removeFileEntries([entry.key]);
  }

  async function clearFileGroup(kind) {
    if (!["drafts", "uploaded-files", "uploaded-folders"].includes(kind)) return;
    const keys = kind === "drafts"
      ? Object.keys(state.userDrafts).map((id) => `draft:${id}`)
      : [...importedFiles.values()]
        .filter(({ file, fromFolder }) => (fromFolder ?? Boolean(file.webkitRelativePath)) === (kind === "uploaded-folders"))
        .map(({ key }) => key);
    const confirmKey = kind === "drafts" ? "confirmClearDrafts"
      : kind === "uploaded-files" ? "confirmClearUploadedFiles" : "confirmClearUploadedFolders";
    if (!keys.length || !window.confirm(t(confirmKey, keys.length))) return;
    await removeFileEntries(keys);
  }

  async function openFilesFallback() {
    let requestId = openRequestId;
    const shouldStopFallback = async entry => {
      if (requestId !== openRequestId) return true;
      const opening = openFileEntry(entry);
      requestId = openRequestId;
      const loaded = await opening;
      return loaded || requestId !== openRequestId;
    };
    const attempted = new Set();
    for (const key of recentSourceKeys) {
      if (key === state.activeSourceKey) continue;
      attempted.add(key);
      const documentOption = state.documentOptions.find(option => option.path === key);
      const entry = documentOption
        ? { key, name: documentOption.label || documentLabelFromPath(key), kind: "document" }
        : getImportEntry(key);
      if (entry && await shouldStopFallback(entry)) return;
    }
    for (const fallback of state.sampleOptions) {
      if (attempted.has(fallback.path)) continue;
      attempted.add(fallback.path);
      if (await shouldStopFallback({
        key: fallback.path,
        name: fallback.label || sampleLabelFromPath(fallback.path),
        kind: "configured"
      })) return;
    }
    for (const option of state.documentOptions) {
      if (attempted.has(option.path)) continue;
      if (await shouldStopFallback({ key: option.path, name: option.label, kind: "document" })) return;
    }
    if (requestId !== openRequestId) return;
    state.sourceMode = "import";
    state.activeSourceKey = "";
    state.activeFileName = "";
    state.lastImportSourceKey = "";
    elements.sourceInput.value = "";
    parseAndShow(false);
    saveSettings();
    renderFilesPanel();
  }

  function getValidSamplePath(value) {
    if (state.sampleOptions.some((option) => option.path === value)) return value;
    return state.sampleOptions[0]?.path || DEFAULT_DOCUMENT_PATH;
  }

  function getValidDocumentPath(value) {
    if (state.documentOptions.some((option) => option.path === value)) return value;
    if (state.documentOptions.some((option) => option.path === DEFAULT_DOCUMENT_PATH)) return DEFAULT_DOCUMENT_PATH;
    return state.documentOptions[0]?.path || DEFAULT_DOCUMENT_PATH;
  }

  function applyParseModeFromName(name) {
    state.parseModeTouchedByUser = false;
    const mode = inferParseModeFromName(name);
    elements.parseModeSelect.value = mode;
    const split = inferParagraphSplitFromName(name);
    if (mode === "paragraph") elements.paragraphSplitSelect.value = split;
    syncParseModeToggle();
    updateParagraphOptionsVisibility();
    saveSettings();
  }

  function getActiveFileKey() {
    return state.activeSourceKey || (state.sourceMode === "document" ? state.lastDocumentPath : "") || "untitled.md";
  }

  function markSourceUnsaved(sourceKey = getActiveFileKey()) {
    if (!sourceKey) return;
    unsavedSourceKeys.add(sourceKey);
    if (sourceKey.startsWith("draft:")) {
      const id = sourceKey.slice("draft:".length);
      if (state.userDrafts[id]) state.userDrafts[id].unsaved = true;
    }
    filesPanel.setModified(sourceKey, isFileUnexported(sourceKey));
  }

  function handleBeforeUnload(event) {
    if (saveSettings() || !hasUnsavedSources()) return;
    event.preventDefault();
    event.returnValue = "";
  }

  function getActiveFileName() {
    if (state.activeFileName) return state.activeFileName;
    const draftId = getActiveDraftId();
    if (draftId) {
      return state.userDrafts[draftId]?.name || "new_note.md";
    }
    const val = state.sourceMode === "document" ? state.lastDocumentPath : "";
    return val ? val.substring(val.lastIndexOf("/") + 1) : "untitled.md";
  }

  function isClipboardReadSupported() {
    return !!(
      navigator.clipboard &&
      typeof navigator.clipboard.readText === "function" &&
      window.isSecureContext
    );
  }

  function updateTitleDisplay() {
    const isStudy = studyController.isActive();
    const isDraft = Boolean(getActiveDraftId());
    const fileName = getActiveFileName();
    elements.mainTitleText.textContent = fileName;
    elements.mainTitleText.title = fileName;
    elements.mainTitleText.classList.toggle("is-static", isStudy || !isDraft);

    closeDocumentMenu();
    syncDocumentActions();

    syncTranslationButtons();
    if (isStudy) {
      elements.toggleTranslationButton.hidden = true;
      elements.toggleReadTranslationButton.hidden = true;
    }
  }

  function triggerTitlePulse() {
    const el = elements.mainTitleText;
    if (!el) return;
    el.classList.remove("title-pulse");
    void el.offsetWidth;
    el.classList.add("title-pulse");
    setTimeout(() => {
      el.classList.remove("title-pulse");
    }, 800);
  }

  function triggerPanelTransition() {
    const panel = document.querySelector(".main-panel");
    if (panel) {
      panel.classList.remove("panel-appear-glow");
      void panel.offsetWidth;
      panel.classList.add("panel-appear-glow");
      setTimeout(() => {
        panel.classList.remove("panel-appear-glow");
      }, 1600);
    }

    const activeEl = state.isParsedView ? elements.parsedView : elements.editorView;
    if (activeEl) {
      activeEl.classList.remove("content-fade-in");
      void activeEl.offsetWidth;
      activeEl.classList.add("content-fade-in");
      setTimeout(() => {
        activeEl.classList.remove("content-fade-in");
      }, 800);
    }
  }

  function showParsed({ animate = true } = {}) {
    state.isParsedView = true;
    elements.editorView.hidden = true;
    elements.parsedView.hidden = false;
    setEditorActionButton(elements.parseToggleButton,
      state.sourceMode === "document" ? "raw" : "edit",
      state.sourceMode === "document" ? t("showRaw") : t("editAction"));
    updateTitleDisplay();
    updateTranslateLink();
    studyController.syncUi();
    if (animate) triggerPanelTransition();
  }

  function showEditor() {
    studyController.reset();
    state.isParsedView = false;
    elements.editorView.hidden = false;
    elements.parsedView.hidden = true;
    setEditorActionButton(elements.parseToggleButton, "parse", t("parseAction"));
    updateTitleDisplay();
    studyController.syncUi();
    triggerPanelTransition();
  }

  function showEditorAtActiveItem() {
    showEditor();
    const item = state.items[state.activeItemIndex];
    const raw = item?.parts[state.activeColumnIndex]?.raw || item?.raw;
    if (!raw) return;
    const index = elements.sourceInput.value.indexOf(raw);
    if (index >= 0) {
      elements.sourceInput.focus();
      elements.sourceInput.setSelectionRange(index, index + raw.length);
      const lineNumber = elements.sourceInput.value.slice(0, index).split("\n").length;
      elements.sourceInput.scrollTop = Math.max(0, (lineNumber - 5) * 22);
    }
  }

  function bindEvents() {
    elements.parseToggleButton.addEventListener("click", async () => {
      try {
        if (state.isParsedView) showEditorAtActiveItem();
        else if (!await discardEmptyDraft()) parseAndShow();
      } catch (error) {
        setStatus(t("actionFailed", error.message || String(error)));
        window.console.error(error);
      }
    });

    elements.localFileInput.addEventListener("change", () => {
      addUploadedEntries(uploadEntries(elements.localFileInput.files || []));
      elements.localFileInput.value = "";
    });

    elements.folderInput.addEventListener("change", () => {
      addUploadedEntries(uploadEntries(elements.folderInput.files || [], true));
      elements.folderInput.value = "";
    });
    elements.filesPanelContent.addEventListener("dragover", event => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      elements.filesPanelContent.classList.add("is-drop-target");
    });
    elements.filesPanelContent.addEventListener("dragleave", event => {
      if (!elements.filesPanelContent.contains(event.relatedTarget)) elements.filesPanelContent.classList.remove("is-drop-target");
    });
    elements.filesPanelContent.addEventListener("drop", async event => {
      event.preventDefault();
      elements.filesPanelContent.classList.remove("is-drop-target");
      try { addUploadedEntries(await droppedEntries(event.dataTransfer.items)); }
      catch (error) { setStatus(t("actionFailed", error.message || String(error))); }
    });


    elements.sourceInput.addEventListener("input", () => {
      if (elements.sourceInput.readOnly) return;
      markSourceUnsaved();
      syncDocumentActions();
      syncStudyAvailability();
      saveSourceInputSettings();
    });
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", saveSettings);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveSettings(); });

    // Filename editing listeners
    elements.mainTitleText.addEventListener("click", () => {
      if (!getActiveDraftId() || studyController.isActive()) return;
      elements.mainTitleText.hidden = true;
      elements.mainTitleInput.hidden = false;
      elements.mainTitleInput.value = stripMarkdownExtension(state.activeFileName);
      elements.mainTitleInput.focus();
      elements.mainTitleInput.select();
    });

    const finishTitleEdit = () => {
      if (elements.mainTitleInput.hidden) return;
      const draftId = getActiveDraftId();
      const newName = normalizeDraftName(elements.mainTitleInput.value);
      if (newName && newName !== state.activeFileName) {
        state.activeFileName = newName;
        elements.mainTitleText.textContent = newName;
        elements.mainTitleText.title = newName;
        if (draftId && state.userDrafts[draftId]) {
          state.userDrafts[draftId].name = newName;
        }
        markSourceUnsaved();
        applyParseModeFromName(newName);
        saveSettings();
        renderFilesPanel();
      }
      elements.mainTitleInput.hidden = true;
      elements.mainTitleText.hidden = false;
    };

    elements.mainTitleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishTitleEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        elements.mainTitleInput.hidden = true;
        elements.mainTitleText.hidden = false;
      }
    });

    elements.mainTitleInput.addEventListener("blur", () => {
      finishTitleEdit();
    });

    // Copy and Paste button listeners
    const copyToClipboard = (text) => {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      }
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      return new Promise((resolve, reject) => {
        const successful = document.execCommand('copy');
        textArea.remove();
        if (successful) resolve();
        else reject(new Error("document.execCommand copy failed"));
      });
    };

    elements.copyContentButton.addEventListener("click", async () => {
      try {
        await copyToClipboard(elements.sourceInput.value);
        clearTimeout(state.copyFeedbackTimer);
        setEditorActionButton(elements.copyContentButton, "copied", t("copyDone"));
        state.copyFeedbackTimer = setTimeout(() => {
          setEditorActionButton(elements.copyContentButton, "copy", t("copyAction"));
        }, 1500);
      } catch (err) {
        window.console.error("Failed to copy text: ", err);
      }
    });


    elements.newFileButton.addEventListener("click", () => {
      saveSettings();
      stopPlayback();
      createBrowserDraft({
        name: getUniqueDraftName("new_note.md"),
        content: "",
        parse: false
      });
    });

    elements.duplicateFileButton.addEventListener("click", duplicateActiveFile);
    elements.downloadFileButton.addEventListener("click", downloadActiveFile);
    elements.restoreFileButton.addEventListener("click", restoreActiveFile);
    elements.deleteCurrentFileButton.addEventListener("click", deleteActiveFile);
    [elements.newFileButton, elements.copyContentButton, elements.parseToggleButton, elements.deleteCurrentFileButton].forEach(button => {
      button.addEventListener("keydown", event => {
        if (["Enter", " "].includes(event.key)) event.stopPropagation();
      });
    });
    elements.documentMoreButton.addEventListener("click", () => {
      if (elements.documentMoreButton.getAttribute("aria-expanded") === "true") closeDocumentMenu();
      else openDocumentMenu();
    });
    elements.documentMoreButton.addEventListener("keydown", event => {
      if (["Enter", " "].includes(event.key)) { event.stopPropagation(); return; }
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      openDocumentMenu(event.key === "ArrowUp");
    });
    elements.documentMoreMenu.addEventListener("keydown", event => {
      event.stopPropagation();
      const buttons = [...elements.documentMoreMenu.querySelectorAll("button:not([hidden])")];
      const index = buttons.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeDocumentMenu(true);
      } else if (event.key === "Tab") closeDocumentMenu(true);
    });
    document.addEventListener("pointerdown", event => {
      if (!elements.documentMoreMenu.contains(event.target) && !elements.documentMoreActions.contains(event.target)) closeDocumentMenu();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && elements.documentMoreButton.getAttribute("aria-expanded") === "true") closeDocumentMenu(true);
    });
    window.addEventListener("resize", () => closeDocumentMenu());
    document.addEventListener("scroll", event => {
      if (!elements.documentMoreMenu.contains(event.target)) closeDocumentMenu();
    }, true);

  }

  return { initializeDrafts, syncSourceContext, rememberCurrentSourceSelection, autoLoadSample, loadDocument, getFileDisplayPath, registerImportedFile, addUploadedEntries, getRestorableImportSource, getImportEntry, renderFilesPanel, openFileEntry, getActiveDraftId, stripMarkdownExtension, normalizeDraftName, getUniqueDraftName, createBrowserDraft, discardEmptyDraft, duplicateActiveFile, currentDocumentKind, closeDocumentMenu, openDocumentMenu, syncDocumentActions, deleteActiveFile, downloadActiveFile, restoreActiveFile, removeFileEntries, deleteFileEntry, clearFileGroup, openFilesFallback, getValidSamplePath, getValidDocumentPath, applyParseModeFromName, getActiveFileKey, markSourceUnsaved, handleBeforeUnload, getActiveFileName, isClipboardReadSupported, updateTitleDisplay, triggerTitlePulse, triggerPanelTransition, showParsed, showEditor, showEditorAtActiveItem, bindEvents };
}
