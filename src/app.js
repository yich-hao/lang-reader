import { analyzeVocabularyStructure, parseInput } from "./parsing/parser.js";
import { parseMarkdownReader } from "./parsing/readerMarkdown.js";
import { createPlaylist, setPosition } from "./playback/playlist.js";
import { createSpeech } from "./playback/speech.js";
import { loadState } from "./core/storage.js";
import { loadRuntimeConfig } from "./app/runtimeConfig.js";
import { getSamplesWithManifest, getDocumentsWithManifest } from "./app/sourceCatalog.js";
import { createSourceWarnings } from "./app/sourceWarnings.js";
import { createDocumentLoader } from "./app/documentLoader.js";
import { createDocumentRevisions } from "./app/documentRevisions.js";
import { createTextUnits } from "./app/textUnits.js";
import { createReaderView } from "./app/readerView.js";
import { createVocabularyView } from "./app/vocabularyView.js";
import { createColumnControls } from "./app/columnControls.js";
import { createReaderModel } from "./app/readerModel.js";
import { DEFAULT_APP_CONFIG, DEFAULT_DOCUMENT_PATH, DEFAULT_ROLES, DEFAULT_TARGET_LANGUAGE } from "./core/config.js";
import { createViewEffects } from "./app/viewEffects.js";
import { showSegmentRejection } from "./ui/customControls.js";
import { createStudyController } from "./study/controller.js";
import { studySourceIdentity } from "./study/model.js";
import { normalizeStudySize } from "./study/session.js";
import { createFilesTree } from "./files/filesTree.js";
import { FILE_GROUP_APPEARANCE } from "./files/fileTreeAppearance.js";
import { createNotice } from "./ui/notice.js";
import { initActionTooltips } from "./ui/tooltips.js";
import { createDocumentController } from "./app/documentController.js";
import { createPlaybackUnits } from "./app/playbackUnits.js";
import { createPlaybackController } from "./app/playbackController.js";
import { createSettingsController } from "./app/settingsController.js";
import { createWorkspaceUi } from "./app/workspaceUi.js";
import { createTranslationUi } from "./app/translationUi.js";
import { isValidUiLanguage } from "./i18n/languages.js";
import { createLanguagePreferences } from "./i18n/languagePreferences.js";
import { createLanguageListController } from "./app/languageListController.js";

const showNotice = createNotice();
const sourceWarnings = createSourceWarnings();
let copyFeedbackTimer = 0;

