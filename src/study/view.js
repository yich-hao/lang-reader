import {
  getCurrentStudyCard,
  getStudySessionProgress,
  studySetupSize,
  isStudySessionAtActiveCard,
  MAX_STUDY_ANSWER_LENGTH
} from "./session.js";
import {
  initCustomSliders,
  initSegmentedControls
} from "../ui/customControls.js";
import { buildAdaptiveRangeTicks } from "../ui/rangeTicks.js";
import { canonicalLanguageTag, splitGraphemes } from "../i18n/languages.js";

export function renderStudyWorkspace(container, {
  session,
  setup,
  labels,
  onSpeak,
  onPrimary,
  onNegative,
  onCheck,
  onRestart,
  onReviewMistakes,
  onPreferenceChange,
  onScopeChange,
  onResetScope,
  onToggleMultiSelect,
  onSelectSingleSection,
  onNext,
  onBack,
  onStart,
  onHome
}) {
  if (activeDismissTimer) {
    clearTimeout(activeDismissTimer);
    activeDismissTimer = null;
  }
  container.innerHTML = "";
  const workspace = createElement("section", "study-workspace");

  if (!session) {
    workspace.append(renderStudySetup(setup, labels, {
      onPreferenceChange,
      onScopeChange,
      onResetScope,
      onToggleMultiSelect,
      onSelectSingleSection,
      onNext,
      onBack,
      onStart
    }));
    mountStudyWorkspace(container, workspace);
    return;
  }

  const current = getCurrentStudyCard(session);
  if (session.completed || !current) {
    workspace.append(renderCompletion(session, labels, {
      onRestart,
      onReviewMistakes,
      onHome
    }));
    mountStudyWorkspace(container, workspace);
    return;
  }

  const progress = getStudySessionProgress(session);
  const stage = createElement("section", `study-stage study-mode-${session.mode}`);
  stage.append(renderProgress(progress, session, labels));

  const willPrimaryAdvance = () => {
    if (!isStudySessionAtActiveCard(session)) return false;
    if (session.mode === "dictation") return session.checked;
    if (session.graded) return true;
    return session.mode === "learn"
      || (session.mode === "recall" && !setup?.preferences?.showRememberedAnswer);
  };
  const handlePrimary = (event) => {
    const isMouseClick = Boolean(event && (event.detail > 0 || event.clientX > 0 || event.clientY > 0));
    if (isMouseClick && willPrimaryAdvance()) {
      const passed = session.graded ? session.lastPassed : true;
      const next = session.queue[session.index + 1];
      const prepareNext = session.mode === "dictation" && next
        ? (card) => card.append(renderPrompt(session, next.card, labels, { onSpeak, onCheck }))
        : null;
      triggerCardDismiss(stage, () => onPrimary(event), getDismissVariant(session, passed), prepareNext);
    } else {
      onPrimary(event);
    }
  };
  const handleNegative = (event) => {
    const isMouseClick = Boolean(event && (event.detail > 0 || event.clientX > 0 || event.clientY > 0));
    const willAdvance = session.graded && session.lastPassed;
    if (isMouseClick && willAdvance) {
      triggerCardDismiss(stage, () => onNegative(event), getDismissVariant(session, false));
    } else {
      onNegative(event);
    }
  };

  stage.append(renderPokerDeck(session, labels, {
    onSpeak,
    onCheck
  }));

  if (session.mode !== "dictation" || session.checked) {
    stage.append(renderResultActions(session, labels, {
      onPrimary: handlePrimary,
      onNegative: handleNegative
    }));
  }
  workspace.append(stage);
  mountStudyWorkspace(container, workspace);

  if (session.mode === "dictation" && !session.checked) {
    workspace.querySelector(".study-dictation-input")?.focus();
  }
}

