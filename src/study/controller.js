import {
  buildStudyTree,
  createStudyDocument,
  flattenStudyCards,
  getStudyStats,
  getStudyStatsForCards,
  hashStudySource,
  listStudySections,
  reconcileStudyDocument,
  resetStudyProgress
} from "./model.js";
import {
  advanceStudySession,
  checkStudyAnswer,
  createStudySession,
  getCurrentStudyCard,
  isStudySessionAtActiveCard,
  navigateStudySession,
  normalizeStudySize,
  studySetupSize,
  returnToActiveStudyCard,
  submitStudyResult
} from "./session.js";
import {
  createStudyRepository,
  exportStudyDocument,
  getStudyExportName,
  importStudyDocument
} from "./storage.js";
import { renderStudyWorkspace, updateStudySectionSelection } from "./view.js";

export function createStudyController({
  elements,
  getContext,
  isLocalPersistenceEnabled,
  renderContent,
  speak,
  stopSpeech,
  getPreferences,
  savePreferences,
  onWorkspaceEnter,
  onWorkspaceExit,
  refreshSettingsHeight,
  setStatus,
  onCardChange,
  t
}) {
  let active = false;
  let availability = { valid: false, issues: [], cardCount: 0 };
  let document = null;
  let session = null;
  let source = "";
  let preferences = normalizePreferences(getPreferences());
  let selectedCards = new Set();
  let setupStep = 1;
  let multiSelectMode = false;
  let sessionTitle = "";
  let entering = false;
  let entryRequestId = 0;
  const repository = createStudyRepository({
    isLocalPersistenceEnabled,
    onStatus: ({ type }) => {
      if (type === "synced") setStatus(t("studySynced"));
      else if (type === "error") setStatus(t("studySyncFailed"));
    }
  });

  function bindEvents() {
    elements.toggleButton.addEventListener("click", async () => {
      if (active) showSetup(1);
      else await enter();
    });
    elements.importInput.addEventListener("change", importProgress);
    elements.progressImportButton.addEventListener("click", () => elements.importInput.click());
    elements.progressExportButton.addEventListener("click", exportProgress);
    elements.headingImportButton.addEventListener("click", () => elements.importInput.click());
    elements.headingExportButton.addEventListener("click", exportProgress);
    elements.homeButton.addEventListener("click", () => {
      if (session || setupStep !== 1) showSetup(1);
      else exit();
    });
    elements.rememberedOptionInput.addEventListener("change", () => {
      updatePreference("showRememberedAnswer", elements.rememberedOptionInput.checked);
      elements.rememberedOptionInput.blur();
    });
    if (elements.fuzzyOptionInput) {
      elements.fuzzyOptionInput.addEventListener("change", () => {
        updatePreference("fuzzyDictation", elements.fuzzyOptionInput.checked);
        elements.fuzzyOptionInput.blur();
      });
    }
  }

  function updateAvailability({ eligible = false, items = [], columnRoles = [] } = {}) {
    const built = eligible
      ? buildStudyTree(items, columnRoles)
      : { cardCount: 0, issues: [] };
    availability = {
      valid: eligible && built.cardCount > 0,
      issues: built.issues,
      cardCount: built.cardCount
    };
    syncUi();
    return availability;
  }

  function reset() {
    const wasActive = active;
    entryRequestId += 1;
    entering = false;
    stopSpeech();
    active = false;
    document = null;
    session = null;
    source = "";
    selectedCards = new Set();
    setupStep = 1;
    sessionTitle = "";
    if (wasActive) onWorkspaceExit();
    syncUi();
  }

  function isEntryCurrent(requestId, requestedSource) {
    if (requestId !== entryRequestId) return false;
    const latest = getContext();
    return latest.eligible && sameStudySource(latest.source, requestedSource);
  }

  async function enter() {
    const context = getContext();
    if (entering) return;
    if (!availability.valid || !context.eligible || !context.items?.length) {
      setStatus(t("studyUnavailable"));
      return;
    }
    const requestId = ++entryRequestId;
    const requestedSource = context.source;
    entering = true;
    syncUi();
    stopSpeech();
    try {
      const fileHash = await hashStudySource(context.rawText);
      if (!isEntryCurrent(requestId, requestedSource)) return;
      const previousDocument = await repository.load(requestedSource, { legacySource: context.legacySource, fileHash });
      if (!isEntryCurrent(requestId, requestedSource)) return;
      const result = await createStudyDocument({
        items: context.items,
        columnRoles: context.columnRoles,
        source: requestedSource,
        rawText: context.rawText,
        targetLanguage: context.targetLanguage,
        translationLanguage: context.translationLanguage,
        vocabularyValid: context.vocabularyValid,
        previousDocument
      });
      if (!isEntryCurrent(requestId, requestedSource)) return;
      if (!result.valid) {
        availability = result;
        setStatus(t("studyUnavailable"));
        return;
      }
      source = requestedSource;
      document = result.document;
      availability = result;
      active = true;
      preferences = normalizePreferences(getPreferences());
      selectedCards = new Set();
      setupStep = 1;
      multiSelectMode = false;
      sessionTitle = "";
      onWorkspaceEnter();
      repository.save(source, document);
      session = null;
      render();
      setStatus(result.issues.length
        ? t("studyReadyWithSkipped", result.cardCount, result.issues.length)
        : t("studyReady", result.cardCount));
    } catch (error) {
      if (requestId === entryRequestId) {
        window.console.warn("Study load failed:", error);
        setStatus(t("studyUnavailable"));
      }
    } finally {
      if (requestId === entryRequestId) {
        entering = false;
        syncUi();
      }
    }
  }

  function exit() {
    entryRequestId += 1;
    entering = false;
    stopSpeech();
    active = false;
    session = null;
    onWorkspaceExit();
    renderContent();
    syncUi();
  }

  function startSession(options = {}) {
    const cardEntries = Array.isArray(options.cardEntries)
      ? options.cardEntries
      : getSelectedCardEntries();
    if (!document || !cardEntries.length) {
      setStatus(t("selectStudyScope"));
      return;
    }
    stopSpeech();
    session = createStudySession({
      document,
      mode: preferences.mode,
      order: preferences.order,
      size: studySetupSize(cardEntries.length, preferences.size),
      cardEntries,
      round: options.round || "standard"
    });
    render();
    speakCurrentCard();
    savePreferences(preferences);
  }

  function render({ preserveScroll = false } = {}) {
    if (!active || !document) return false;
    const scrollState = preserveScroll ? captureStudyScrollState(elements.container) : null;
    const stats = getStudyStats(document);
    const setup = getSetupState(stats);
    const current = session ? getCurrentStudyCard(session) : null;
    if (current?.card?.vocab) {
      onCardChange?.(current.card.vocab, document.target);
    }
    renderStudyWorkspace(elements.container, {
      session,
      setup,
      labels: getLabels(),
      onSpeak: speakCurrentCard,
      onPrimary: performPrimaryStudyAction,
      onNegative: performNegativeStudyAction,
      onCheck: (answer) => {
        checkStudyAnswer(session, answer, { fuzzyDictation: preferences.fuzzyDictation });
        render();
      },
      onRestart: startSession,
      onReviewMistakes: reviewMistakes,
      onPreferenceChange: updatePreference,
      onScopeChange: updateScopeSelection,
      onResetScope: resetScopeProgress,
      onToggleMultiSelect: () => {
        multiSelectMode = !multiSelectMode;
        render();
      },
      onSelectSingleSection: (path) => {
        selectedCards = new Set();
        const entries = path === null ? flattenStudyCards(document) : flattenStudyCards(document, path);
        entries.forEach(({ card }) => selectedCards.add(card));
        sessionTitle = path === null
          ? ""
          : listStudySections(document).find((section) => samePath(section.path, path))?.title || "";
        showSetup(2);
      },
      onNext: () => showSetup(2),
      onBack: () => showSetup(1),
      onStart: startSession,
      onHome: () => showSetup(1)
    });
    if (scrollState) restoreStudyScrollState(elements.container, scrollState);
    syncRememberedOption();
    syncStudyHomeButton();
    return true;
  }

  function handleStudyResult(passed) {
    if (!session || session.completed || !isStudySessionAtActiveCard(session)) return;
    const isCorrectionToFalse = session.graded && session.mode === "recall" && session.lastPassed && !passed;
    if (session.graded && !isCorrectionToFalse) return;
    submitStudyResult(session, passed);
    repository.save(source, document);
    if (isCorrectionToFalse) {
      advanceStudySession(session);
      render();
      speakCurrentCard();
      return;
    }
    const keepAnswerVisible = session.mode === "recall"
      && (!passed || preferences.showRememberedAnswer);
    if (!keepAnswerVisible) {
      advanceStudySession(session);
      render();
      speakCurrentCard();
      return;
    }
    render();
  }

  function continueStudySession() {
    if (!session || session.completed || !isStudySessionAtActiveCard(session)) return;
    if (session.mode === "dictation" && !session.graded) {
      if (!session.checked) return;
      submitStudyResult(session, Boolean(session.lastCorrect));
      repository.save(source, document);
    }
    if (!session.graded) return;
    advanceStudySession(session);
    render();
    speakCurrentCard();
  }

  function returnToActiveCard() {
    if (!session || session.completed) return;
    returnToActiveStudyCard(session);
    render();
    speakCurrentCard();
  }

  function performPrimaryStudyAction() {
    if (!session || session.completed) return;
    if (!isStudySessionAtActiveCard(session)) {
      returnToActiveCard();
      return;
    }
    if (session.mode === "dictation") {
      if (session.checked) continueStudySession();
      else speakCurrentCard();
      return;
    }
    if (session.graded) continueStudySession();
    else handleStudyResult(true);
  }

  function performNegativeStudyAction() {
    if (!session || session.completed || !isStudySessionAtActiveCard(session)) return;
    if (session.mode === "recall" && (!session.graded || session.lastPassed)) {
      handleStudyResult(false);
    }
  }

  function reviewMistakes() {
    if (!session?.mistakes?.length) return;
    startSession({
      cardEntries: [...session.mistakes],
      round: "mistakes"
    });
  }

  function syncUi() {
    const available = availability.valid;
    const showEntry = available;
    elements.entryReveal.classList.toggle("collapsed", !showEntry);
    elements.entryReveal.setAttribute("aria-hidden", String(!showEntry));
    elements.toggleButton.classList.toggle("unavailable", !available);
    elements.toggleButton.classList.toggle("active", active);
    elements.toggleButton.disabled = !available || entering;
    elements.toggleButton.tabIndex = available && !entering ? 0 : -1;
    elements.toggleButton.setAttribute("aria-disabled", String(!available || entering));
    elements.toggleButton.classList.toggle("is-loading", entering);
    if (!available) {
      elements.toggleButton.setAttribute("aria-hidden", "true");
    } else {
      elements.toggleButton.removeAttribute("aria-hidden");
    }
    elements.entryMeta.textContent = active
      ? t("studyActive")
      : availability.cardCount
        ? t("studyCardsAvailable", availability.cardCount)
        : t("studyNeedsVocabulary");
    elements.toggleButton.title = availability.issues.length
      ? t("studySkipped", availability.issues.length)
      : "";
    elements.progressActions.hidden = true;
    syncStudyHomeButton();
    elements.progressImportButton.title = t("importProgress");
    elements.progressImportButton.setAttribute("aria-label", t("importProgress"));
    elements.progressExportButton.title = t("exportProgress");
    elements.progressExportButton.setAttribute("aria-label", t("exportProgress"));
    elements.headingImportButton.title = t("importProgress");
    elements.headingImportButton.setAttribute("aria-label", t("importProgress"));
    elements.headingExportButton.title = t("exportProgress");
    elements.headingExportButton.setAttribute("aria-label", t("exportProgress"));
    syncRememberedOption();
    elements.parseSection.hidden = false;
    elements.playbackSection.hidden = active;
    elements.assistSection.hidden = false;
    elements.speechSection.hidden = false;
    if (active) {
      refreshSettingsHeight();
    }
  }

  function applyI18n() {
    syncUi();
    if (active) render();
  }

  function syncRememberedOption() {
    const visibleRecall = Boolean(active && session && !session.completed && session.mode === "recall");
    if (elements.rememberedOption) {
      elements.rememberedOption.hidden = !visibleRecall;
      elements.rememberedOptionInput.checked = preferences.showRememberedAnswer;
    }
    const visibleFuzzy = Boolean(active && (
      (session && session.mode === "dictation" && !session.completed)
      || (!session && setupStep === 2 && preferences.mode === "dictation")
    ));
    if (elements.fuzzyOption) {
      elements.fuzzyOption.hidden = !visibleFuzzy;
      if (elements.fuzzyOptionInput) {
        elements.fuzzyOptionInput.checked = preferences.fuzzyDictation !== false;
      }
    }
  }

  function syncStudyHomeButton() {
    const isStudyHome = active && !session && setupStep === 1;
    elements.headingProgressActions.hidden = !isStudyHome;
    elements.homeButton.hidden = !active;
    const label = t(isStudyHome ? "exitStudy" : "returnToHome");
    elements.homeButton.title = label;
    elements.homeButton.setAttribute("aria-label", label);
  }

  function handleKeyboard(event) {
    if (!active) return false;
    const target = event.target;
    if (target?.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target?.tagName)) return true;
    if (["Enter", " "].includes(event.key)
      && (target?.tagName === "BUTTON" || target?.tagName === "A"
        || target?.closest?.("button, a[href], [role='button'], [role='checkbox']"))) return true;
    if (event.key === "Escape") {
      event.preventDefault();
      if (session) {
        stopSpeech();
        showSetup();
      } else {
        exit();
      }
      return true;
    }
    if (!session || session.completed) return true;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      navigateStudySession(session, event.key === "ArrowLeft" ? -1 : 1);
      render();
      speakCurrentCard();
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      performPrimaryStudyAction();
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      performNegativeStudyAction();
      return true;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      performPrimaryStudyAction();
      return true;
    }
    return true;
  }

  async function speakCurrentCard() {
    if (!session || session.completed) return;
    const current = getCurrentStudyCard(session);
    if (!current) return;
    await speak(current.card.vocab, document?.target || getContext().targetLanguage);
  }

  async function importProgress() {
    const file = elements.importInput.files?.[0];
    if (!file || !document) return;
    const importSource = source;
    const importDocument = document;
    const importGeneration = entryRequestId;
    try {
      const imported = await importStudyDocument(file);
      if (!active || entryRequestId !== importGeneration || source !== importSource || document !== importDocument) return;
      document = reconcileStudyDocument(document, imported);
      repository.save(source, document, { replaceProgress: true });
      session = null;
      selectedCards = new Set();
      setupStep = 1;
      render();
    } catch (error) {
      if (active && entryRequestId === importGeneration && source === importSource) setStatus(t("studyImportFailed"));
      window.console.warn("Study import failed:", error);
    } finally {
      if (elements.importInput.files?.[0] === file) elements.importInput.value = "";
    }
  }

  function updatePreference(name, value, shouldRender = true) {
    preferences = normalizePreferences({ ...preferences, [name]: value });
    savePreferences(preferences);
    syncRememberedOption();
    if (shouldRender) render();
  }

  function updateScopeSelection(path, checked) {
    sessionTitle = "";
    const entries = path === null ? flattenStudyCards(document) : flattenStudyCards(document, path);
    entries.forEach(({ card }) => {
      if (checked) selectedCards.add(card);
      else selectedCards.delete(card);
    });
    const setup = getSetupState();
    if (!updateStudySectionSelection(elements.container, setup, getLabels())) render();
  }

  function resetScopeProgress(path) {
    if (!document) return;
    const entries = path === null ? flattenStudyCards(document) : flattenStudyCards(document, path);
    resetStudyProgress(entries);
    repository.save(source, document);
    render({ preserveScroll: true });
  }

  function showSetup(step = 1) {
    stopSpeech();
    session = null;
    setupStep = step === 2 ? 2 : 1;
    if (setupStep === 1) {
      multiSelectMode = false;
    }
    render();
  }

  function exportProgress() {
    if (document) exportStudyDocument(document, getStudyExportName(getContext().sourceName || source));
  }

  function getSectionOptions() {
    const allEntries = flattenStudyCards(document);
    return [
      {
        path: null,
        title: t("all"),
        depth: 0,
        cardCount: allEntries.length,
        ...getSelectionState(allEntries),
        ...pickCurrentStats(getStudyStatsForCards(allEntries))
      },
      ...listStudySections(document)
      .filter((section) => section.path.length && section.cardCount > 0)
      .map((section) => {
        const entries = flattenStudyCards(document, section.path);
        const stats = getStudyStatsForCards(entries);
        return {
          ...section,
          ...pickCurrentStats(stats),
          ...getSelectionState(entries)
        };
      })
    ];
  }

  function getSetupState(totalStats = getStudyStats(document)) {
    return {
      step: setupStep,
      preferences,
      sections: getSectionOptions(),
      selectedStats: getStudyStatsForCards(getSelectedCardEntries()),
      selectedSectionCount: countSelectedLeafSections(document, selectedCards),
      totalStats,
      sessionTitle,
      multiSelectMode,
      skippedCount: availability.issues.length
    };
  }

  function getSelectionState(entries) {
    const selectedCount = entries.reduce((count, { card }) => count + Number(selectedCards.has(card)), 0);
    return {
      selected: entries.length > 0 && selectedCount === entries.length,
      indeterminate: selectedCount > 0 && selectedCount < entries.length
    };
  }

  function getSelectedCardEntries() {
    return flattenStudyCards(document).filter(({ card }) => selectedCards.has(card));
  }

  function getLabels() {
    return {
      exitStudy: t("exitStudy"),
      learn: t("learn"),
      recall: t("recall"),
      dictation: t("dictation"),
      learned: t("learned"),
      notRemembered: t("notRemembered"),
      remembered: t("remembered"),
      typeWhatYouHear: t("typeWhatYouHear"),
      answer: t("answer"),
      check: t("check"),
      correct: t("correct"),
      incorrect: t("incorrect"),
      wrong: t("wrong"),
      continue: t("continue"),
      sessionComplete: t("sessionComplete"),
      startAgain: t("startAgain"),
      reviewMistakes: (...args) => t("reviewMistakes", ...args),
      home: t("home"),
      modeTitle: (mode) => t("studyModeTitle", t(mode)),
      sessionSummary: (...args) => t("studySessionSummary", ...args),
      studySetup: t("studySetup"),
      studySetupDescription: t("studySetupDescription"),
      exerciseMode: t("exerciseMode"),
      selectSections: t("selectSections"),
      multiSelect: t("multiSelect"),
      cancelSelect: t("cancelSelect"),
      practice: t("studyPractice"),
      selected: t("selected"),
      currentProgress: t("currentProgress"),
      totalProgress: t("totalProgress"),
      all: t("all"),
      selectedCards: (...args) => t("selectedCards", ...args),
      selectedProgress: (...args) => t("selectedProgress", ...args),
      order: t("studyOrder"),
      sequential: t("sequential"),
      random: t("random"),
      mistakes: t("mistakesFirst"),
      sessionSize: t("sessionSize"),
      allCards: t("allCards"),
      start: t("startSession"),
      next: t("next"),
      back: t("previous"),
      skipped: (...args) => t("studySkipped", ...args),
      fuzzyDictation: t("fuzzyDictation"),
      correctFuzzy: t("correctFuzzy"),
      progressSummary: (...args) => t("progressSummary", ...args),
      returnToActive: t("returnToActive"),
      resetProgress: t("resetProgress"),
      resetAllProgress: t("resetAllProgress")
    };
  }

  return {
    bindEvents,
    enter,
    updateAvailability,
    reset,
    render,
    syncUi,
    applyI18n,
    handleKeyboard,
    exit,
    isActive: () => active
  };
}