const elements = {
  sourceInput: document.querySelector("#sourceInput"),
  editorView: document.querySelector("#editorView"),
  parsedView: document.querySelector("#parsedView"),
  parsedTableWrap: document.querySelector("#parsedTableWrap"),
  parseToggleButton: document.querySelector("#parseToggleButton"),
  localFileInput: document.querySelector("#localFileInput"),
  folderInput: document.querySelector("#folderInput"),
  workspace: document.querySelector(".workspace"),
  sidePanel: document.querySelector(".side-panel"),
  settingsToggleButton: document.querySelector("#settingsToggleButton"),
  settingsTabButton: document.querySelector("#settingsTabButton"),
  filesTabButton: document.querySelector("#filesTabButton"),
  settingsPanelContent: document.querySelector("#settingsPanelContent"),
  filesPanelContent: document.querySelector("#filesPanelContent"),
  filesList: document.querySelector("#filesList"),
  filesCount: document.querySelector("#filesCount"),
  filesEmptyState: document.querySelector("#filesEmptyState"),
  mainTitleText: document.querySelector("#mainTitleText"),
  mainTitleInput: document.querySelector("#mainTitleInput"),
  copyContentButton: document.querySelector("#copyContentButton"),
  newFileButton: document.querySelector("#newFileButton"),
  duplicateFileButton: document.querySelector("#duplicateFileButton"),
  deleteCurrentFileButton: document.querySelector("#deleteCurrentFileButton"),
  documentMoreActions: document.querySelector("#documentMoreActions"),
  documentMoreButton: document.querySelector("#documentMoreButton"),
  documentMoreMenu: document.querySelector("#documentMoreMenu"),
  downloadFileButton: document.querySelector("#downloadFileButton"),
  restoreFileButton: document.querySelector("#restoreFileButton"),
  studyEntryReveal: document.querySelector("#studyToggleButton"),
  studyToggleButton: document.querySelector("#studyToggleButton"),
  studyEntryMeta: document.querySelector("#studyEntryMeta"),
  studyProgressActions: document.querySelector("#studyProgressActions"),
  studyProgressImportButton: document.querySelector("#studyProgressImportButton"),
  studyProgressExportButton: document.querySelector("#studyProgressExportButton"),
  studyRememberedOption: document.querySelector("#studyRememberedOption"),
  studyRememberedOptionInput: document.querySelector("#studyRememberedOptionInput"),
  studyFuzzyOption: document.querySelector("#studyFuzzyOption"),
  studyFuzzyOptionInput: document.querySelector("#studyFuzzyOptionInput"),
  studyHeadingProgressActions: document.querySelector("#studyHeadingProgressActions"),
  studyHeadingImportButton: document.querySelector("#studyHeadingImportButton"),
  studyHeadingExportButton: document.querySelector("#studyHeadingExportButton"),
  studyHomeButton: document.querySelector("#studyHomeButton"),
  parseSettingsSection: document.querySelector("#parseSettingsSection"),
  playbackSettingsSection: document.querySelector("#playbackSettingsSection"),
  speechSettingsSection: document.querySelector("#speechSettingsSection"),
  assistSettingsSection: document.querySelector("#assistSettingsSection"),
  studyImportInput: document.querySelector("#studyImportInput"),
  toggleTranslationButton: document.querySelector("#toggleTranslationButton"),
  toggleReadTranslationButton: document.querySelector("#toggleReadTranslationButton"),
  statusText: document.querySelector("#statusText"),
  uiLanguageSelect: document.querySelector("#uiLanguageSelect"),
  targetLanguageSelect: document.querySelector("#targetLanguageSelect"),
  translationLanguageSelect: document.querySelector("#translationLanguageSelect"),
  translationLanguageLabel: document.querySelector("#translationLanguageLabel"),
  hideTranslationsLabel: document.querySelector("#hideTranslationsLabel"),
  readTranslationsInput: document.querySelector("#readTranslationsInput"),
  readTranslationsLabel: document.querySelector("#readTranslationsLabel"),
  parseModeSelect: document.querySelector("#parseModeSelect"),
  parseModeVocabBtn: document.querySelector("#parseModeVocabBtn"),
  parseModeReaderBtn: document.querySelector("#parseModeReaderBtn"),
  paragraphOptions: document.querySelector("#paragraphOptions"),
  paragraphSplitSelect: document.querySelector("#paragraphSplitSelect"),
  paragraphRegexLabel: document.querySelector("#paragraphRegexLabel"),
  paragraphRegexInput: document.querySelector("#paragraphRegexInput"),
  paragraphExamples: document.querySelector("#paragraphExamples"),
  modeSelect: document.querySelector("#modeSelect"),
  playModeSelect: document.querySelector("#playModeSelect"),
  playbackUnitSelect: document.querySelector("#playbackUnitSelect"),
  speechSourceSelect: document.querySelector("#speechSourceSelect"),
  speechSourceAll: document.querySelector("#speechSourceAll"),
  speechSourceApple: document.querySelector("#speechSourceApple"),
  speechSourceGoogle: document.querySelector("#speechSourceGoogle"),
  speechSourceMicrosoft: document.querySelector("#speechSourceMicrosoft"),
  repeatInput: document.querySelector("#repeatInput"),
  repeatValue: document.querySelector("#repeatValue"),
  gapInput: document.querySelector("#gapInput"),
  gapSlider: document.querySelector("#gapSlider"),
  gapValue: document.querySelector("#gapValue"),
  partGapInput: document.querySelector("#partGapInput"),
  partGapValue: document.querySelector("#partGapValue"),
  rateInput: document.querySelector("#rateInput"),
  rateValue: document.querySelector("#rateValue"),
  volumeInput: document.querySelector("#volumeInput"),
  volumeValue: document.querySelector("#volumeValue"),
  voiceSelect: document.querySelector("#voiceSelect"),
  languageVoiceControls: document.querySelector("#languageVoiceControls"),
  playButton: document.querySelector("#playButton"),
  autoPlayButton: document.querySelector("#autoPlayButton"),
  restartButton: document.querySelector("#restartButton"),
  prevButton: document.querySelector("#prevButton"),
  nextButton: document.querySelector("#nextButton"),
  showTranslationsInput: document.querySelector("#showTranslationsInput"),
  translatorPicker: document.querySelector("#translatorPicker"),
  translatorLinks: [...document.querySelectorAll("[data-translation-provider]")],
  themeToggleButton: document.querySelector("#themeToggleButton"),
  embedTranslateWrap: document.querySelector("#embedTranslateWrap"),
  translateConsentBanner: document.querySelector("#translateConsentBanner"),
  enableEmbedTranslateButton: document.querySelector("#enableEmbedTranslateButton"),
  shortcutsHelpButton: document.querySelector("#shortcutsHelpButton"),
  shortcutsModal: document.querySelector("#shortcutsModal"),
  closeShortcutsButton: document.querySelector("#closeShortcutsButton")
};

