import { DEFAULT_ROLES, DEFAULT_PARSER_ROLES, DEFAULT_TARGET_LANGUAGE, DEFAULT_TAG, REPEAT_INFINITY_VALUE } from "../core/config.js";
import { LANGUAGES, getSpeechLanguages, getLanguage, getLanguageLabel, getVoiceBaseName, htmlLangFor, isValidLanguageCode, isValidUiLanguage, normalizeDocumentLanguage, voiceMatchesLanguage } from "../i18n/languages.js";
import { I18N } from "../i18n/i18n.js";
import { normalizeConfigParseMode } from "./runtimeConfig.js";
import { recoverableDrafts } from "../files/fileState.js";
import { saveState } from "../core/storage.js";
import { normalizeStudySize } from "../study/session.js";
import { showSegmentRejection, clearSegmentRejection } from "../ui/customControls.js";
import { setEditorActionButton } from "../ui/editorActions.js";
import { SPEAKER_ON_SVG, SPEED_SVG } from "../ui/uiIcons.js";
import { analyzeVocabularyStructure, refreshItemMetadata } from "../parsing/parser.js";
import { parseDocumentOptions, stripFrontMatterComment } from "./documentOptions.js";
import { normalizeGapSeconds, gapSliderIndex, gapSecondsAtIndex } from "../playback/playbackGap.js";