function sameStudySource(left, right) {
  return String(left || "") === String(right || "");
}

function samePath(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function pickCurrentStats(stats) {
  return {
    reviewed: stats.reviewed,
    correct: stats.correct,
    incorrect: stats.incorrect
  };
}

function countSelectedLeafSections(document, selectedCards) {
  const sections = listStudySections(document).filter((section) => section.cardCount > 0);
  const leafSections = sections.filter((section) => !sections.some((candidate) => (
    candidate.path.length > section.path.length
    && section.path.every((value, index) => candidate.path[index] === value)
  )));
  return leafSections.reduce((count, section) => {
    const hasSelectedCard = flattenStudyCards(document, section.path)
      .some(({ card }) => selectedCards.has(card));
    return count + Number(hasSelectedCard);
  }, 0);
}

function captureStudyScrollState(container) {
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    scopeTop: container.querySelector(".study-scope-list")?.scrollTop || 0
  };
}

function restoreStudyScrollState(container, state) {
  const restore = () => {
    const scopeList = container.querySelector(".study-scope-list");
    if (scopeList) scopeList.scrollTop = state.scopeTop;
    window.scrollTo(state.windowX, state.windowY);
  };
  restore();
  window.requestAnimationFrame(restore);
}

function normalizePreferences(value = {}) {
  return {
    mode: ["learn", "recall", "dictation"].includes(value.mode) ? value.mode : "learn",
    order: ["sequential", "random", "mistakes"].includes(value.order) ? value.order : "sequential",
    size: normalizeStudySize(value.size),
    showRememberedAnswer: value.showRememberedAnswer !== false,
    fuzzyDictation: value.fuzzyDictation !== false
  };
}