// Live accessors share one state owner; factories do not snapshot these values.
const appState = {
  get saved() { return saved; }, set saved(value) { saved = value; },
  get sourceMode() { return sourceMode; }, set sourceMode(value) { sourceMode = value; },
  get targetLanguage() { return targetLanguage; }, set targetLanguage(value) { targetLanguage = value; },
  get uiLanguage() { return uiLanguage; }, set uiLanguage(value) { uiLanguage = value; },
  get translationLanguage() { return translationLanguage; }, set translationLanguage(value) { translationLanguage = value; },
  get isParsedView() { return isParsedView; }, set isParsedView(value) { isParsedView = value; },
  get parsedViewMode() { return parsedViewMode; }, set parsedViewMode(value) { parsedViewMode = value; },
  get items() { return items; }, set items(value) { items = value; },
  get activeItemIndex() { return activeItemIndex; }, set activeItemIndex(value) { activeItemIndex = value; },
  get activeTranslateSelection() { return activeTranslateSelection; }, set activeTranslateSelection(value) { activeTranslateSelection = value; },
  get translationProvider() { return translationProvider; }, set translationProvider(value) { translationProvider = value; },
  get appConfig() { return appConfig; }, set appConfig(value) { appConfig = value; },
  get sidePanelTab() { return sidePanelTab; }, set sidePanelTab(value) { sidePanelTab = value; },
  get temporaryWordMode() { return temporaryWordMode; }, set temporaryWordMode(value) { temporaryWordMode = value; },
  get activeClickMode() { return activeClickMode; }, set activeClickMode(value) { activeClickMode = value; },
  get targetLanguageTouchedByUser() { return targetLanguageTouchedByUser; }, set targetLanguageTouchedByUser(value) { targetLanguageTouchedByUser = value; },
  get translationLanguageTouchedByUser() { return translationLanguageTouchedByUser; }, set translationLanguageTouchedByUser(value) { translationLanguageTouchedByUser = value; },
  get parseModeTouchedByUser() { return parseModeTouchedByUser; }, set parseModeTouchedByUser(value) { parseModeTouchedByUser = value; },
  get lastDocumentPath() { return lastDocumentPath; }, set lastDocumentPath(value) { lastDocumentPath = value; },
  get lastImportSourceKey() { return lastImportSourceKey; }, set lastImportSourceKey(value) { lastImportSourceKey = value; },
  get sampleOptions() { return sampleOptions; }, set sampleOptions(value) { sampleOptions = value; },
  get userDrafts() { return userDrafts; }, set userDrafts(value) { userDrafts = value; },
  get activeFileName() { return activeFileName; }, set activeFileName(value) { activeFileName = value; },
  get activeSourceKey() { return activeSourceKey; }, set activeSourceKey(value) { activeSourceKey = value; },
  get voiceNamesByLanguage() { return voiceNamesByLanguage; }, set voiceNamesByLanguage(value) { voiceNamesByLanguage = value; },
  get studyPreferences() { return studyPreferences; }, set studyPreferences(value) { studyPreferences = value; },
  get columnRoles() { return columnRoles; }, set columnRoles(value) { columnRoles = value; },
  get columnLanguages() { return columnLanguages; }, set columnLanguages(value) { columnLanguages = value; },
  get columnWidths() { return columnWidths; }, set columnWidths(value) { columnWidths = value; },
  get columnTags() { return columnTags; }, set columnTags(value) { columnTags = value; },
  get manualColumnLanguages() { return manualColumnLanguages; }, set manualColumnLanguages(value) { manualColumnLanguages = value; },
  get hiddenPreviousRoles() { return hiddenPreviousRoles; }, set hiddenPreviousRoles(value) { hiddenPreviousRoles = value; },
  get activeColumnIndex() { return activeColumnIndex; }, set activeColumnIndex(value) { activeColumnIndex = value; },
  get activeUnitCursor() { return activeUnitCursor; }, set activeUnitCursor(value) { activeUnitCursor = value; },
  get activeSelectionMode() { return activeSelectionMode; }, set activeSelectionMode(value) { activeSelectionMode = value; },
  get playlist() { return playlist; }, set playlist(value) { playlist = value; },
  get isPlaying() { return isPlaying; }, set isPlaying(value) { isPlaying = value; },
  get playbackRunId() { return playbackRunId; }, set playbackRunId(value) { playbackRunId = value; },
  get activePlaybackButton() { return activePlaybackButton; }, set activePlaybackButton(value) { activePlaybackButton = value; },
  get playbackProgress() { return playbackProgress; }, set playbackProgress(value) { playbackProgress = value; },
  get isPaused() { return isPaused; }, set isPaused(value) { isPaused = value; },
  get rememberedWordCursor() { return rememberedWordCursor; }, set rememberedWordCursor(value) { rememberedWordCursor = value; },
  get playbackSession() { return playbackSession; }, set playbackSession(value) { playbackSession = value; },
  get documentOptions() { return documentOptions; }, set documentOptions(value) { documentOptions = value; },
  get copyFeedbackTimer() { return copyFeedbackTimer; }, set copyFeedbackTimer(value) { copyFeedbackTimer = value; },
};

const speech = createSpeech();
const translationUi = createTranslationUi({ elements, document, window,
  state: appState,
  services: { get studyController() { return studyController; } },
  saveSettings: (...args) => saveSettings(...args),
  refreshVoices: (...args) => refreshVoices(...args),
  updateParagraphOptionsVisibility: (...args) => updateParagraphOptionsVisibility(...args),
  getSingleUnit: (...args) => getSingleUnit(...args),
  normalizePlaybackCursor: (...args) => normalizePlaybackCursor(...args),
  getValidLanguageCode: (...args) => getValidLanguageCode(...args),
  buildReaderSpeechSegments: (...args) => buildReaderSpeechSegments(...args),
  getStudyColumnRoles: (...args) => getStudyColumnRoles(...args),
});
const {
  renderTranslatorPicker, syncTranslationButtons, updateTranslateLink, updateTranslateLinkForCursor,
  openCurrentTranslation, getValidTranslationProvider, updateTranslationVisibility, docHasTranslations,
  initTranslateWidget
} = translationUi;

const workspaceUi = createWorkspaceUi({ elements, document, window,
  state: appState,
  services: { get studyController() { return studyController; } },
  renderFilesPanel: (...args) => renderFilesPanel(...args),
  saveSettings: (...args) => saveSettings(...args),
  t: (...args) => t(...args),
  beginTemporaryWordMode: (...args) => beginTemporaryWordMode(...args),
  endTemporaryWordMode: (...args) => endTemporaryWordMode(...args),
  stopPlayback: (...args) => stopPlayback(...args),
  handlePlaybackButton: (...args) => handlePlaybackButton(...args),
  moveKeyboardSelection: (...args) => moveKeyboardSelection(...args),
  setKeyboardClickMode: (...args) => setKeyboardClickMode(...args),
  openCurrentTranslation: (...args) => openCurrentTranslation(...args),
  cycleRepeatValue: (...args) => cycleRepeatValue(...args),
  updateActiveTableState: (...args) => updateActiveTableState(...args),
});
const {
  initFolderOutline, initSettingsPanel, setSidePanelTab, updatePanelToggleLabel, isMobileSettings,
  setSettingsSheetState, refreshSettingsSheetHeight, setStatus, debounce, updateThemeButtonLabel,
  initTheme
} = workspaceUi;