export function createSettingsController({ state, services, elements, document, window, navigator, speech, languagePreferences, showNotice, setStatus, parseAndShow, renderParsedTable, syncSourceContext, renderFilesPanel, initTheme, initTranslateWidget, syncTranslationButtons, updateTranslationVisibility, docHasTranslations, buildReaderSpeechSegments = () => [], getActiveDraftId, getActiveFileKey, getValidSamplePath, getValidDocumentPath, getValidClickMode, getValidPlaybackUnit, getColumnCount, showParsed, showEditor, updatePlaybackButtons, updateTranslateLink, updateThemeButtonLabel, updatePanelToggleLabel, applyClickModeChange, pauseForModeChange, rerenderClickUnits, debounce, isFileUnexported }) {
  let documentSettingsKey = "";
  let pendingDocumentSettings = false;
  let previousDocumentOptions = {};
  const manualDocumentOptions = new Set();

  function documentProfile() {
    return { mode: elements.parseModeSelect.value, targetLanguage: state.targetLanguage,
      translationLanguage: state.translationLanguage, clickMode: elements.modeSelect.value,
      playbackUnit: elements.playbackUnitSelect.value, repeat: Number(elements.repeatInput.value),
      gap: Number(elements.gapInput.value), rate: Number(elements.rateInput.value),
      speechSource: elements.speechSourceSelect.value };
  }

  function applyDocumentProfile(profile) {
    if (profile.mode) elements.parseModeSelect.value = profile.mode;
    if (profile.targetLanguage) {
      state.targetLanguage = profile.targetLanguage;
      populateSpeechLanguageOptions();
      elements.targetLanguageSelect.value = state.targetLanguage;
    }
    if (profile.translationLanguage) {
      state.translationLanguage = profile.translationLanguage === "target" ? state.targetLanguage : profile.translationLanguage;
      populateSpeechLanguageOptions();
      elements.translationLanguageSelect.value = state.translationLanguage;
    }
    if (profile.clickMode) {
      elements.modeSelect.value = getValidClickMode(profile.clickMode);
      state.activeClickMode = elements.modeSelect.value;
    }
    if (profile.playbackUnit) elements.playbackUnitSelect.value = getValidPlaybackUnit(profile.playbackUnit);
    for (const key of ["repeat", "rate"]) if (profile[key] !== undefined) elements[`${key}Input`].value = profile[key];
    if (profile.gap !== undefined) elements.gapInput.value = normalizeGapSeconds(profile.gap);
    if (profile.speechSource) {
      elements.speechSourceSelect.value = profile.speechSource;
      elements.speechSourceSelect.dataset.currentSource = profile.speechSource;
    }
    syncGapInputs();
  }

  function prepareDocumentSettings(key) {
    state.saved.documentDefaults ||= documentProfile();
    documentSettingsKey = key;
    pendingDocumentSettings = true;
    previousDocumentOptions = {};
    manualDocumentOptions.clear();
    state.parseModeTouchedByUser = false;
    state.targetLanguageTouchedByUser = false;
    state.translationLanguageTouchedByUser = false;
    applyDocumentProfile({ ...state.saved.documentDefaults, ...state.saved.articleSettings?.[key] });
  }
  function applyConfigDefaults() {
    const defaults = state.appConfig.defaults || {};
    if (state.saved.uiLanguage === undefined) state.uiLanguage = isValidUiLanguage(defaults.uiLanguage) ? defaults.uiLanguage : "en";
    if (state.saved.targetLanguage === undefined) state.targetLanguage = getValidLanguageCode(defaults.targetLanguage, DEFAULT_TARGET_LANGUAGE);
    if (state.saved.translationLanguage === undefined) state.translationLanguage = getValidLanguageCode(defaults.translationLanguage, state.uiLanguage);
    if (state.saved.parseMode === undefined && defaults.parseMode) state.saved = { ...state.saved, parseMode: normalizeConfigParseMode(defaults.parseMode) };
    if (state.saved.readTranslations === undefined && defaults.readTranslations !== undefined) state.saved = { ...state.saved, readTranslations: Boolean(defaults.readTranslations) };
    if (state.saved.hideTranslations === undefined && defaults.hideTranslations !== undefined) state.saved = { ...state.saved, hideTranslations: Boolean(defaults.hideTranslations) };
    if (state.saved.theme === undefined) state.saved.theme = defaults.theme || "";
  }

  function populateLanguageOptions() {
    populateSelect(elements.uiLanguageSelect, LANGUAGES.map((language) => ({
      value: language.code,
      label: getLanguageLabel(language.code, language.code)
    })));
    populateSpeechLanguageOptions();
  }

  function populateSpeechLanguageOptions() {
    if (!elements.targetLanguageSelect?.append || !elements.translationLanguageSelect?.append) return;
    const languages = languagePreferences?.options() || getSpeechLanguages(speech?.getVoices() || [],
      [state.targetLanguage, state.translationLanguage, ...(state.columnLanguages || [])]);
    const entries = languages.map((language) => ({
      value: language.code,
      label: getLanguageLabel(language.code, state.uiLanguage) + (language.currentDocument ? " · " + t("currentDocumentLanguage") : "")
    }));
    populateSelect(elements.targetLanguageSelect, entries);
    populateSelect(elements.translationLanguageSelect, entries);
    elements.targetLanguageSelect.value = state.targetLanguage;
    elements.translationLanguageSelect.value = state.translationLanguage;
    services.languageList?.refresh();
  }

  function populateSelect(select, entries) {
    const previousValue = select.value;
    select.innerHTML = "";
    entries.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.value;
      option.textContent = entry.label;
      select.append(option);
    });
    if (entries.some((entry) => entry.value === previousValue)) select.value = previousValue;
  }

  function restoreSettings() {
    if (typeof state.saved.sourceText === "string" && state.saved.sourceText.trim()) {
      elements.sourceInput.value = state.saved.sourceText;
    }
    elements.uiLanguageSelect.value = state.uiLanguage;
    state.sourceMode = getValidSourceMode(state.saved.sourceMode);
    syncSourceContext();
    elements.targetLanguageSelect.value = state.targetLanguage;
    elements.translationLanguageSelect.value = state.translationLanguage;
    elements.parseModeSelect.value = getValidParseMode(state.saved.parseMode);
    elements.paragraphSplitSelect.value = state.saved.paragraphSplit || "newline";
    elements.paragraphRegexInput.value = state.saved.paragraphRegex || "\\s+-\\s+";
    elements.modeSelect.value = getValidClickMode(state.saved.mode);
    state.activeClickMode = elements.modeSelect.value;
    elements.playModeSelect.value = ["row", "column"].includes(state.saved.playMode) ? state.saved.playMode : "row";
    elements.playbackUnitSelect.value = getValidPlaybackUnit(state.saved.playbackUnit);
    elements.speechSourceSelect.value = ["all", "apple", "google", "microsoft"].includes(state.saved.speechSource) ? state.saved.speechSource : "all";
    elements.speechSourceSelect.dataset.currentSource = elements.speechSourceSelect.value;
    elements.repeatInput.value = state.saved.repeat || 1;
    elements.gapInput.value = normalizeGapSeconds(state.saved.gap);
    elements.partGapInput.value = normalizeGapSeconds(state.saved.partGap ?? elements.gapInput.value);
    elements.rateInput.value = state.saved.rate || 1;
    elements.volumeInput.value = state.saved.volume ?? state.saved.pitch ?? 1;
    elements.showTranslationsInput.checked = Boolean(state.saved.hideTranslations || state.saved.showTranslations === false);
    elements.readTranslationsInput.checked = Boolean(state.saved.readTranslations);
    syncGapInputs();
    updateRangeLabels();
    syncParseModeToggle();
    syncSpeechSourceButtons();
    updateParagraphOptionsVisibility();
    initTheme();
    initTranslateWidget();
    renderFilesPanel();
  }

  function getValidSourceMode(mode) {
    return mode === "import" || mode === "document" ? mode : "document";
  }

  function saveSettings() {
    const fileKey = getActiveFileKey();
    if (documentSettingsKey && fileKey !== documentSettingsKey) prepareDocumentSettings(fileKey);
    const draftId = getActiveDraftId();
    if (draftId) {
      state.userDrafts[draftId].content = elements.sourceInput.value;
      if (elements.sourceInput.value.trim()) state.userDrafts[draftId].provisional = false;
    }
    services.documentRevisions.saveWorkingCopy(draftId);

    if (fileKey && !pendingDocumentSettings) {
      if (!state.saved.articleSettings) state.saved.articleSettings = {};
      if (!state.saved.articleSettings[fileKey]) state.saved.articleSettings[fileKey] = {};
      state.saved.articleSettings[fileKey].clickMode = elements.modeSelect.value;
      state.saved.articleSettings[fileKey].playMode = elements.playModeSelect.value;
      state.saved.articleSettings[fileKey].playbackUnit = elements.playbackUnitSelect.value;
      state.saved.articleSettings[fileKey].hideTranslations = elements.showTranslationsInput.checked;
      state.saved.articleSettings[fileKey].readTranslations = elements.readTranslationsInput.checked;
      Object.assign(state.saved.articleSettings[fileKey], documentProfile());
    }

    state.saved = {
      languageList: state.saved.languageList,
      sourceText: elements.sourceInput.value,
      documentDefaults: state.saved.documentDefaults,
      sourceMode: state.sourceMode,
      samplePath: getValidSamplePath(
        state.sampleOptions.some((option) => option.path === state.activeSourceKey)
          ? state.activeSourceKey
          : state.saved.samplePath
      ),
      documentPath: getValidDocumentPath(state.lastDocumentPath),
      lastDocumentPath: getValidDocumentPath(state.lastDocumentPath),
      lastImportSourceKey: state.lastImportSourceKey,
      recentSourceKeys: state.saved.recentSourceKeys,
      sidePanelTab: state.sidePanelTab,
      uiLanguage: state.uiLanguage,
      targetLanguage: state.targetLanguage,
      translationLanguage: state.translationLanguage,
      targetLanguageTouchedByUser: state.targetLanguageTouchedByUser,
      translationLanguageTouchedByUser: state.translationLanguageTouchedByUser,
      parseMode: elements.parseModeSelect.value,
      paragraphSplit: elements.paragraphSplitSelect.value,
      paragraphRegex: elements.paragraphRegexInput.value,
      mode: elements.modeSelect.value,
      playMode: elements.playModeSelect.value,
      playbackUnit: elements.playbackUnitSelect.value,
      speechSource: elements.speechSourceSelect.value,
      repeat: elements.repeatInput.value,
      gap: elements.gapInput.value,
      partGap: elements.partGapInput.value,
      rate: elements.rateInput.value,
      volume: elements.volumeInput.value,
      voiceName: elements.voiceSelect.value,
      voiceNamesByLanguage: state.voiceNamesByLanguage,
      translationProvider: state.translationProvider,
      hideTranslations: elements.showTranslationsInput.checked,
      readTranslations: elements.readTranslationsInput.checked,
      studyMode: state.studyPreferences.mode,
      studyOrder: state.studyPreferences.order,
      studySize: state.studyPreferences.size,
      studyShowRememberedAnswer: state.studyPreferences.showRememberedAnswer,
      studyFuzzyDictation: state.studyPreferences.fuzzyDictation,
      columnRoles: state.columnRoles,
      columnLanguages: state.columnLanguages,
      columnWidths: state.columnWidths,
      columnTags: state.columnTags,
      hiddenPreviousRoles: state.hiddenPreviousRoles,
      manualColumnLanguages: state.manualColumnLanguages,
      theme: state.saved.theme,
      translateConsentGranted: state.saved.translateConsentGranted,
      userDrafts: recoverableDrafts(state.userDrafts),
      exportedFiles: Object.fromEntries(services.exportedFiles),
      sourceEdits: Object.fromEntries(services.sourceEdits),
      activeFileName: state.activeFileName,
      activeSourceKey: state.activeSourceKey,
      unsavedSourceKeys: [...services.unsavedSourceKeys],
      articleSettings: state.saved.articleSettings
    };
    services.filesPanel.setModified(state.activeSourceKey, isFileUnexported(state.activeSourceKey));
    return saveState(state.saved);
  }

  function saveStudyPreferences(next) {
    state.studyPreferences = {
      mode: ["learn", "recall", "dictation"].includes(next?.mode) ? next.mode : state.studyPreferences.mode,
      order: ["sequential", "random", "mistakes"].includes(next?.order) ? next.order : state.studyPreferences.order,
      size: Object.hasOwn(next || {}, "size") ? normalizeStudySize(next.size) : state.studyPreferences.size,
      showRememberedAnswer: next?.showRememberedAnswer !== false,
      fuzzyDictation: next?.fuzzyDictation !== false
    };
    saveSettings();
  }

  function refreshVoices() {
    window.setTimeout(() => {
      populateSpeechLanguageOptions();
      if (documentSettingsKey && speech.getVoices().length && !isSpeechSourceAvailable(elements.speechSourceSelect.value)) {
        const requested = elements.speechSourceSelect.value;
        elements.speechSourceSelect.value = "all";
        elements.speechSourceSelect.dataset.currentSource = "all";
        syncSpeechSourceButtons();
        showNotice(t("speechSourceUnavailable", getSpeechSourceLabel(requested)), elements.speechSettingsSection);
        saveSettings();
      }
      const sourceVoices = filterVoicesBySource(speech.getVoices(), elements.speechSourceSelect.value);
      const voices = filterVoicesByActiveLanguages(sourceVoices);
      const defaultVoice = pickDefaultVoice(voices, state.targetLanguage);
      const groups = groupVoicesByName(voices, defaultVoice, state.targetLanguage);
      elements.voiceSelect.innerHTML = "";
      for (const group of groups) {
        const option = document.createElement("option");
        option.value = group.name;
        option.textContent = formatVoiceGroupLabel(group, elements.speechSourceSelect.value);
        elements.voiceSelect.append(option);
      }
      if (!groups.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = t("noVoices");
        elements.voiceSelect.append(option);
      }
      const savedVoiceBaseName = getVoiceBaseName(state.saved.voiceName);
      const fallbackVoice = defaultVoice || voices[0];
      const fallbackVoiceBaseName = getVoiceBaseName(fallbackVoice?.name);
      const preferred = groups.some((group) => group.name === savedVoiceBaseName)
        ? savedVoiceBaseName
        : fallbackVoiceBaseName || "";
      if (preferred) elements.voiceSelect.value = preferred;
      speech.setVoice(elements.voiceSelect.value);
      renderLanguageVoiceControls(sourceVoices);
      speech.setVoicesByLanguage(state.voiceNamesByLanguage);
    }, 150);
  }

  function handleSpeechSourceChange() {
    const nextSource = elements.speechSourceSelect.value;
    const previousSource = elements.speechSourceSelect.dataset.currentSource || "all";
    if (!isSpeechSourceAvailable(nextSource)) {
      elements.speechSourceSelect.value = previousSource;
      setStatus(t("speechSourceUnavailable", getSpeechSourceLabel(nextSource)));
      const sourceButton = elements[`speechSource${nextSource.charAt(0).toUpperCase() + nextSource.slice(1)}`];
      refreshVoices();
      syncSpeechSourceButtons();
      showSegmentRejection(sourceButton, {
        label: t("noVoiceShort"),
        message: t("speechSourceUnavailable", getSpeechSourceLabel(nextSource))
      });
      return;
    }
    [elements.speechSourceGoogle, elements.speechSourceApple, elements.speechSourceMicrosoft].forEach(clearSegmentRejection);
    manualDocumentOptions.add("speechSource");
    elements.speechSourceSelect.dataset.currentSource = nextSource;
    state.voiceNamesByLanguage = {};
    elements.voiceSelect.value = "";
    refreshVoices();
    saveSettings();
    syncSpeechSourceButtons();
  }

  function isSpeechSourceAvailable(source) {
    if (source === "all") return true;
    const sourceVoices = filterVoicesBySource(speech.getVoices(), source);
    if (!sourceVoices.length) return false;
    return [...getActiveSpeechLanguages()].every((language) => sourceVoices.some((voice) => voiceMatchesLanguage(voice, language)));
  }

  function getSpeechSourceLabel(source) {
    if (source === "apple") return t("appleSpeech");
    if (source === "google") return t("googleSpeech");
    if (source === "microsoft") return t("microsoftSpeech");
    return t("allSpeech");
  }

  function showSpeechFailureNotice() {
    const source = elements.speechSourceSelect.value;
    if (source === "google" || source === "microsoft") {
      const sourceButton = elements[`speechSource${source.charAt(0).toUpperCase() + source.slice(1)}`];
      showNotice(t("selectedSpeechFailed", getSpeechSourceLabel(source)), sourceButton?.parentElement);
    }
  }

  function renderLanguageVoiceControls(sourceVoices) {
    elements.languageVoiceControls.innerHTML = "";
    const languages = [...getActiveSpeechLanguages()];
    languages.forEach((language) => {
      const languageVoices = sourceVoices.filter((voice) => voiceMatchesLanguage(voice, language));
      const defaultVoice = pickDefaultVoice(languageVoices, language);
      const groups = groupVoicesByName(languageVoices, defaultVoice, language);
      if (!groups.length) return;
      const label = document.createElement("label");
      const title = document.createElement("span");
      title.textContent = getLanguage(language).short;
      const select = document.createElement("select");
      groups.forEach((group) => {
        const option = document.createElement("option");
        option.value = group.name;
        option.textContent = formatVoiceGroupLabel(group, elements.speechSourceSelect.value);
        select.append(option);
      });
      const savedLanguageVoice = getVoiceBaseName(state.voiceNamesByLanguage[language]);
      const fallback = getVoiceBaseName(defaultVoice?.name || groups[0]?.name);
      select.value = groups.some((group) => group.name === savedLanguageVoice) ? savedLanguageVoice : fallback;
      state.voiceNamesByLanguage[language] = select.value;
      select.addEventListener("change", () => {
        state.voiceNamesByLanguage = { ...state.voiceNamesByLanguage, [language]: select.value };
        speech.setVoicesByLanguage(state.voiceNamesByLanguage);
        saveSettings();
      });
      const surface = document.createElement("span");
      surface.className = "settings-select-surface";
      surface.append(select);
      label.append(title, surface);
      elements.languageVoiceControls.append(label);
    });
  }

  function applyDocumentOptions() {
    const key = getActiveFileKey();
    if (key !== documentSettingsKey) prepareDocumentSettings(key);
    const options = parseDocumentOptions(elements.sourceInput.value);
    const firstParse = pendingDocumentSettings;
    if (firstParse && !manualDocumentOptions.has("mode") && state.saved.articleSettings?.[key]?.mode) elements.parseModeSelect.value = state.saved.articleSettings[key].mode;
    const changed = Object.fromEntries(Object.entries(options).filter(([name, value]) =>
      !manualDocumentOptions.has(name) && (firstParse || previousDocumentOptions[name] !== value)));
    previousDocumentOptions = options;
    applyDocumentProfile(changed);
    pendingDocumentSettings = false;
    const enterStudy = changed.workspace === "study" && elements.parseModeSelect.value === "vocabulary";
    syncParseModeToggle();
    updateRangeLabels();
    syncSpeechSourceButtons();
    updateParagraphOptionsVisibility();
    return enterStudy;
  }

  function getDocumentLanguages() {
    return [previousDocumentOptions.targetLanguage,
      previousDocumentOptions.translationLanguage === "target" ? previousDocumentOptions.targetLanguage || state.targetLanguage : previousDocumentOptions.translationLanguage];
  }

  function shouldUseReaderMode() {
    return elements.parseModeSelect.value === "paragraph";
  }

  function getPlaylistOptions() {
    const repeatValue = Number(elements.repeatInput.value);
    return {
      mode: elements.modeSelect.value,
      repeat: repeatValue >= REPEAT_INFINITY_VALUE ? Number.POSITIVE_INFINITY : repeatValue,
      gapMs: Number(elements.gapInput.value) * 1000,
      partGapMs: Number(elements.partGapInput.value) * 1000
    };
  }

  function syncGapInputs() {
    elements.gapInput.value = normalizeGapSeconds(elements.gapInput.value);
    elements.partGapInput.value = elements.gapInput.value;
    if (elements.gapSlider) {
      elements.gapSlider.value = gapSliderIndex(elements.gapInput.value);
      elements.gapSlider.setAttribute("aria-valuetext", `${elements.gapInput.value}s`);
    }
  }

  function getParserPartRoles({ includeSilent = false } = {}) {
    const count = Math.max(state.columnRoles.length, state.columnTags.length, DEFAULT_PARSER_ROLES.length);
    return Array.from({ length: count }, (_, index) => {
      if (!includeSilent && (state.columnRoles[index] === "mute" || state.columnRoles[index] === "hide")) return state.columnRoles[index];
      const tag = cleanTag(state.columnTags[index] || "");
      if (tag.includes("translation") || tag.includes("translate") || tag.includes("翻译")) return "translation";
      if (tag.includes("word") || tag.includes("vocab") || tag.includes("单词")) return "word";
      return DEFAULT_PARSER_ROLES[index] || "sentence";
    });
  }

  function refreshColumnMetadata(index) {
    if (state.parsedViewMode === "reader") return;
    const role = getParserPartRoles({ includeSilent: true })[index];
    for (const item of state.items) {
      if (["section", "instruction"].includes(item.sourceType) || !item.parts?.[index]) continue;
      item.parts[index].role = role;
      refreshItemMetadata(item);
    }
  }

  function getStudyColumnRoles(targetItems = state.items) {
    const columnCount = Math.max(
      state.columnTags.length,
      DEFAULT_PARSER_ROLES.length,
      ...(targetItems || []).map((item) => item.parts?.length || 0)
    );
    return Array.from({ length: columnCount }, (_, index) => {
      const tag = cleanTag(state.columnTags[index] || "");
      if (tag.includes("translation") || tag.includes("translate") || tag.includes("meaning") || tag.includes("bedeutung") || tag.includes("翻译")) return "translation";
      if (tag.includes("word") || tag.includes("vocab") || tag.includes("单词")) return "word";
      const parserRole = (targetItems || []).find((item) => item.parts?.[index]?.role)?.parts[index].role;
      if (parserRole === "word" || parserRole === "translation") return parserRole;
      return DEFAULT_PARSER_ROLES[index] || "sentence";
    });
  }

  function getEffectivePartRole(part, columnIndex) {
    if (part?.role === "section") return "section";
    const columnState = state.columnRoles[columnIndex] || "sentence";
    if (columnState === "mute" || columnState === "hide") return columnState;
    if (part?.role === "translation" || isTranslationColumn(columnIndex)) return "translation";
    return "sentence";
  }

  function ensureColumnSettings(columnCount) {
    while (state.columnRoles.length < columnCount) state.columnRoles.push(DEFAULT_ROLES[state.columnRoles.length] || "sentence");
    while (state.columnLanguages.length < columnCount) state.columnLanguages.push(defaultLanguageForColumn(state.columnLanguages.length));
    while (state.columnTags.length < columnCount) state.columnTags.push(getDefaultColumnTag(state.columnTags.length));
    while (state.manualColumnLanguages.length < columnCount) state.manualColumnLanguages.push(false);
    state.columnLanguages = state.columnLanguages.map((language, index) => {
      if (!state.manualColumnLanguages[index] && isTranslationColumn(index) && language === state.targetLanguage) return state.uiLanguage;
      return language || defaultLanguageForColumn(index);
    });
  }

  function isTranslationColumn(index) {
    return cleanTag(state.columnTags[index]).includes("translation") || cleanTag(state.columnTags[index]).includes("translate") || cleanTag(state.columnTags[index]).includes("翻译");
  }

  function updateRangeLabels() {
    const repeat = Number(elements.repeatInput.value);
    elements.repeatValue.textContent = repeat >= REPEAT_INFINITY_VALUE ? t("infinite") : String(repeat);
    elements.gapValue.textContent = `${Number(elements.gapInput.value)}s`;
    elements.partGapValue.textContent = `${Number(elements.partGapInput.value).toFixed(2).replace(/\.00$/, "")}s`;
    elements.rateValue.textContent = `x${Number(elements.rateInput.value).toFixed(2).replace(/0$/, "")}`;
    elements.volumeValue.textContent = `${Math.round(Number(elements.volumeInput.value) * 100)}%`;
  }

  function applyArticleSettings(fileKey) {
    if (!fileKey) return;
    if (!state.saved.articleSettings) state.saved.articleSettings = {};
    const settings = state.saved.articleSettings[fileKey];
    if (settings) {
      if (settings.clickMode !== undefined) {
        elements.modeSelect.value = getValidClickMode(settings.clickMode);
        state.activeClickMode = elements.modeSelect.value;
      }
      if (settings.playMode !== undefined) elements.playModeSelect.value = settings.playMode;
      if (settings.playbackUnit !== undefined) elements.playbackUnitSelect.value = getValidPlaybackUnit(settings.playbackUnit);

      if (settings.hideTranslations !== undefined) {
        elements.showTranslationsInput.checked = Boolean(settings.hideTranslations);
        updateTranslationVisibility();
      }
      if (settings.readTranslations !== undefined) {
        elements.readTranslationsInput.checked = Boolean(settings.readTranslations);
      }

      syncTranslationButtons();
      updateRangeLabels();
      updateParagraphOptionsVisibility();
    }
  }

  function updateSidebarVisibilityByFeatures() {
    elements.playbackUnitSelect.querySelector('[value="paragraph"]').textContent = t(shouldUseReaderMode() ? "clickParagraph" : "cell");
    const fileKey = getActiveFileKey();
    const settings = state.saved.articleSettings?.[fileKey] || {};
    const features = {
      hasTranslations: docHasTranslations(),
      hasExamples: !shouldUseReaderMode() && getParserPartRoles().includes("example"),
      isTable: !shouldUseReaderMode()
    };

    const showTransWidget = state.isParsedView && features.hasTranslations && state.parsedViewMode === "reader" && !services.studyController.isActive();
    syncTranslationButtons();
    elements.toggleTranslationButton.style.display = showTransWidget ? "" : "none";
    elements.translationLanguageLabel.style.display = (showTransWidget && shouldUseReaderMode()) ? "" : "none";

    if (!showTransWidget) {
      elements.toggleReadTranslationButton.classList.add("collapsed");
    } else {
      const hideTrans = elements.showTranslationsInput.checked;
      elements.toggleReadTranslationButton.classList.toggle("collapsed", !shouldUseReaderMode() || hideTrans);
    }

    const playModeLabel = elements.playModeSelect.closest("label");
    if (playModeLabel) {
      playModeLabel.style.display = features.isTable ? "" : "none";
    }

    const cellOption = elements.modeSelect.querySelector('option[value="cell"]');
    if (cellOption) {
      cellOption.style.display = features.isTable ? "" : "none";
      cellOption.disabled = !features.isTable;
    }
    if (!features.isTable && elements.modeSelect.value === "cell") {
      elements.modeSelect.value = "sentence";
      state.activeClickMode = "sentence";
    }
  }

  function updateParagraphOptionsVisibility() {
    const isReader = shouldUseReaderMode();
    elements.paragraphOptions.hidden = true;
    elements.translationLanguageLabel.hidden = !isReader;
    elements.hideTranslationsLabel.hidden = !isReader;
    elements.readTranslationsLabel.hidden = !isReader || elements.showTranslationsInput.checked;
    elements.paragraphRegexLabel.hidden = elements.paragraphSplitSelect.value !== "regex";
    elements.paragraphExamples.hidden = true;
    updateSidebarVisibilityByFeatures();
  }

  function syncParseModeToggle() {
    const isReader = shouldUseReaderMode();
    const isStudy = services.studyController.isActive();
    if (elements.parseModeVocabBtn) {
      elements.parseModeVocabBtn.classList.toggle("active", !isReader && !isStudy);
    }
    if (elements.parseModeReaderBtn) {
      elements.parseModeReaderBtn.classList.toggle("active", isReader);
    }
    if (elements.studyToggleButton) {
      elements.studyToggleButton.classList.toggle("active", isStudy);
    }
    updateSidebarVisibilityByFeatures();
    services.studyController.syncUi();
  }

  function syncSpeechSourceButtons() {
    const val = elements.speechSourceSelect.value;
    if (elements.speechSourceAll) {
      elements.speechSourceAll.classList.toggle("active", val === "all");
    }
    if (elements.speechSourceApple) {
      elements.speechSourceApple.classList.toggle("active", val === "apple");
    }
    if (elements.speechSourceGoogle) {
      elements.speechSourceGoogle.classList.toggle("active", val === "google");
    }
    if (elements.speechSourceMicrosoft) {
      elements.speechSourceMicrosoft.classList.toggle("active", val === "microsoft");
    }
  }

  function applyI18n() {
    const wasParsedView = state.isParsedView;
    setEditorActionButton(elements.newFileButton, "new", t("newDraftAction"));
    setEditorActionButton(elements.copyContentButton, "copy", t("copyAction"));
    [elements.parseModeVocabBtn, elements.speechSourceGoogle, elements.speechSourceApple, elements.speechSourceMicrosoft].forEach(clearSegmentRejection);
    document.documentElement.lang = htmlLangFor(state.uiLanguage);
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    });
    document.querySelectorAll("[data-i18n-title]").forEach((node) => {
      node.title = t(node.dataset.i18nTitle);
      node.setAttribute("aria-label", t(node.dataset.i18nTitle));
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
      node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
    });
    syncSourceContext();
    renderFilesPanel();
    updateTargetLanguageLabels();
    elements.sourceInput.placeholder = t("inputPlaceholder");
    if (wasParsedView) showParsed();
    else showEditor();
    updateRangeLabels();
    syncParseModeToggle();
    updatePlaybackButtons();
    updateTranslateLink();
    updateThemeButtonLabel();
    updatePanelToggleLabel();
    services.studyController.applyI18n();
    populateSpeechLanguageOptions();
  }

  function t(key, ...args) {
    const value = I18N[state.uiLanguage]?.[key] ?? I18N.en[key] ?? key;
    return typeof value === "function" ? value(...args) : value;
  }

  function updateTargetLanguageLabels() {
    populateSpeechLanguageOptions();
  }

  function getValidParseMode(value) {
    return value === "paragraph" ? "paragraph" : "vocabulary";
  }

  function getValidLanguageCode(value, fallback = "en") {
    return isValidLanguageCode(value) ? normalizeDocumentLanguage(value) : fallback;
  }

  function getActiveSpeechLanguages() {
    const languages = new Set([state.targetLanguage]);
    const translationEnabled = !elements.showTranslationsInput.checked;
    if (state.parsedViewMode === "reader" && docHasTranslations() && translationEnabled) {
      languages.add(state.translationLanguage);
    }
    if (state.parsedViewMode === "reader") {
      return languages;
    }
    if (state.items.some(item => item.sourceType === "section" && buildReaderSpeechSegments(item.parts[0]?.text)
      .some(segment => segment.isTranslation))) languages.add(state.translationLanguage);
    state.columnLanguages.forEach((language, index) => {
      if (language && state.columnRoles[index] !== "mute" && state.columnRoles[index] !== "hide") languages.add(language);
    });
    return languages;
  }

  function filterVoicesByActiveLanguages(voices) {
    const activeLanguages = getActiveSpeechLanguages();
    return voices.filter(voice => [...activeLanguages].some(language => voiceMatchesLanguage(voice, language)));
  }

  function groupVoicesByName(voices, defaultVoice, defaultLanguage = state.targetLanguage) {
    const groups = new Map();
    voices.forEach((voice) => {
      const name = getVoiceBaseName(voice.name);
      if (!groups.has(name)) groups.set(name, { name, voices: [], isDefault: false });
      const group = groups.get(name);
      group.voices.push(voice);
      group.isDefault = group.isDefault || (voice.name === defaultVoice?.name && voiceMatchesLanguage(voice, defaultLanguage));
    });
    return [...groups.values()].sort((a, b) => {
      if (elements.speechSourceSelect.value === "all") {
        const priority = { google: 0, apple: 1, microsoft: 2, unknown: 3 };
        const sourceDifference = priority[getVoiceSource(a.voices[0])] - priority[getVoiceSource(b.voices[0])];
        if (sourceDifference) return sourceDifference;
      }
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  function formatVoiceGroupLabel(group, source = "all") {
    const langs = [...new Set(group.voices.map((voice) => voice.lang))].sort().join(", ");
    const provider = getVoiceSource(group.voices[0]);
    const name = group.name.replace(/^(?:Google|Apple|Microsoft)[\s_-]*/i, "").trim() || "?";
    const providerMark = { google: "G", apple: "A", microsoft: "M", unknown: "?" }[provider];
    return `${source === "all" ? `${providerMark} - ` : ""}${name} (${langs})`;
  }

  function pickDefaultVoice(voices, language = state.targetLanguage) {
    const preferred = (candidates) => {
      if (elements.speechSourceSelect.value !== "all") {
        return candidates.find((voice) => voice.default) || candidates[0];
      }
      const priority = { google: 0, apple: 1, microsoft: 2, unknown: 3 };
      return [...candidates].sort((a, b) =>
        priority[getVoiceSource(a)] - priority[getVoiceSource(b)] || Number(b.default) - Number(a.default)
      )[0];
    };
    return preferred(voices.filter(voice => voiceMatchesLanguage(voice, language)));
  }

  function languageCodeFromVoice(voice) {
    return normalizeDocumentLanguage(voice.lang);
  }

  function filterVoicesBySource(voices, source) {
    if (source === "all") return voices;
    return voices.filter((voice) => getVoiceSource(voice) === source);
  }

  function getVoiceSource(voice) {
    const signature = `${voice.name || ""} ${voice.voiceURI || ""}`;
    if (/google/i.test(signature)) return "google";
    if (/microsoft|online/i.test(signature)) return "microsoft";
    if (/apple|com\.apple/i.test(signature)) return "apple";
    if (/(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent || "") && voice.localService !== false) return "apple";
    return "unknown";
  }

  function normalizeSettings(value, defaults) {
    const source = Array.isArray(value) ? value : [];
    return defaults.map((fallback, index) => source[index] || fallback);
  }

  function normalizeLanguageSettings(value, defaults) {
    const source = Array.isArray(value) ? value : [];
    return defaults.map((fallback, index) => getValidLanguageCode(source[index], fallback));
  }

  function normalizeColumnTags(value, columnCount) {
    const source = Array.isArray(value) ? value : [];
    return Array.from({ length: columnCount }, (_, index) => {
      const inferred = getDefaultColumnTag(index);
      const existing = cleanTag(source[index]);
      if (source[index]) return existing;
      return existing === DEFAULT_TAG && inferred !== DEFAULT_TAG ? inferred : existing;
    });
  }

  function getDefaultColumnTag(index) {
    const fromParsedHeader = state.items.find((item) => item.parts[index]?.label)?.parts[index]?.label;
    const fromParsedRole = state.items.find((item) => item.parts[index]?.role && item.parts[index].role !== "mute")?.parts[index]?.role;
    return cleanTag(fromParsedHeader || (fromParsedRole === "translation" ? "translate" : fromParsedRole) || DEFAULT_TAG);
  }

  function migrateRoleTags(roles = []) {
    if (!Array.isArray(roles)) return [];
    return roles.map((role) => {
      if (role === "translationMute") return "translation";
      if (["word", "sentence", "translation"].includes(role)) return role;
      return DEFAULT_TAG;
    });
  }

  function cleanTag(value) {
    return String(value || DEFAULT_TAG).trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase() || DEFAULT_TAG;
  }

  function normalizeRoleSettings(value, defaults) {
    const source = Array.isArray(value) ? value : [];
    return defaults.map((fallback, index) => normalizeSingleRole(source[index] || fallback));
  }

  function normalizeSingleRole(value) {
    const valid = new Set(["sentence", "mute", "hide"]);
    const role = value === "skip" || value === "translationMute" ? "mute" : value;
    if (role === "word" || role === "translation") return "sentence";
    return valid.has(role) ? role : "sentence";
  }

  function getDefaultColumnLanguages() {
    return DEFAULT_ROLES.map((_, index) => defaultLanguageForColumn(index));
  }

  function defaultLanguageForRole(role) {
    return state.targetLanguage;
  }

  function defaultLanguageForColumn(index) {
    return isTranslationColumn(index) ? state.uiLanguage : state.targetLanguage;
  }

  function applyDefaultLanguagesForRoles({ previousUiLanguage, previousTargetLanguage } = {}) {
    state.columnLanguages = state.columnLanguages.map((language, index) => {
      if (state.manualColumnLanguages[index]) return language;
      const role = state.columnRoles[index] || "skip";
      if (role !== "mute" && role !== "hide" && (!language || language === previousTargetLanguage)) return defaultLanguageForColumn(index);
      return language;
    });
  }

  function bindEvents() {
    elements.uiLanguageSelect.addEventListener("change", () => {
      const previousUiLanguage = state.uiLanguage;
      state.uiLanguage = elements.uiLanguageSelect.value;
      if (state.translationLanguage === previousUiLanguage && !previousDocumentOptions.translationLanguage && !manualDocumentOptions.has("translationLanguage")) {
        state.translationLanguage = state.uiLanguage;
        elements.translationLanguageSelect.value = state.translationLanguage;
      }
      applyDefaultLanguagesForRoles({ previousUiLanguage });
      saveSettings();
      applyI18n();
      renderParsedTable();
    });

    elements.targetLanguageSelect.addEventListener("change", () => {
      manualDocumentOptions.add("targetLanguage");
      const previousTargetLanguage = state.targetLanguage;
      state.targetLanguageTouchedByUser = true;
      state.targetLanguage = elements.targetLanguageSelect.value;
      applyDefaultLanguagesForRoles({ previousTargetLanguage });
      saveSettings();
      if (state.isParsedView) parseAndShow();
    });

    elements.translationLanguageSelect.addEventListener("change", () => {
      manualDocumentOptions.add("translationLanguage");
      state.translationLanguageTouchedByUser = true;
      state.translationLanguage = elements.translationLanguageSelect.value;
      saveSettings();
      if (state.isParsedView && shouldUseReaderMode()) parseAndShow();
      else refreshVoices();
    });


    elements.parseModeVocabBtn.addEventListener("click", () => {
      if (services.studyController.isActive()) {
        services.studyController.exit();
        return;
      }
      if (elements.parseModeSelect.value === "vocabulary") return;
      if (!analyzeVocabularyStructure(elements.sourceInput.value).valid) {
        showSegmentRejection(elements.parseModeVocabBtn, {
          label: t("noWordListShort"),
          message: t("vocabularyUnavailable")
        });
        return;
      }
      clearSegmentRejection(elements.parseModeVocabBtn);
      elements.parseModeSelect.value = "vocabulary";
      elements.parseModeSelect.dispatchEvent(new Event("change"));
    });

    elements.parseModeReaderBtn.addEventListener("click", () => {
      if (services.studyController.isActive()) services.studyController.exit();
      if (elements.parseModeSelect.value === "paragraph") return;
      elements.parseModeSelect.value = "paragraph";
      elements.parseModeSelect.dispatchEvent(new Event("change"));
    });

    ["all", "apple", "google", "microsoft"].forEach(source => {
      const btn = elements[`speechSource${source.charAt(0).toUpperCase() + source.slice(1)}`];
      if (btn) {
        btn.addEventListener("click", () => {
          if (elements.speechSourceSelect.value === source) return;
          elements.speechSourceSelect.value = source;
          elements.speechSourceSelect.dispatchEvent(new Event("change"));
        });
      }
    });

    elements.paragraphSplitSelect.addEventListener("change", () => {
      updateParagraphOptionsVisibility();
      saveSettings();
      if (state.isParsedView && elements.parseModeSelect.value === "paragraph") parseAndShow();
    });

    elements.paragraphRegexInput.addEventListener("input", debounce(() => {
      saveSettings();
      if (state.isParsedView && elements.parseModeSelect.value === "paragraph") parseAndShow();
    }, 300));

    [
      elements.parseModeSelect,
      elements.modeSelect,
      elements.playModeSelect,
      elements.playbackUnitSelect,
      elements.repeatInput,
      elements.gapInput,
      elements.partGapInput,
      elements.rateInput,
      elements.volumeInput,
      elements.voiceSelect
    ].forEach((element) => element.addEventListener("change", () => {
      const names = new Map([[elements.parseModeSelect, "mode"], [elements.modeSelect, "clickMode"],
        [elements.playbackUnitSelect, "playbackUnit"], [elements.repeatInput, "repeat"],
        [elements.gapInput, "gap"], [elements.partGapInput, "gap"], [elements.rateInput, "rate"]]);
      if (names.has(element)) manualDocumentOptions.add(names.get(element));
      if (element === elements.parseModeSelect) state.parseModeTouchedByUser = true;
      if (element === elements.modeSelect) applyClickModeChange(elements.modeSelect.value);
      updateRangeLabels();
      syncParseModeToggle();
      updateParagraphOptionsVisibility();
      saveSettings();
      if (state.isParsedView && element === elements.parseModeSelect) parseAndShow(false);
      else if (state.isParsedView && (element === elements.modeSelect || element === elements.playbackUnitSelect)) rerenderClickUnits();
    }));

    elements.speechSourceSelect.addEventListener("change", handleSpeechSourceChange);

    for (const type of ["input", "change"]) {
      elements.gapSlider?.addEventListener(type, () => {
        elements.gapInput.value = gapSecondsAtIndex(elements.gapSlider.value);
        syncGapInputs();
        elements.gapInput.dispatchEvent(new Event(type, { bubbles: true }));
      });
    }

    [elements.repeatInput, elements.gapInput, elements.partGapInput, elements.rateInput, elements.volumeInput].forEach((element) => {
      element.addEventListener("input", () => {
        const name = element === elements.repeatInput ? "repeat" : element === elements.rateInput ? "rate" : element === elements.gapInput || element === elements.partGapInput ? "gap" : "";
        if (name) manualDocumentOptions.add(name);
        if (element === elements.gapInput) syncGapInputs();
        updateRangeLabels();
        saveSettings();
      });
    });


    document.querySelector("#settingsVolumeIcon").innerHTML = SPEAKER_ON_SVG;
    document.querySelector("#settingsSpeedIcon").innerHTML = SPEED_SVG;
    const settingsPanel = document.querySelector("#settingsPanelContent");
    document.addEventListener("keydown", event => {
      if (event.key === "Tab") settingsPanel.classList.add("keyboard-navigation");
    });
    document.addEventListener("pointerdown", () => settingsPanel.classList.remove("keyboard-navigation"), true);
  }

  return { prepareDocumentSettings, getDocumentLanguages, applyConfigDefaults, populateLanguageOptions, populateSpeechLanguageOptions, populateSelect, restoreSettings, getValidSourceMode, saveSettings, saveStudyPreferences, refreshVoices, handleSpeechSourceChange, isSpeechSourceAvailable, getSpeechSourceLabel, showSpeechFailureNotice, renderLanguageVoiceControls, applyDocumentOptions, parseDocumentOptions, stripFrontMatterComment, shouldUseReaderMode, getPlaylistOptions, syncGapInputs, getParserPartRoles, refreshColumnMetadata, getStudyColumnRoles, getEffectivePartRole, ensureColumnSettings, isTranslationColumn, updateRangeLabels, applyArticleSettings, updateSidebarVisibilityByFeatures, updateParagraphOptionsVisibility, syncParseModeToggle, syncSpeechSourceButtons, applyI18n, t, updateTargetLanguageLabels, getValidParseMode, getValidLanguageCode, getActiveSpeechLanguages, filterVoicesByActiveLanguages, groupVoicesByName, formatVoiceGroupLabel, pickDefaultVoice, languageCodeFromVoice, filterVoicesBySource, getVoiceSource, normalizeSettings, normalizeLanguageSettings, normalizeColumnTags, getDefaultColumnTag, migrateRoleTags, cleanTag, normalizeRoleSettings, normalizeSingleRole, getDefaultColumnLanguages, defaultLanguageForRole, defaultLanguageForColumn, applyDefaultLanguagesForRoles, bindEvents };
}