export function updateStudySectionSelection(container, setup, labels) {
  const menu = container.querySelector('.study-setup[data-step="sections"]');
  if (!menu) return false;
  const sectionStates = new Map(setup.sections.map((section) => [scopeKey(section.path), section]));
  menu.querySelectorAll(".study-scope-option").forEach((row) => {
    const section = sectionStates.get(row.dataset.scopeKey);
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!section || !checkbox) return;
    checkbox.checked = section.selected;
    checkbox.indeterminate = section.indeterminate;
  });
  const selectedCount = menu.querySelector("[data-study-selected-count]");
  if (selectedCount) selectedCount.textContent = labels.selectedCards(setup.selectedStats.cards);
  const next = menu.querySelector(".study-next-button");
  if (next) next.disabled = !setup.selectedStats.cards;
  return true;
}

function renderStudySetup(setup, labels, callbacks) {
  return setup.step === 2
    ? renderPracticeSetup(setup, labels, callbacks)
    : renderSectionSetup(setup, labels, callbacks);
}

function renderSectionSetup(setup, labels, callbacks) {
  const menu = createElement("section", "study-setup");
  menu.dataset.step = "sections";
  const heading = renderSetupHeading(labels.selectSections);
  menu.append(heading);

  menu.append(renderProgressSummary(
    labels.totalProgress,
    setup.totalStats,
    labels.selectedProgress(setup.totalStats.reviewed, setup.totalStats.cards),
    labels
  ));

  const scopeSection = createElement("section", "study-setup-section study-scope-section");
  const scopeHeader = createElement("div", "study-setup-section-heading");

  const titleWrapper = createElement("div", "study-scope-header-title-wrap");
  const scopeTitle = createElement("h4");
  scopeTitle.textContent = labels.selectSections;

  const selectBtn = button(
    setup.multiSelectMode ? (labels.cancelSelect || "Cancel") : (labels.multiSelect || "Select"),
    `study-multiselect-toggle-button ${setup.multiSelectMode ? "is-active" : ""}`,
    callbacks.onToggleMultiSelect
  );
  titleWrapper.append(scopeTitle, selectBtn);

  const selectedCount = createElement("span");
  selectedCount.dataset.studySelectedCount = "";
  selectedCount.textContent = setup.multiSelectMode
    ? labels.selectedCards(setup.selectedStats.cards)
    : "";
  scopeHeader.append(titleWrapper, selectedCount);

  const scopeList = createElement("div", `study-scope-list ${setup.multiSelectMode ? "is-multi-select" : "is-single-select"}`);
  setup.sections.forEach((section) => {
    const row = createElement("div", "study-scope-option");
    row.dataset.scopeKey = scopeKey(section.path);
    row.classList.toggle("study-scope-all", section.path === null);
    row.style.setProperty("--study-depth", String(section.depth));
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", section.title);

    if (setup.multiSelectMode) {
      const checkbox = createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = section.selected;
      checkbox.indeterminate = section.indeterminate;
      checkbox.addEventListener("change", (e) => {
        e.stopPropagation();
        callbacks.onScopeChange(section.path, checkbox.checked);
      });
      row.append(checkbox);
    }

    const label = createElement("span", "study-scope-name");
    label.textContent = section.title;
    const sectionActions = createElement("span", "study-scope-actions");
    const sectionProgress = createElement("span", "study-scope-progress");
    sectionProgress.textContent = `${section.correct} / ${section.reviewed} / ${section.cardCount}`;
    const resetLabel = section.path === null ? labels.resetAllProgress : labels.resetProgress;
    const resetButton = button("", "study-scope-reset", (event) => {
      event.stopPropagation();
      callbacks.onResetScope(section.path);
    });
    resetButton.title = resetLabel;
    resetButton.setAttribute("aria-label", resetLabel);
    resetButton.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path></svg>`;
    resetButton.addEventListener("keydown", (event) => event.stopPropagation());
    sectionActions.append(sectionProgress, resetButton);
    row.append(label, sectionActions);

    const handleSelect = (e) => {
      if (setup.multiSelectMode) {
        if (e.target.tagName === "INPUT") return;
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          callbacks.onScopeChange(section.path, checkbox.checked);
        }
      } else {
        callbacks.onSelectSingleSection(section.path);
      }
    };

    row.addEventListener("click", handleSelect);
    row.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        handleSelect(e);
      }
    });

    scopeList.append(row);
  });
  scopeSection.append(scopeHeader, scopeList);
  menu.append(scopeSection);

  if (setup.skippedCount) {
    const skipped = createElement("small", "study-skipped-note");
    skipped.textContent = labels.skipped(setup.skippedCount);
    menu.append(skipped);
  }

  if (setup.multiSelectMode) {
    const actions = createElement("footer", "study-setup-actions");
    const next = button(labels.next, "primary-button study-next-button", callbacks.onNext);
    next.disabled = !setup.selectedStats.cards;
    actions.append(next);
    menu.append(actions);
  }

  return menu;
}

function renderPracticeSetup(setup, labels, callbacks) {
  const menu = createElement("section", "study-setup");
  menu.dataset.step = "practice";
  const setupTitle = setup.sessionTitle
    || (setup.selectedSectionCount > 1 ? labels.selected : labels.practice);
  menu.append(renderSetupHeading(setupTitle));

  const selectedSummary = createElement("div", "study-selected-summary");
  selectedSummary.textContent = labels.selectedCards(setup.selectedStats.cards);
  menu.append(selectedSummary);

  menu.append(renderChoiceSection(
    labels.exerciseMode,
    [
      ["learn", labels.learn],
      ["recall", labels.recall],
      ["dictation", labels.dictation]
    ],
    setup.preferences.mode,
    (value, shouldRender) => callbacks.onPreferenceChange("mode", value, shouldRender),
    "study-mode-choices"
  ));

  menu.append(renderChoiceSection(
    labels.order,
    [
      ["sequential", labels.sequential],
      ["random", labels.random],
      ["mistakes", labels.mistakes]
    ],
    setup.preferences.order,
    (value, shouldRender) => callbacks.onPreferenceChange("order", value, shouldRender),
    "study-order-choices"
  ));

  menu.append(renderSizeSlider(setup, labels, callbacks.onPreferenceChange));

  const actions = createElement("footer", "study-setup-actions study-practice-actions");
  actions.append(
    button(labels.back, "study-back-step-button", callbacks.onBack),
    button(labels.start, "primary-button study-setup-start", callbacks.onStart)
  );
  menu.append(actions);
  return menu;
}

function renderSetupHeading(titleText) {
  const heading = createElement("header", "study-setup-heading");
  const title = createElement("h3");
  title.textContent = titleText;
  heading.append(title);
  return heading;
}

function renderProgressSummary(titleText, stats, valueText, labels) {
  const summary = createElement("section", "study-setup-summary");
  const summaryTitle = createElement("strong");
  summaryTitle.textContent = titleText;
  const summaryValue = createElement("span");
  summaryValue.textContent = valueText;
  const progress = renderProgressTrack(
    stats.correct,
    stats.incorrect,
    stats.cards,
    "study-progress-track study-setup-progress"
  );
  const details = renderProgressDetails(stats.correct, stats.incorrect, labels);
  summary.append(summaryTitle, summaryValue, progress);
  if (details) summary.append(details);
  return summary;
}

function renderSizeSlider(setup, labels, onPreferenceChange) {
  const sizeSection = createElement("section", "study-setup-section");
  const header = createElement("div", "slider-header");
  const sizeTitle = createElement("h4");
  sizeTitle.className = "slider-title";
  sizeTitle.textContent = labels.sessionSize;
  const valueText = createElement("span", "slider-value study-size-value");
  const total = Math.max(1, setup.selectedStats.cards);
  const size = studySetupSize(total, setup.preferences.size);
  const selectedSize = size > 0 && size < total
    ? size
    : total;
  const allOnly = total <= 10;
  sizeSection.classList.toggle("is-single-option", allOnly);
  valueText.textContent = selectedSize === total ? labels.all : String(selectedSize);
  header.append(sizeTitle, valueText);

  const wrapper = createElement("div", "discrete-slider-wrapper t1-align study-size-slider-wrapper");
  const sliderRow = createElement("div", "slider-r1");
  const slider = createElement("input", "study-size-slider");
  slider.type = "range";
  slider.min = total === 1 ? "0" : "1";
  slider.max = String(total);
  slider.step = "1";
  slider.value = String(selectedSize);
  slider.disabled = allOnly;
  slider.setAttribute("aria-label", labels.sessionSize);
  updateSizeSliderText(slider, selectedSize, total, labels);
  slider.addEventListener("input", () => {
    const nextValue = Number(slider.value);
    valueText.textContent = nextValue === total ? labels.all : String(nextValue);
    updateSizeSliderText(slider, nextValue, total, labels);
  });
  slider.addEventListener("change", () => {
    const nextValue = Number(slider.value);
    onPreferenceChange("size", nextValue === total ? 0 : nextValue);
  });

  const tickRuler = createElement("div", "ticks-ruler adaptive-ticks");
  const tickLabels = createElement("div", "ticks-labels adaptive-ticks study-size-labels");
  const ticks = allOnly
    ? [{ value: 1, position: 0 }, { value: total, position: 100 }]
    : buildAdaptiveRangeTicks({ min: 1, max: total });
  ticks.forEach(({ value, position }) => {
    const mark = createElement("span", "major");
    mark.style.setProperty("--tick-position", `${position}%`);
    tickRuler.append(mark);
    const tick = createElement("span");
    tick.style.setProperty("--tick-position", `${position}%`);
    tick.textContent = position === 100 ? labels.all : String(value);
    tickLabels.append(tick);
  });
  sliderRow.append(slider);
  wrapper.append(sliderRow, tickRuler, tickLabels);
  sizeSection.append(header, wrapper);
  return sizeSection;
}

function updateSizeSliderText(slider, value, total, labels) {
  slider.setAttribute("aria-valuetext", value === total ? labels.allCards : String(value));
}

function renderChoiceSection(titleText, choices, selected, onSelect, className) {
  const section = createElement("section", "study-setup-section");
  const title = createElement("h4");
  title.textContent = titleText;
  const group = createElement("div", `segmented-control full-width-segmented study-choice-group ${className}`);
  group.setAttribute("role", "group");
  const indicator = createElement("div", "segment-indicator");
  indicator.setAttribute("aria-hidden", "true");
  group.append(indicator);
  let pendingValue = selected;
  choices.forEach(([value, label]) => {
    const choice = button(label, "segment-btn", () => {
      if (value === pendingValue) return;
      pendingValue = value;
      if (group._timer) clearTimeout(group._timer);
      group.querySelectorAll(".segment-btn").forEach((buttonElement) => {
        const active = buttonElement === choice;
        buttonElement.classList.toggle("active", active);
        buttonElement.setAttribute("aria-pressed", String(active));
      });
      onSelect(value, false);
      group._timer = setTimeout(() => {
        group._timer = null;
        if (group.isConnected) onSelect(value, true);
      }, 220);
    });
    const active = value === selected;
    choice.classList.toggle("active", active);
    choice.setAttribute("aria-pressed", String(active));
    choice.dataset.value = value;
    group.append(choice);
  });
  section.append(title, group);
  return section;
}

function mountStudyWorkspace(container, workspace) {
  container.append(workspace);
  requestAnimationFrame(() => {
    initSegmentedControls(workspace);
    initCustomSliders(workspace);
  });
}

function renderProgress(progress, session, labels) {
  const header = createElement("div", "study-session-header");
  const title = createElement("strong", "study-session-mode");
  title.textContent = labels.modeTitle?.(session.mode) || labels.studyProgress || "Progress";

  const count = createElement("span", "study-session-count");
  count.textContent = `${progress.current} / ${progress.total}`;
  const total = progress.total || 1;
  const knowCount = (session.results || []).filter((r) => r === true).length;
  const dontKnowCount = (session.results || []).filter((r) => r === false).length;

  const track = renderProgressTrack(knowCount, dontKnowCount, total, "study-progress-track");
  const details = renderProgressDetails(knowCount, dontKnowCount, labels);
  header.append(title, count, track);
  if (details) header.append(details);
  return header;
}

function renderProgressTrack(correct, incorrect, total, className) {
  const track = createElement("div", className);
  if (correct > 0) {
    const correctFill = createElement("div", "study-progress-fill-know");
    correctFill.style.width = `${(correct / Math.max(total, 1)) * 100}%`;
    track.append(correctFill);
  }
  if (incorrect > 0) {
    const incorrectFill = createElement("div", "study-progress-fill-dont-know");
    incorrectFill.style.width = `${(incorrect / Math.max(total, 1)) * 100}%`;
    track.append(incorrectFill);
  }
  return track;
}

function renderProgressDetails(correct, incorrect, labels) {
  if (!correct && !incorrect) return null;
  const details = createElement("div", "study-progress-details");
  if (correct) {
    const value = createElement("span", "is-correct");
    value.textContent = `${labels.correct}: ${correct}`;
    details.append(value);
  }
  if (incorrect) {
    const value = createElement("span", "is-incorrect");
    value.textContent = `${labels.notRemembered}: ${incorrect}`;
    details.append(value);
  }
  return details;
}

let activeDismissTimer = null;

function getDismissVariant(session, passed = session.lastPassed) {
  return session.mode === "recall" && passed === false ? "return" : "discard";
}

function triggerCardDismiss(stageElement, callback, variant = "discard", prepareNext = null) {
  if (activeDismissTimer) return;
  const topCard = stageElement?.querySelector?.(".study-deck-card.layer-0");
  const layer1 = stageElement?.querySelector?.(".study-deck-card.layer-1");
  const layer2 = stageElement?.querySelector?.(".study-deck-card.layer-2");

  if (layer1 && prepareNext) {
    prepareNext(layer1);
    layer1.inert = true;
  }
  if (layer1) {
    layer1.classList.remove("layer-1");
    layer1.classList.add("layer-0");
  }
  if (layer2) {
    layer2.classList.remove("layer-2");
    layer2.classList.add("layer-1");
  }
  if (topCard) {
    topCard.classList.add(variant === "return" ? "is-returning" : "is-dismissing");
  }
  activeDismissTimer = setTimeout(() => {
    activeDismissTimer = null;
    callback();
  }, 320);
}

function renderPokerDeck(session, labels, callbacks) {
  const container = createElement("div", "study-deck-container");
  const remaining = session.queue.slice(session.index);
  const visibleCards = remaining.slice(0, 3);

  visibleCards.forEach((entry, idx) => {
    const cardNode = createElement("div", `study-deck-card layer-${idx}`);

    if (idx === 0) {
      if (session.mode === "dictation") {
        if (session.checked) {
          cardNode.append(renderVocabButton(entry.card, callbacks.onSpeak, {
            html: renderDiffMarkup(entry.card.vocab, session.answer, {
              fuzzy: session.lastFuzzy, language: session.language
            })
          }));
          cardNode.append(renderAnswer(entry.card, session, labels));
        } else {
          cardNode.append(renderPrompt(session, entry.card, labels, callbacks));
        }
      } else {
        cardNode.append(renderVocabButton(entry.card, callbacks.onSpeak));

        if (session.mode === "recall" && !session.revealed) {
          if (entry.card.sentence) {
            const hintBtn = createElement("button", "study-hint-button");
            hintBtn.type = "button";
            hintBtn.textContent = `💡 ${labels.showHint || "Hint"}`;
            hintBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              hintBtn.style.display = "none";
              const sentenceElem = createElement("div", "study-hint-sentence");
              sentenceElem.textContent = entry.card.sentence;
              sentenceElem.addEventListener("click", (e) => e.stopPropagation());
              cardNode.append(sentenceElem);
            });
            cardNode.append(hintBtn);
          }
        }

        if (session.revealed || session.mode === "learn") {
          cardNode.append(renderAnswer(entry.card, session, labels));
        }
      }
    }

    container.append(cardNode);
  });

  return container;
}

function renderPrompt(session, card, labels, callbacks) {
  const prompt = createElement("div", "study-prompt");

  if (session.mode === "dictation") {
    const instruction = button(labels.typeWhatYouHear, "study-instruction interactive-text-unit", callbacks.onSpeak);
    instruction.textContent = labels.typeWhatYouHear;

    const form = createElement("form", "study-dictation-form");
    const input = createElement("input", "study-dictation-input");
    input.type = "text";
    input.maxLength = MAX_STUDY_ANSWER_LENGTH;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.dir = "auto";
    input.lang = session.language;
    input.setAttribute("aria-label", labels.answer);
    const check = button(labels.check, "primary-button study-check-button", () => callbacks.onCheck(input.value));
    check.type = "submit";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      callbacks.onCheck(input.value);
    });
    form.append(input, check);
    prompt.append(instruction, form);
    return prompt;
  }

  const vocab = button(card.vocab, "study-vocab interactive-text-unit", callbacks.onSpeak);
  vocab.dir = "auto";
  prompt.append(vocab);
  return prompt;
}

function renderVocabButton(card, onSpeak, options = {}) {
  const vocab = button(card.vocab, "study-vocab interactive-text-unit", (event) => {
    event.stopPropagation();
    onSpeak();
  });
  if (options.html) vocab.innerHTML = options.html;
  vocab.dir = "auto";
  return vocab;
}

function renderAnswer(card, session, labels) {
  const answer = createElement("div", "study-answer");
  if (session.mode === "dictation") {
    const isFuzzy = Boolean(session.lastFuzzy);
    const isCorrect = Boolean(session.lastCorrect);
    const resultText = isCorrect
      ? (isFuzzy ? (labels.correctFuzzy || "Correct (Note spelling differences)") : labels.correct)
      : (session.lastSeverity === "wrong" ? labels.wrong : labels.incorrect);
    const resultClass = isCorrect
      ? (isFuzzy ? "is-fuzzy" : "is-correct")
      : (session.lastSeverity === "wrong" ? "is-wrong" : "is-close");

    const result = createElement("p", `study-answer-result ${resultClass}`);
    result.textContent = resultText;
    answer.append(result);

  }

  const meaning = createElement("p", "study-meaning");
  meaning.textContent = card.meaning;
  meaning.dir = "auto";
  answer.append(meaning);
  if (session.mode !== "dictation" && card.sentence) {
    const sentence = createElement("p", "study-sentence");
    sentence.textContent = card.sentence;
    sentence.dir = "auto";
    answer.append(sentence);
  }
  return answer;
}

export function renderDiffMarkup(expected, answer, options = {}) {
  const normAns = String(answer || "").trim().slice(0, MAX_STUDY_ANSWER_LENGTH);
  const normExp = String(expected || "").trim().slice(0, MAX_STUDY_ANSWER_LENGTH);
  if (normAns === normExp) {
    return escapeHtml(normExp);
  }
  const fuzzyClass = options.fuzzy ? " is-fuzzy" : "";
  return buildCharacterDiff(normExp, normAns, options.language).map((operation) => {
    if (operation.type === "equal") return escapeHtml(operation.expected);
    if (operation.type === "normalized") {
      return `<mark class="study-diff-char is-normalized is-fuzzy" title="Typed: ${escapeHtml(operation.actual)}">${escapeHtml(operation.expected)}</mark>`;
    }
    if (operation.type === "extra") {
      return `<mark class="study-diff-char is-extra${fuzzyClass}" title="Extra: ${escapeHtml(operation.actual)}"><s>${escapeHtml(operation.actual)}</s></mark>`;
    }
    const detail = operation.actual ? ` title="Typed: ${escapeHtml(operation.actual)}"` : "";
    return `<mark class="study-diff-char is-${operation.type}${fuzzyClass}"${detail}>${escapeHtml(operation.expected)}</mark>`;
  }).join("");
}

function buildCharacterDiff(expected, answer, language) {
  const left = splitGraphemes(expected, language);
  const right = splitGraphemes(answer, language);
  const lower = value => value.toLocaleLowerCase(canonicalLanguageTag(language) || undefined);
  if ((left.length + 1) * (right.length + 1) > 250000) {
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
      const expectedChar = left[index];
      const actualChar = right[index];
      if (expectedChar === undefined) return { type: "extra", expected: "", actual: actualChar };
      if (actualChar === undefined) return { type: "missing", expected: expectedChar, actual: "" };
      return { type: expectedChar === actualChar ? "equal" : lower(expectedChar) === lower(actualChar)
        ? "normalized" : "substitution", expected: expectedChar, actual: actualChar };
    });
  }
  const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let leftIndex = 0; leftIndex <= left.length; leftIndex += 1) matrix[leftIndex][0] = leftIndex;
  for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) matrix[0][rightIndex] = rightIndex;

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const matches = lower(left[leftIndex - 1]) === lower(right[rightIndex - 1]);
      matrix[leftIndex][rightIndex] = Math.min(
        matrix[leftIndex - 1][rightIndex] + 1,
        matrix[leftIndex][rightIndex - 1] + 1,
        matrix[leftIndex - 1][rightIndex - 1] + (matches ? 0 : 1)
      );
    }
  }

  const operations = [];
  let leftIndex = left.length;
  let rightIndex = right.length;
  while (leftIndex || rightIndex) {
    const expectedChar = left[leftIndex - 1];
    const actualChar = right[rightIndex - 1];
    if (leftIndex && rightIndex
      && lower(expectedChar) === lower(actualChar)
      && matrix[leftIndex][rightIndex] === matrix[leftIndex - 1][rightIndex - 1]) {
      operations.push({
        type: expectedChar === actualChar ? "equal" : "normalized",
        expected: expectedChar,
        actual: actualChar
      });
      leftIndex -= 1;
      rightIndex -= 1;
    } else if (leftIndex && rightIndex
      && matrix[leftIndex][rightIndex] === matrix[leftIndex - 1][rightIndex - 1] + 1) {
      operations.push({ type: "substitution", expected: expectedChar, actual: actualChar });
      leftIndex -= 1;
      rightIndex -= 1;
    } else if (rightIndex && matrix[leftIndex][rightIndex] === matrix[leftIndex][rightIndex - 1] + 1) {
      operations.push({ type: "extra", expected: "", actual: actualChar });
      rightIndex -= 1;
    } else {
      operations.push({ type: "missing", expected: expectedChar, actual: "" });
      leftIndex -= 1;
    }
  }
  return operations.reverse();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderResultActions(session, labels, callbacks) {
  const actions = createElement("div", "study-result-actions");
  if (!isStudySessionAtActiveCard(session)) {
    actions.classList.add("is-single");
    actions.append(button(
      labels.returnToActive,
      "primary-button study-return-active-button",
      callbacks.onPrimary
    ));
    return actions;
  }
  if (session.mode === "dictation") {
    actions.classList.add("is-single");
    actions.append(button(labels.continue, "primary-button study-next-card-button", callbacks.onPrimary));
    return actions;
  }
  if (session.mode === "learn") {
    actions.classList.add("is-single");
    actions.append(button(
      labels.learned,
      "primary-button study-learned-button",
      callbacks.onPrimary
    ));
    return actions;
  }
  if (session.graded) {
    if (session.lastPassed) {
      actions.append(
        button(labels.notRemembered, "study-not-remembered-button", callbacks.onNegative),
        button(labels.continue, "primary-button study-next-card-button", callbacks.onPrimary)
      );
    } else {
      actions.classList.add("is-single");
      actions.append(button(labels.continue, "primary-button study-next-card-button", callbacks.onPrimary));
    }
    return actions;
  }
  actions.append(
    button(labels.notRemembered, "study-not-remembered-button", callbacks.onNegative),
    button(labels.remembered, "primary-button study-remembered-button", callbacks.onPrimary)
  );
  return actions;
}

function renderCompletion(session, labels, callbacks) {
  const completion = createElement("section", "study-completion");
  const title = createElement("h3");
  title.textContent = labels.sessionComplete;

  const total = session.initialCount || 1;
  const knowCount = (session.results || []).filter((r) => r === true).length;
  const dontKnowCount = (session.results || []).filter((r) => r === false).length;
  const knowPct = Math.round((knowCount / total) * 100);
  const dontKnowPct = Math.round((dontKnowCount / total) * 100);

  // SVG Donut Chart
  const chartContainer = createElement("div", "study-chart-container");
  const chartWrapper = createElement("div", "study-pie-chart-wrapper");
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "study-pie-chart-svg");
  svg.setAttribute("viewBox", "0 0 42 42");

  const bgCircle = document.createElementNS(svgNS, "circle");
  bgCircle.setAttribute("cx", "21");
  bgCircle.setAttribute("cy", "21");
  bgCircle.setAttribute("r", "15.91549430918954");
  bgCircle.setAttribute("class", "study-chart-track");
  bgCircle.setAttribute("fill", "transparent");
  bgCircle.setAttribute("stroke-width", "5");

  const knowCircle = document.createElementNS(svgNS, "circle");
  knowCircle.setAttribute("cx", "21");
  knowCircle.setAttribute("cy", "21");
  knowCircle.setAttribute("r", "15.91549430918954");
  knowCircle.setAttribute("class", "study-chart-know");
  knowCircle.setAttribute("fill", "transparent");
  knowCircle.setAttribute("stroke-width", "5");
  knowCircle.setAttribute("stroke-dasharray", `${knowPct} ${100 - knowPct}`);
  knowCircle.setAttribute("stroke-dashoffset", "0");

  const dontKnowCircle = document.createElementNS(svgNS, "circle");
  dontKnowCircle.setAttribute("cx", "21");
  dontKnowCircle.setAttribute("cy", "21");
  dontKnowCircle.setAttribute("r", "15.91549430918954");
  dontKnowCircle.setAttribute("class", "study-chart-dont-know");
  dontKnowCircle.setAttribute("fill", "transparent");
  dontKnowCircle.setAttribute("stroke-width", "5");
  dontKnowCircle.setAttribute("stroke-dasharray", `${dontKnowPct} ${100 - dontKnowPct}`);
  dontKnowCircle.setAttribute("stroke-dashoffset", `-${knowPct}`);

  svg.append(bgCircle, knowCircle, dontKnowCircle);

  const centerText = createElement("div", "study-chart-center-text");
  centerText.textContent = `${knowPct}%`;

  chartWrapper.append(svg, centerText);

  const legend = createElement("div", "study-chart-legend");
  const itemKnow = createElement("div", "study-legend-item");
  const dotKnow = createElement("div", "study-legend-dot know");
  const passLabel = session.mode === "learn"
    ? labels.learned
    : session.mode === "dictation"
      ? labels.correct
      : labels.remembered;
  const failLabel = session.mode === "dictation" ? labels.incorrect : labels.notRemembered;
  const textKnow = createElement("span");
  textKnow.textContent = `${passLabel}: ${knowCount} (${knowPct}%)`;
  itemKnow.append(dotKnow, textKnow);

  const itemDontKnow = createElement("div", "study-legend-item");
  const dotDontKnow = createElement("div", "study-legend-dot dont-know");
  const textDontKnow = createElement("span");
  textDontKnow.textContent = `${failLabel}: ${dontKnowCount} (${dontKnowPct}%)`;
  itemDontKnow.append(dotDontKnow, textDontKnow);

  legend.append(itemKnow);
  if (session.mode !== "learn" || dontKnowCount) legend.append(itemDontKnow);
  chartContainer.append(chartWrapper, legend);

  const actions = createElement("div", "study-completion-actions");

  if (session.mistakes.length) {
    actions.append(button(
      labels.reviewMistakes(session.mistakes.length),
      "study-review-mistakes-button",
      callbacks.onReviewMistakes
    ));
  }
  actions.append(button(labels.startAgain, "secondary-button", callbacks.onRestart));
  actions.append(button(labels.home || "Home", "primary-button study-home-button", callbacks.onHome));

  completion.append(title, chartContainer, actions);
  return completion;
}

function button(text, className, handler, ariaLabel = "") {
  const element = createElement("button", className);
  element.type = "button";
  element.textContent = text;
  if (ariaLabel) element.setAttribute("aria-label", ariaLabel);
  element.addEventListener("click", handler);
  return element;
}

function createElement(tagName, className = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  return element;
}

function scopeKey(path) {
  return path === null ? "__all__" : JSON.stringify(path);
}