const languagePreferences = createLanguagePreferences({
  getVoices: () => speech.getVoices(),
  getRetained: () => [appState.targetLanguage, appState.translationLanguage, ...appState.columnLanguages,
    ...settingsController.getDocumentLanguages()],
  getPreference: () => appState.saved.languageList
});
const settingsController = createSettingsController({ elements, document, window, navigator, speech, languagePreferences,
  setStatus: (...args) => setStatus(...args),
  showNotice: (...args) => showNotice(...args),
  parseAndShow: (...args) => parseAndShow(...args),
  renderParsedTable: (...args) => renderParsedTable(...args),
  syncSourceContext: (...args) => syncSourceContext(...args),
  renderFilesPanel: (...args) => renderFilesPanel(...args),
  initTheme: (...args) => initTheme(...args),
  initTranslateWidget: (...args) => initTranslateWidget(...args),
  syncTranslationButtons: (...args) => syncTranslationButtons(...args),
  updateTranslationVisibility: (...args) => updateTranslationVisibility(...args),
  docHasTranslations: (...args) => docHasTranslations(...args),
  buildReaderSpeechSegments: (...args) => buildReaderSpeechSegments(...args),
  getActiveDraftId: (...args) => getActiveDraftId(...args),
  getActiveFileKey: (...args) => getActiveFileKey(...args),
  getValidSamplePath: (...args) => getValidSamplePath(...args),
  getValidDocumentPath: (...args) => getValidDocumentPath(...args),
  getValidClickMode: (...args) => getValidClickMode(...args),
  getValidPlaybackUnit: (...args) => getValidPlaybackUnit(...args),
  getColumnCount: (...args) => getColumnCount(...args),
  showParsed: (...args) => showParsed(...args),
  showEditor: (...args) => showEditor(...args),
  updatePlaybackButtons: (...args) => updatePlaybackButtons(...args),
  updateTranslateLink: (...args) => updateTranslateLink(...args),
  updateThemeButtonLabel: (...args) => updateThemeButtonLabel(...args),
  updatePanelToggleLabel: (...args) => updatePanelToggleLabel(...args),
  applyClickModeChange: (...args) => applyClickModeChange(...args),
  pauseForModeChange: (...args) => pauseForModeChange(...args),
  rerenderClickUnits: (...args) => rerenderClickUnits(...args),
  debounce: (...args) => debounce(...args),
  isFileUnexported: (...args) => isFileUnexported(...args),
  services: {
    get languageList() { return languageList; },
    get studyController() { return studyController; },
    get filesPanel() { return filesPanel; },
    get documentRevisions() { return documentRevisions; },
    get exportedFiles() { return exportedFiles; },
    get sourceEdits() { return sourceEdits; },
    get unsavedSourceKeys() { return unsavedSourceKeys; },
  },
  state: appState
});
const {
  applyConfigDefaults, populateLanguageOptions, restoreSettings, getValidSourceMode, saveSettings,
  saveStudyPreferences, refreshVoices, showSpeechFailureNotice, applyDocumentOptions, prepareDocumentSettings,
  shouldUseReaderMode, getPlaylistOptions, syncGapInputs, getParserPartRoles, getStudyColumnRoles,
  getEffectivePartRole, ensureColumnSettings, updateRangeLabels, applyArticleSettings,
  updateSidebarVisibilityByFeatures, updateParagraphOptionsVisibility, syncParseModeToggle, applyI18n,
  t, getValidLanguageCode, normalizeLanguageSettings, normalizeColumnTags, migrateRoleTags, cleanTag,
  normalizeRoleSettings, normalizeSingleRole, getDefaultColumnLanguages, defaultLanguageForColumn
} = settingsController;

const { createInteractiveTextUnit } = createTextUnits({
  document,
  focusContent: () => elements.parsedTableWrap.focus({ preventScroll: true })
});
const playbackUnits = createPlaybackUnits({ elements,
  shouldUseReaderMode: (...args) => shouldUseReaderMode(...args),
  getEffectivePartRole: (...args) => getEffectivePartRole(...args),
  state: appState
});
const {
  getValidClickMode, getClickUnitMode, getClickUnitLevel, getSelectionUnitMode, getRenderClickMode,
  getValidPlaybackUnit, isFromHereClickMode, buildClickPlaybackRequest, normalizePlaybackCursor,
  getSingleUnit, buildReaderSpeechSegments, getSelectionCursor, getColumnCount,
  forEachReaderDisplaySegment, normalizeSpeechText, splitDisplayWordTokens,
  splitSentenceRangesForDisplay, splitSentencesForDisplay, getSentenceIndexAtOffset
} = playbackUnits;

const { renderReaderView } = createReaderView({
  document,
  container: elements.parsedTableWrap,
  getBlocks: () => readerBlocks,
  getEffectiveClickMode: getRenderClickMode,
  getPointerUnitMode: getClickUnitMode,
  getTargetLanguage: () => targetLanguage,
  createInteractiveTextUnit,
  forEachReaderDisplaySegment,
  splitDisplayWordTokens,
  getSentenceIndexAtOffset,
  splitSentenceRangesForDisplay,
  onRendered: () => updateActiveTableState(),
  onTranslationActivate: (...args) => playReaderTranslation(...args),
  onSourceActivate: (itemIndex, options) => {
    activateSourceText(itemIndex, options.columnIndex || 0, options);
  }
});
const { assignReaderItems, createReaderPlaybackItems } = createReaderModel({
  getTargetLanguage: () => targetLanguage,
  splitSentencesForDisplay
});
const viewEffects = createViewEffects({ document, elements, getColumnCount, getSelectionUnitMode, getSelectionCursor,
  state: appState
});
const {
  getColumnWidth, getTableWidth, getRenderedColumnWidths, redistributeColumnWidths,
  isLastResizableColumn, getMinColumnWidth, applyColumnLayout, getCurrentRenderedColumnWidths,
  updateActiveTableState, scrollActiveRowIntoView
} = viewEffects;
const columnControls = createColumnControls({
  getLanguageOptions: () => languagePreferences.options(),
  document, window, t, saveSettings, cleanTag, normalizeSingleRole,
  onColumnChange: (index, change) => {
    if (change?.tagChanged) settingsController.refreshColumnMetadata(index);
    playbackController.handleColumnChange(index, change);
    rerenderClickUnits();
    syncStudyAvailability();
    refreshVoices();
  },
  defaultLanguageForColumn, getColumnCount, getRenderedColumnWidths, getMinColumnWidth,
  redistributeColumnWidths, applyColumnLayout, getCurrentRenderedColumnWidths,
  state: appState
});
const {
  renderColumnControls, renderHiddenColumnButton, renderResizeHandle, closeLanguagePickers, closeTagEditors
} = columnControls;
const languageList = createLanguageListController({
  document, window, preferences: languagePreferences, t,
  getUiLanguage: () => appState.uiLanguage,
  getPreference: () => appState.saved.languageList,
  setPreference: value => {
    appState.saved.languageList = value;
    saveSettings();
    settingsController.populateSpeechLanguageOptions();
    closeLanguagePickers();
  }
});
const { renderVocabularyView } = createVocabularyView({
  document,
  container: elements.parsedTableWrap,
  getItems: () => items,
  getActiveItemIndex: () => activeItemIndex,
  getColumnRoles: () => columnRoles,
  getColumnTags: () => columnTags,
  getColumnLanguage: (part, index) => columnLanguages[index] || part?.language || targetLanguage,
  getRenderUnitLevel: getClickUnitLevel,
  getPointerUnitMode: getClickUnitMode,
  getEffectivePartRole, getColumnWidth, getRenderedColumnWidths, getTableWidth,
  renderColumnControls, renderHiddenColumnButton, renderResizeHandle, isLastResizableColumn,
  createInteractiveTextUnit, splitDisplayWordTokens, splitSentenceRangesForDisplay,
  getSentenceIndexAtOffset, isFromHereClickMode,
  onSourceActivate: (...args) => activateSourceText(...args),
  onSectionActivate: (index) => {
    activateSelectionMode("click");
    setActiveCursor(index, 0, { sentenceIndex: 0, wordIndex: 0 }, { translateUnitLevel: "cell" });
    runPlayback(buildClickPlaybackRequest("cell", 0));
  },
  onRendered: () => {
    updateActiveTableState();
    updateTranslationVisibility();
    saveSettings();
  }
});
const playbackController = createPlaybackController({ units: playbackUnits, elements, document, window, speech,
  setStatus: (...args) => setStatus(...args),
  t: (...args) => t(...args),
  saveSettings: (...args) => saveSettings(...args),
  parseAndShow: (...args) => parseAndShow(...args),
  renderParsedTable: (...args) => renderParsedTable(...args),
  updateActiveTableState: (...args) => updateActiveTableState(...args),
  scrollActiveRowIntoView: (...args) => scrollActiveRowIntoView(...args),
  updateTranslateLink: (...args) => updateTranslateLink(...args),
  updateTranslateLinkForCursor: (...args) => updateTranslateLinkForCursor(...args),
  showSpeechFailureNotice: (...args) => showSpeechFailureNotice(...args),
  syncGapInputs: (...args) => syncGapInputs(...args),
  updateRangeLabels: (...args) => updateRangeLabels(...args),
  updateTranslationVisibility: (...args) => updateTranslationVisibility(...args),
  state: appState
});
const {
  activateSelectionMode, activateSourceText, setActiveCursor, setKeyboardClickMode,
  applyClickModeChange, moveKeyboardSelection, cycleRepeatValue, pauseForModeChange,
  handlePlaybackButton, runPlayback, syncSpeechSettings, getSpeechOptions, playReaderTranslation,
  stopPlayback, updatePlaybackButtons, beginTemporaryWordMode, endTemporaryWordMode,
  rerenderClickUnits
} = playbackController;

let saved = loadState();
let appConfig = DEFAULT_APP_CONFIG;
let items = [];
let readerBlocks = [];
let parsedViewMode = "table";
let playlist = createPlaylist([]);
let isPlaying = false;
let isParsedView = false;
let activeItemIndex = 0;
let activeColumnIndex = 0;
let uiLanguage = isValidUiLanguage(saved.uiLanguage) ? saved.uiLanguage : "en";
let targetLanguage = getValidLanguageCode(saved.targetLanguage, DEFAULT_TARGET_LANGUAGE);
let translationLanguage = getValidLanguageCode(saved.translationLanguage, uiLanguage);
let columnRoles = normalizeRoleSettings(saved.columnRoles, DEFAULT_ROLES);
let columnWidths = Array.isArray(saved.columnWidths) ? saved.columnWidths : [];
let columnTags = Array.isArray(saved.columnTags) ? saved.columnTags : migrateRoleTags(saved.columnRoles);
let columnLanguages = normalizeLanguageSettings(saved.columnLanguages, getDefaultColumnLanguages());
let hiddenPreviousRoles = saved.hiddenPreviousRoles || {};
const importedFiles = new Map();
let voiceNamesByLanguage = saved.voiceNamesByLanguage && typeof saved.voiceNamesByLanguage === "object" ? saved.voiceNamesByLanguage : {};
let manualColumnLanguages = Array.isArray(saved.manualColumnLanguages) ? saved.manualColumnLanguages : [];
let playbackRunId = 0;
let activePlaybackButton = "";
let playbackProgress = { target: 0, current: 0, frame: 0 };
let isPaused = false;
let activeUnitCursor = { rowIndex: 0, columnIndex: 0, sentenceIndex: 0, wordIndex: 0 };
let activeClickMode = "word";
let activeSelectionMode = "click";
let rememberedWordCursor = null;
let temporaryWordMode = false;
let translationProvider = getValidTranslationProvider(saved.translationProvider);
let activeTranslateSelection = { text: "", sourceLanguage: targetLanguage };
let playbackSession = { kind: "", request: null, units: [], unitIndex: 0 };

let parseModeTouchedByUser = false;
let targetLanguageTouchedByUser = Boolean(saved.targetLanguageTouchedByUser);
let translationLanguageTouchedByUser = Boolean(saved.translationLanguageTouchedByUser);
let sourceMode = getValidSourceMode(saved.sourceMode);
let sidePanelTab = saved.sidePanelTab === "files" ? "files" : "settings";
let sampleOptions = [];
let documentOptions = [];
let userDrafts = saved.userDrafts && typeof saved.userDrafts === "object" ? saved.userDrafts : {};
let activeFileName = saved.activeFileName || "";
let activeSourceKey = saved.activeSourceKey || "";
let lastDocumentPath = saved.lastDocumentPath || saved.documentPath || DEFAULT_DOCUMENT_PATH;
let lastImportSourceKey = saved.lastImportSourceKey
  || (saved.sourceMode === "import" ? saved.activeSourceKey : "");
const documentRevisions = createDocumentRevisions({
  saved,
  getSourceMode: () => sourceMode,
  getActiveKey: () => activeSourceKey,
  getContent: () => elements.sourceInput.value,
  getDrafts: () => userDrafts,
  getEntry: key => getImportEntry(key)
});
const { originalSourceTexts, sourceEdits, exportedFiles, unsavedSourceKeys,
  sourceTextForEditing, currentSourceChanged, isFileUnexported, hasUnsavedSources } = documentRevisions;
let studySpeechRunId = 0;
let studyPreferences = {
  mode: ["learn", "recall", "dictation"].includes(saved.studyMode) ? saved.studyMode : "learn",
  order: ["sequential", "random", "mistakes"].includes(saved.studyOrder) ? saved.studyOrder : "sequential",
  size: normalizeStudySize(saved.studySize),
  showRememberedAnswer: saved.studyShowRememberedAnswer !== false,
  fuzzyDictation: saved.studyFuzzyDictation !== false
};
const studyController = createStudyController({
  elements: {
    toggleButton: elements.studyToggleButton,
    entryReveal: elements.studyEntryReveal,
    entryMeta: elements.studyEntryMeta,
    progressActions: elements.studyProgressActions,
    progressImportButton: elements.studyProgressImportButton,
    progressExportButton: elements.studyProgressExportButton,
    rememberedOption: elements.studyRememberedOption,
    rememberedOptionInput: elements.studyRememberedOptionInput,
    fuzzyOption: elements.studyFuzzyOption,
    fuzzyOptionInput: elements.studyFuzzyOptionInput,
    headingProgressActions: elements.studyHeadingProgressActions,
    headingImportButton: elements.studyHeadingImportButton,
    headingExportButton: elements.studyHeadingExportButton,
    homeButton: elements.studyHomeButton,
    parseSection: elements.parseSettingsSection,
    playbackSection: elements.playbackSettingsSection,
    speechSection: elements.speechSettingsSection,
    assistSection: elements.assistSettingsSection,
    importInput: elements.studyImportInput,
    container: elements.parsedTableWrap
  },
  getContext: getStudyContext,
  isLocalPersistenceEnabled: () => appConfig.study?.localPersistence === true,
  renderContent: renderParsedTable,
  speak: speakStudyText,
  stopSpeech: stopStudySpeech,
  getPreferences: () => ({ ...studyPreferences }),
  savePreferences: saveStudyPreferences,
  onWorkspaceEnter: () => {
    isParsedView = true;
    elements.editorView.hidden = true;
    elements.parsedView.hidden = false;
    elements.parsedTableWrap.tabIndex = -1;
    updateTitleDisplay();
    syncParseModeToggle();
    if (isMobileSettings()) setSettingsSheetState("collapsed");
  },
  onWorkspaceExit: () => {
    updateTitleDisplay();
    syncParseModeToggle();
    if (isMobileSettings()) setSettingsSheetState("compact");
  },
  refreshSettingsHeight: refreshSettingsSheetHeight,
  setStatus,
  onCardChange: (vocab, lang) => updateTranslateLink(vocab, lang),
  t
});
const filesPanel = createFilesTree({
  list: elements.filesList,
  emptyState: elements.filesEmptyState,
  count: elements.filesCount,
  toolbar: elements.filesPanelContent.querySelector(".files-panel-heading"),
  appearance: FILE_GROUP_APPEARANCE,
  onOpen: (entry) => openFileEntry(entry),
  onDelete: (entry) => deleteFileEntry(entry),
  onClear: (kind) => clearFileGroup(kind),
  onAdd: (kind) => {
    if (kind === "drafts") elements.newFileButton.click();
    else if (kind === "uploaded-files") elements.localFileInput.click();
    else elements.folderInput.click();
  }
});
const saveSourceInputSettings = debounce(saveSettings, 250);
const documentLoader = createDocumentLoader({
  getDraft: id => userDrafts[id],
  getProtocol: () => window.location.protocol,
  buildSourceUrls: sourcePath => [
    new URL(`../${sourcePath}`, import.meta.url),
    new URL(`./${sourcePath}`, window.location.href),
    new URL(`/${sourcePath}`, window.location.origin)
  ],
  commitSource: ({ key, editKey = key, name, text, draft = false, file = false, sourceMode: mode }) => {
    if (mode) sourceMode = mode;
    activeTranslateSelection = { text: "", sourceLanguage: targetLanguage };
    elements.sourceInput.value = draft ? text : sourceTextForEditing(editKey, text);
    activeFileName = name;
    activeSourceKey = key;
    prepareDocumentSettings(key);
    if (draft || file || sourceMode !== "document") lastImportSourceKey = key;
    else lastDocumentPath = key;
    if (file) setStatus(t("sampleLoaded"));
    saveSettings();
    if (!file) setStatus(t("sampleLoaded"));
  },
  onLoading: () => setStatus(t("loading")),
  onFailure: (type, message) => setStatus(t(type, message))
});
const { loadSourcePath, loadFileObject } = documentLoader;

const documentController = createDocumentController({ document, window, navigator, elements,
  syncTranslationButtons: (...args) => syncTranslationButtons(...args),
  t: (...args) => t(...args),
  saveSettings: (...args) => saveSettings(...args),
  stopPlayback: (...args) => stopPlayback(...args),
  parseAndShow: (...args) => parseAndShow(...args),
  initTranslateWidget: (...args) => initTranslateWidget(...args),
  setSidePanelTab: (...args) => setSidePanelTab(...args),
  isMobileSettings: (...args) => isMobileSettings(...args),
  setSettingsSheetState: (...args) => setSettingsSheetState(...args),
  syncParseModeToggle: (...args) => syncParseModeToggle(...args),
  updateParagraphOptionsVisibility: (...args) => updateParagraphOptionsVisibility(...args),
  syncStudyAvailability: (...args) => syncStudyAvailability(...args),
  setStatus: (...args) => setStatus(...args),
  updateTranslateLink: (...args) => updateTranslateLink(...args),
  filesPanel,
  studyController,
  documentLoader,
  loadSourcePath: (...args) => loadSourcePath(...args),
  loadFileObject: (...args) => loadFileObject(...args),
  importedFiles,
  originalSourceTexts,
  sourceEdits,
  exportedFiles,
  unsavedSourceKeys,
  currentSourceChanged: (...args) => currentSourceChanged(...args),
  isFileUnexported: (...args) => isFileUnexported(...args),
  hasUnsavedSources: (...args) => hasUnsavedSources(...args),
  saveSourceInputSettings: (...args) => saveSourceInputSettings(...args),
  state: appState
});
const {
  initializeDrafts, syncSourceContext, autoLoadSample, getImportEntry, renderFilesPanel, openFileEntry,
  getActiveDraftId, deleteFileEntry, clearFileGroup, getValidSamplePath, getValidDocumentPath,
  getActiveFileKey, getActiveFileName, updateTitleDisplay, showParsed, showEditor
} = documentController;

init();

async function init() {
  try {
    appConfig = await loadRuntimeConfig();
    applyConfigDefaults();
    populateLanguageOptions();
    await populateSampleOptions();
    await populateDocumentOptions();
    initializeDrafts();
    restoreSettings();
    renderTranslatorPicker();
    bindEvents();
    initActionTooltips();
    initSettingsPanel();
    initFolderOutline();
    window.langReaderReady = true;
    refreshVoices();
    applyI18n();
    await autoLoadSample();
    syncStudyAvailability();
    sourceWarnings.show({ title: t("sourcePathsUnavailable"), message: t("sourcePathsSkipped"), close: t("sourcePathsClose") });
  } catch (error) {
    setStatus(t("loadFailed", error.message || String(error)));
  }
}

async function populateSampleOptions() {
  sampleOptions = await getSamplesWithManifest(appConfig, { onFailure: sourceWarnings.report });
}

async function populateDocumentOptions() {
  documentOptions = await getDocumentsWithManifest(appConfig, { onFailure: sourceWarnings.report });
}

function bindEvents() {
  viewEffects.observeTableLayout();
  translationUi.bindEvents();
  workspaceUi.bindEvents();
  studyController.bindEvents();
  documentController.bindEvents();

  playbackController.bindEvents();
  columnControls.bindEvents();
  settingsController.bindEvents();
  languageList.bindEvents();

}

function parseAndShow(keepPosition = true, { animate = true } = {}) {
  activeTranslateSelection = { text: "", sourceLanguage: targetLanguage };
  studyController.reset();
  const fileKey = getActiveFileKey();
  applyArticleSettings(fileKey);

  const openStudy = applyDocumentOptions();
  if (!shouldUseReaderMode() && !analyzeVocabularyStructure(elements.sourceInput.value).valid) {
    showSegmentRejection(elements.parseModeVocabBtn, {
      label: t("noWordListShort"),
      message: t("vocabularyUnavailable")
    });
    elements.parseModeSelect.value = "paragraph";
    parseModeTouchedByUser = true;
    syncParseModeToggle();
    updateParagraphOptionsVisibility();
  }
  const previousIndex = keepPosition ? activeItemIndex : 0;
  if (shouldUseReaderMode()) {
    parsedViewMode = "reader";
    readerBlocks = assignReaderItems(parseMarkdownReader(elements.sourceInput.value));
    items = createReaderPlaybackItems(readerBlocks);
  } else {
    parsedViewMode = "table";
    readerBlocks = [];
    items = parseInput(elements.sourceInput.value, {
      parseMode: elements.parseModeSelect.value,
      targetLanguage,
      translationLanguage,
      paragraph: {
        mode: elements.paragraphSplitSelect.value,
        pattern: elements.paragraphRegexInput.value
      },
      partRoles: getParserPartRoles(),
      partLanguages: columnLanguages
    });
  }

  const features = {
    hasTranslations: docHasTranslations(),
    hasExamples: !shouldUseReaderMode() && getParserPartRoles().includes("example"),
    isTable: !shouldUseReaderMode()
  };
  if (!saved.articleSettings) saved.articleSettings = {};
  if (!saved.articleSettings[fileKey]) saved.articleSettings[fileKey] = {};
  saved.articleSettings[fileKey].features = features;

  activeItemIndex = Math.min(previousIndex, Math.max(0, items.length - 1));
  playlist = createPlaylist(items, getPlaylistOptions());
  setPosition(playlist, activeItemIndex, 0);
  renderParsedTable();
  showParsed({ animate });
  syncStudyAvailability();
  refreshVoices();
  setStatus(items.length ? t("parseDone", items.length) : t("parseEmpty"));

  updateSidebarVisibilityByFeatures();
  saveSettings();
  if (openStudy) {
    if (getStudyContext().eligible && !elements.studyToggleButton.disabled) void studyController.enter();
    else showNotice(t("studyUnavailable"), elements.parseSettingsSection);
  }
}

function getStudyContext() {
  const key = getActiveFileKey();
  const { source, legacySource } = studySourceIdentity(key, getActiveFileName());

  const rawText = elements.sourceInput?.value || "";
  const parseMode = elements.parseModeSelect?.value || "vocabulary";
  const eligible = Boolean(
    isParsedView
    && parsedViewMode === "table"
    && parseMode === "vocabulary"
    && analyzeVocabularyStructure(rawText).valid
  );

  return {
    eligible,
    isParsedView,
    parsedViewMode,
    parseMode,
    items: eligible ? items : [],
    columnRoles: eligible ? getStudyColumnRoles(items) : [],
    source,
    legacySource,
    sourceName: getActiveFileName(),
    rawText,
    targetLanguage,
    translationLanguage,
    vocabularyValid: eligible
  };
}

function syncStudyAvailability() {
  const context = getStudyContext();
  studyController.updateAvailability({
    eligible: context.eligible,
    items: context.items,
    columnRoles: context.columnRoles
  });
}

async function speakStudyText(text, language) {
  stopStudySpeech();
  const runId = ++studySpeechRunId;
  syncSpeechSettings();
  const speechText = normalizeSpeechText(text, language);
  if (!speechText) return;
  try {
    await speech.speak(speechText, getSpeechOptions(language));
  } catch (error) {
    if (runId === studySpeechRunId && !/stopped|replaced/i.test(String(error?.message || error))) {
      setStatus(t("speechFailed"));
      showSpeechFailureNotice();
    }
  }
}

function stopStudySpeech() {
  studySpeechRunId += 1;
  if (isPlaying) stopPlayback({ silent: true });
  else speech.stop();
}

function renderParsedTable() {
  closeLanguagePickers();
  closeTagEditors();
  elements.parsedTableWrap.innerHTML = "";
  elements.parsedTableWrap.tabIndex = studyController.isActive() || !items.length ? -1 : 0;
  if (studyController.render()) return;
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = t("empty");
    elements.parsedTableWrap.append(empty);
    return;
  }

  if (parsedViewMode === "reader") {
    renderReaderView();
    saveSettings();
    return;
  }

  const columnCount = Math.max(...items.map((item) => item.parts.length));
  columnTags = normalizeColumnTags(columnTags, columnCount);
  columnRoles = normalizeRoleSettings(columnRoles,
    Array.from({ length: columnCount }, (_, index) => DEFAULT_ROLES[index] || "sentence"));
  columnLanguages = normalizeLanguageSettings(columnLanguages,
    Array.from({ length: columnCount }, (_, index) => defaultLanguageForColumn(index)));
  ensureColumnSettings(columnCount);

  renderVocabularyView(columnCount);
}
