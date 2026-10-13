import { splitSentenceRanges, splitWordTokens } from "../parsing/textSegmentation.js";
import { findMarkdownLinks, mapMarkdownLinks } from "../parsing/markdownLinks.js";
import { filterSpeechText } from "../i18n/languages.js";
import { cursorFromUnit, flattenNavigationTargets, findHorizontalTarget, findVerticalTarget } from "../ui/navigationGrid.js";

export function createPlaybackUnits({ state, elements, shouldUseReaderMode, getEffectivePartRole }) {
  function getValidClickMode(mode) {
    if (["word", "sentence", "paragraph", "cell", "fromHereWord", "fromHereSentence"].includes(mode)) return mode;
    return "word";
  }

  function getClickUnitMode() {
    return getClickUnitModeForValue(getEffectiveClickMode());
  }

  function getClickUnitModeForValue(mode) {
    if (mode === "paragraph" || mode === "cell") return "cell";
    return mode === "sentence" || mode === "fromHereSentence" ? "sentence" : "word";
  }

  function getClickUnitLevel() {
    return getClickUnitModeForValue(getRenderClickMode());
  }

  function getSelectionUnitMode() {
    if (state.isPlaying && state.playbackSession?.selectionLevel) return state.playbackSession.selectionLevel;
    return state.activeSelectionMode === "play" ? getPlaybackUnitLevel() : getClickUnitMode();
  }

  function getRenderClickMode() {
    const clickMode = getEffectiveClickMode();
    const levels = ["word", "sentence", "cell"];
    const clickLevel = getClickUnitModeForValue(clickMode);
    const selectionLevel = getSelectionUnitMode();
    return levels.indexOf(selectionLevel) < levels.indexOf(clickLevel) ? selectionLevel : clickMode;
  }

  function getPlaybackUnitLevel() {
    const mode = getValidPlaybackUnit(elements.playbackUnitSelect.value);
    return mode === "paragraph" ? "cell" : mode;
  }

  function getValidPlaybackUnit(mode) {
    return ["word", "sentence", "paragraph"].includes(mode) ? mode : "sentence";
  }

  function isFromHereClickMode() {
    const mode = getEffectiveClickMode();
    return mode === "fromHereWord" || mode === "fromHereSentence";
  }

  function getEffectiveClickMode() {
    return state.temporaryWordMode ? "word" : elements.modeSelect.value;
  }

  function findHorizontalKeyboardTarget(direction) {
    const mode = getPlaybackUnitLevel();
    const units = getKeyboardUnits(mode);
    return findHorizontalTarget(units, getSelectionCursor(mode, getPlaybackStartCursor()), direction, canUseKeyboardTarget);
  }

  function findVerticalKeyboardTarget(direction) {
    const mode = getPlaybackUnitLevel();
    return findVerticalTarget({
      items: state.items,
      cursor: getSelectionCursor(mode, getPlaybackStartCursor()),
      direction,
      unitLevel: mode,
      getCellUnits,
      canUseTarget: canUseKeyboardTarget
    });
  }

  function getKeyboardUnits(mode) {
    return flattenNavigationTargets(state.items, getCellUnits, mode);
  }

  function canUseKeyboardTarget(target) {
    if (target.skipWhenTranslationsDisabled && !elements.readTranslationsInput.checked) return false;
    return isRowPlayable(target.rowIndex);
  }

  function buildClickPlaybackRequest(unitLevel, unitIndex = 0) {
    const isFromHere = isFromHereClickMode();
    const fromHereWord = getEffectiveClickMode() === "fromHereWord";
    const playbackUnitLevel = fromHereWord ? "sentence" : unitLevel;
    const start = normalizePlaybackCursor({
      ...state.activeUnitCursor,
      sentenceIndex: unitLevel === "sentence" ? unitIndex : state.activeUnitCursor.sentenceIndex,
      wordIndex: unitLevel === "word" ? unitIndex : state.activeUnitCursor.wordIndex
    });
    return buildPlaybackRequest({
      kind: isFromHere ? "auto" : "play",
      unitLevel: playbackUnitLevel,
      startUnitLevel: fromHereWord ? "word" : playbackUnitLevel,
      range: isFromHere ? getAutoPlaybackRange() : "single",
      start
    });
  }

  function buildButtonPlaybackRequest(autoPlay) {
    const unitLevel = getPlaybackUnitLevel();
    return buildPlaybackRequest({
      kind: autoPlay ? "auto" : "play",
      unitLevel,
      startUnitLevel: unitLevel,
      range: autoPlay ? getAutoPlaybackRange() : unitLevel === "cell" ? "cellFromHere" : "sentence",
      start: getSelectionCursor(unitLevel, getPlaybackStartCursor())
    });
  }

  function buildPlaybackRequest({ kind, unitLevel, startUnitLevel, range, start, text }) {
    const normalizedUnitLevel = ["word", "sentence", "cell"].includes(unitLevel) ? unitLevel : "sentence";
    return {
      kind: kind === "auto" ? "auto" : "play",
      unitLevel: normalizedUnitLevel,
      startUnitLevel: ["word", "sentence", "cell"].includes(startUnitLevel)
        ? startUnitLevel
        : normalizedUnitLevel,
      range,
      start: normalizePlaybackCursor(start || state.activeUnitCursor),
      text
    };
  }

  function getAutoPlaybackRange() {
    if (shouldUseReaderMode()) return "fromHere";
    return elements.playModeSelect.value === "column" ? "columnFromHere" : "fromHere";
  }

  function getPlaybackStartCursor() {
    return normalizePlaybackCursor(state.isPlaying && state.playbackSession?.anchor || state.activeUnitCursor);
  }

  function normalizePlaybackCursor(cursor) {
    return {
      rowIndex: Math.min(Math.max(cursor.rowIndex || 0, 0), Math.max(0, state.items.length - 1)),
      columnIndex: Math.max(0, cursor.columnIndex || 0),
      sentenceIndex: Math.max(0, cursor.sentenceIndex || 0),
      wordIndex: Math.max(0, cursor.wordIndex || 0)
    };
  }

  function isRowPlayable(rowIndex) {
    return getRowUnits(rowIndex, getPlaybackUnitLevel())
      .some((unit) => !unit.skipWhenTranslationsDisabled || elements.readTranslationsInput.checked);
  }

  function buildPlaybackUnits(request) {
    const start = request.start;
    const level = request.unitLevel;
    // Auto Play keeps silent candidates for live eligibility checks.
    const includeSilent = request.kind === "auto";
    if (request.range === "singleText") {
      return [{
        text: request.text,
        language: state.translationLanguage,
        itemIndex: start.rowIndex,
        partIndex: start.columnIndex,
        rowIndex: start.rowIndex,
        columnIndex: start.columnIndex,
        sentenceIndex: start.sentenceIndex,
        wordIndex: start.wordIndex,
        unitLevel: "sentence",
        isTranslation: true,
        skipWhenTranslationsDisabled: false
      }];
    }
    if (request.range === "single") return getSingleUnit(start, level);
    if (request.range === "sentence") {
      return getCellUnits(start.rowIndex, start.columnIndex, level)
        .filter((unit) => unit.sentenceIndex === start.sentenceIndex
          && (level !== "word" || unit.wordIndex >= start.wordIndex));
    }
    if (request.range === "cellFromHere") {
      const units = getCellUnits(start.rowIndex, start.columnIndex, level)
        .filter((unit) => isUnitAtOrAfterCursor(unit, start, level));
      return applyPlaybackStart(units, request);
    }
    if (request.range === "row") return getRowUnits(start.rowIndex, level, includeSilent).filter((unit) => isUnitAtOrAfterCursor(unit, start, level));
    if (request.range === "column") return getColumnUnits(start.columnIndex, start.rowIndex, level, includeSilent).filter((unit) => isUnitAtOrAfterCursor(unit, start, level));
    if (request.range === "columnFromHere") return applyPlaybackStart(getColumnFromHereUnits(start, level, includeSilent), request);
    return applyPlaybackStart(getFromHereUnits(start, level, includeSilent), request);
  }

  function applyPlaybackStart(units, request) {
    if (request.unitLevel !== "sentence" || request.startUnitLevel !== "word" || !units.length) {
      return units;
    }
    const start = request.start;
    const sentenceUnits = units.filter((unit) => (
      unit.rowIndex === start.rowIndex
      && unit.columnIndex === start.columnIndex
      && unit.sentenceIndex === start.sentenceIndex
    ));
    const annotated = state.parsedViewMode === "reader" || state.items[start.rowIndex]?.sourceType === "section";
    const sourceUnit = annotated
      ? sentenceUnits.find((unit) => !unit.isTranslation)
      : sentenceUnits[0];
    const sentenceTail = getSentenceTailFromWord(start);
    if (!sourceUnit || !sentenceTail) return units;

    const remainingUnits = units.filter((unit) => !sentenceUnits.includes(unit));
    const translationUnits = annotated
      ? sentenceUnits.filter((unit) => unit.isTranslation)
      : sentenceUnits.filter((unit) => unit !== sourceUnit);
    return [{
      ...sourceUnit,
      text: sentenceTail,
      wordIndex: start.wordIndex,
      anchorWordIndex: start.wordIndex
    }, ...translationUnits.map(unit => ({ ...unit, sentenceWordAnchor: start.wordIndex })), ...remainingUnits];
  }

  function refreshPlaybackCell(queue, index, restart = false) {
    const first = queue[index];
    let end = index + 1;
    while (end < queue.length && queue[end].rowIndex === first.rowIndex
      && queue[end].columnIndex === first.columnIndex) end++;
    let fresh = getCellUnits(first.rowIndex, first.columnIndex, first.unitLevel, true);
    if (!restart) {
      if (first.sentenceWordAnchor !== undefined) {
        fresh = applyPlaybackStart(fresh, {
          unitLevel: first.unitLevel,
          startUnitLevel: "word",
          start: { ...first, wordIndex: first.sentenceWordAnchor }
        });
      }
      fresh = fresh.filter(unit => isUnitAtOrAfterCursor(unit, first, first.unitLevel));
      // Speech segments are independent of source-word navigation anchors.
      if (first.segmentIndex !== undefined && first.anchorWordIndex === undefined) {
        fresh = fresh.filter(unit => unit.sentenceIndex > first.sentenceIndex
          || unit.segmentIndex >= first.segmentIndex);
      }
      fresh = applyPlaybackStart(fresh, {
        unitLevel: first.unitLevel,
        startUnitLevel: first.anchorWordIndex === undefined ? first.unitLevel : "word",
        start: first
      });
    }
    const changed = fresh.length !== end - index || fresh.some((unit, offset) => {
      const old = queue[index + offset];
      return unit.text !== old.text || unit.language !== old.language
        || unit.wordIndex !== old.wordIndex || unit.sentenceIndex !== old.sentenceIndex
        || unit.isTranslation !== old.isTranslation;
    });
    if (changed) queue.splice(index, end - index, ...fresh);
    return { count: fresh.length, changed };
  }

  function getSentenceTailFromWord(cursor) {
    const part = state.items[cursor.rowIndex]?.parts[cursor.columnIndex];
    if (!part?.text) return "";
    const ranges = splitSentenceRangesForDisplay(part.text);
    const sentence = ranges[cursor.sentenceIndex];
    if (!sentence) return "";

    const language = state.parsedViewMode === "reader"
      ? state.targetLanguage
      : state.columnLanguages[cursor.columnIndex] || part.language || state.targetLanguage;
    const annotated = state.parsedViewMode === "reader" || state.items[cursor.rowIndex]?.sourceType === "section";
    const sourceText = annotated
      ? stripReaderAnnotations(sentence.text)
      : sentence.text;
    const wordsBeforeSentence = ranges
      .slice(0, cursor.sentenceIndex)
      .reduce((count, range) => (
        count + splitDisplayWords(
          annotated ? stripReaderAnnotations(range.text) : range.text,
          language
        ).length
      ), 0);
    const localWordIndex = Math.max(0, cursor.wordIndex - wordsBeforeSentence);
    const wordToken = splitDisplayWordTokens(sourceText, language)
      .filter((token) => token.clickable)[localWordIndex];
    return wordToken ? sourceText.slice(wordToken.start).trim() : "";
  }

  function getSingleUnit(cursor, level) {
    const units = getCellUnits(cursor.rowIndex, cursor.columnIndex, level);
    const selected = findUnitAtCursor(units, cursor);
    if ((state.parsedViewMode === "reader" || state.items[cursor.rowIndex]?.sourceType === "section") && selected && level !== "word") {
      if (level === "cell") return units;
      return units.filter((unit) => unit.sentenceIndex === selected.sentenceIndex);
    }
    return selected ? [selected] : units.slice(0, 1);
  }

  function getFromHereUnits(cursor, level, includeSilent = false) {
    return range(cursor.rowIndex, state.items.length).flatMap((rowIndex) => {
      const rowUnits = getRowUnits(rowIndex, level, includeSilent);
      return rowIndex === cursor.rowIndex ? rowUnits.filter((unit) => isUnitAtOrAfterCursor(unit, cursor, level)) : rowUnits;
    });
  }

  function getColumnFromHereUnits(cursor, level, includeSilent = false) {
    const columnCount = getColumnCount();
    return range(cursor.columnIndex, columnCount).flatMap((columnIndex) => {
      const columnUnits = getColumnUnits(columnIndex, columnIndex === cursor.columnIndex ? cursor.rowIndex : 0, level, includeSilent);
      return columnIndex === cursor.columnIndex ? columnUnits.filter((unit) => isUnitAtOrAfterCursor(unit, cursor, level)) : columnUnits;
    });
  }

  function getRowUnits(rowIndex, mode = "cell", includeSilent = false) {
    const item = state.items[rowIndex];
    if (!item) return [];
    return item.parts.flatMap((part, columnIndex) => getCellUnits(rowIndex, columnIndex, mode, includeSilent));
  }

  function getColumnUnits(columnIndex, startRowIndex = state.activeItemIndex, mode = "cell", includeSilent = false) {
    return range(startRowIndex, state.items.length).flatMap((rowIndex) => getCellUnits(rowIndex, columnIndex, mode, includeSilent));
  }

  function getCellUnits(rowIndex, columnIndex, mode, includeSilent = false) {
    const item = state.items[rowIndex];
    if (item?.sourceType === "instruction") return [];
    const part = item?.parts[columnIndex];
    if (state.parsedViewMode === "reader") return getReaderCellUnits(rowIndex, columnIndex, mode);
    const role = getEffectivePartRole(part, columnIndex);
    const language = state.columnLanguages[columnIndex] || part?.language || state.targetLanguage;
    if (!part?.text || (!includeSilent && ["mute", "hide"].includes(role))) return [];
    if (item.sourceType === "section") return getReaderCellUnits(rowIndex, columnIndex, mode, { language, optionalTranslations: false });
    if (mode === "word") {
      const sentences = splitSentencesForDisplay(part.text);
      let wordIndex = 0;
      const wordUnits = [];
      sentences.forEach((sentence, sentenceIndex) => {
        const words = splitDisplayWords(sentence, language);
        words.forEach((word) => {
          wordUnits.push({
            text: word,
            language,
            itemIndex: rowIndex,
            partIndex: columnIndex,
            rowIndex,
            columnIndex,
            sentenceIndex,
            wordIndex,
            unitLevel: "word",
            isTranslation: role === "translation",
            skipWhenTranslationsDisabled: false
          });
          wordIndex += 1;
        });
      });
      return wordUnits;
    }
    if (mode === "sentence") {
      return splitSentencesForDisplay(part.text).map((text, sentenceIndex) => ({
        text,
        language,
        itemIndex: rowIndex,
        partIndex: columnIndex,
        rowIndex,
        columnIndex,
        sentenceIndex,
        wordIndex: 0,
        unitLevel: "sentence",
        isTranslation: role === "translation",
        skipWhenTranslationsDisabled: false
      }));
    }
    return [{
      text: part.text,
      language,
      itemIndex: rowIndex,
      partIndex: columnIndex,
      rowIndex,
      columnIndex,
      sentenceIndex: 0,
      wordIndex: 0,
      unitLevel: "cell",
      isTranslation: role === "translation",
      skipWhenTranslationsDisabled: false
    }];
  }

  function getReaderCellUnits(rowIndex, columnIndex, mode, { language = state.targetLanguage, optionalTranslations = true } = {}) {
    const part = state.items[rowIndex]?.parts[columnIndex];
    if (!part?.text) return [];
    const sentences = splitSentencesForDisplay(part.text);
    if (mode === "word") {
      let wordIndex = 0;
      const wordUnits = [];
      sentences.forEach((sentence, sentenceIndex) => {
        const words = splitDisplayWords(stripReaderAnnotations(sentence), language);
        words.forEach((word) => {
          wordUnits.push({
            text: word,
            language,
            itemIndex: rowIndex,
            partIndex: columnIndex,
            rowIndex,
            columnIndex,
            sentenceIndex,
            wordIndex,
            unitLevel: "word",
            isTranslation: false,
            skipWhenTranslationsDisabled: false
          });
          wordIndex += 1;
        });
      });
      return wordUnits;
    }
    if (mode === "sentence") {
      const sentenceUnits = [];
      sentences.forEach((sentence, sentenceIndex) => {
        const segments = buildReaderSpeechSegments(sentence, language);
        if (!segments.length) return;
        segments.forEach((segment, segmentIndex) => {
          sentenceUnits.push({
            text: segment.text,
            language: segment.language,
            itemIndex: rowIndex,
            partIndex: columnIndex,
            rowIndex,
            columnIndex,
            sentenceIndex,
            wordIndex: segmentIndex,
            segmentIndex,
            unitLevel: "sentence",
            isTranslation: segment.isTranslation,
            skipWhenTranslationsDisabled: optionalTranslations && segment.skipWhenTranslationsDisabled
          });
        });
      });
      return sentenceUnits;
    }
    return buildReaderSpeechSegments(part.text, language).map((segment, segmentIndex) => ({
      text: segment.text,
      language: segment.language,
      itemIndex: rowIndex,
      partIndex: columnIndex,
      rowIndex,
      columnIndex,
      sentenceIndex: 0,
      wordIndex: segmentIndex,
      segmentIndex,
      unitLevel: "cell",
      isTranslation: segment.isTranslation,
      skipWhenTranslationsDisabled: optionalTranslations && segment.skipWhenTranslationsDisabled
    }));
  }

  function buildReaderSpeechSegments(text, sourceLanguage = state.targetLanguage) {
    const source = String(text || "");
    const segments = [];
    forEachReaderDisplaySegment(source, (segment) => {
      if (segment.note) return;
      if (segment.translation) {
        const translation = stripReaderNotes(segment.text).trim();
        if (translation && /\p{L}|\p{N}/u.test(translation)) {
          segments.push({
            text: translation,
            language: state.translationLanguage,
            isTranslation: true,
            skipWhenTranslationsDisabled: true
          });
        }
        return;
      }
      const textSegment = (segment.link ? segment.text : stripReaderAnnotations(segment.text)).trim();
      if (textSegment && /\p{L}|\p{N}/u.test(textSegment)) {
        segments.push({
          text: textSegment,
          language: sourceLanguage,
          isTranslation: false,
          skipWhenTranslationsDisabled: false
        });
      }
    });
    return segments;
  }

  function isUnitAtOrAfterCursor(unit, cursor, level) {
    if (unit.rowIndex < cursor.rowIndex) return false;
    if (unit.rowIndex > cursor.rowIndex) return true;
    if (unit.columnIndex < cursor.columnIndex) return false;
    if (unit.columnIndex > cursor.columnIndex) return true;
    if (level === "word") return unit.wordIndex >= (cursor.wordIndex || 0);
    if (level === "sentence") return unit.sentenceIndex >= (cursor.sentenceIndex || 0);
    return true;
  }

  function findUnitAtCursor(units, cursor) {
    return units.find((unit) => unit.rowIndex === cursor.rowIndex
      && unit.columnIndex === cursor.columnIndex
      && unit.sentenceIndex === (cursor.sentenceIndex || 0)
      && unit.wordIndex === (cursor.wordIndex || 0));
  }

  function getSelectionCursor(mode = getSelectionUnitMode(), cursor = state.activeUnitCursor) {
    const units = getCellUnits(cursor.rowIndex, cursor.columnIndex, mode);
    const inScope = (candidate) => mode === "cell" || candidate.sentenceIndex === cursor.sentenceIndex;
    const unit = mode === "word"
      ? findUnitAtCursor(units, cursor) || units.find((candidate) => inScope(candidate) && candidate.wordIndex >= cursor.wordIndex)
      : units.find((candidate) => inScope(candidate) && !candidate.isTranslation) || units.find(inScope);
    return unit ? cursorFromUnit(unit) : cursor;
  }

  function getColumnCount() {
    return state.items.length ? Math.max(...state.items.map((item) => item.parts.length)) : 0;
  }

  function findFirstPlayableCell() {
    for (let rowIndex = 0; rowIndex < state.items.length; rowIndex += 1) {
      const columnIndex = findFirstPlayableColumn(rowIndex);
      if (columnIndex >= 0) return { rowIndex, columnIndex };
    }
    return { rowIndex: 0, columnIndex: 0 };
  }

  function findFirstPlayableColumn(rowIndex) {
    const parts = state.items[rowIndex]?.parts || [];
    for (let columnIndex = 0; columnIndex < parts.length; columnIndex += 1) {
      if (getCellUnits(rowIndex, columnIndex, getPlaybackUnitLevel()).length) return columnIndex;
    }
    return -1;
  }

  function range(start, end) {
    return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
  }

  function forEachReaderDisplaySegment(text, callback) {
    const source = String(text || "");
    const links = findMarkdownLinks(source);
    if (links.length) {
      let cursor = 0;
      const append = end => forEachReaderDisplaySegment(source.slice(cursor, end), segment =>
        callback({ ...segment, start: segment.start + cursor, end: segment.end + cursor }));
      for (const link of links) {
        append(link.start);
        callback({ ...link, link: true, translation: false });
        cursor = link.end;
      }
      append(source.length);
      return;
    }
    let cursor = 0;
    const inlineRe = /(\[([^\]]+)\]|\{([^}]+)\})/g;
    let match;
    while ((match = inlineRe.exec(source))) {
      if (match.index > cursor) callback({
        text: source.slice(cursor, match.index),
        raw: source.slice(cursor, match.index),
        translation: false,
        start: cursor,
        end: match.index
      });
      callback({
        text: match[2] || match[3],
        raw: match[0],
        translation: match[2] !== undefined,
        note: match[3] !== undefined,
        start: match.index,
        end: match.index + match[0].length
      });
      cursor = match.index + match[0].length;
    }
    if (cursor < source.length) callback({
      text: source.slice(cursor),
      raw: source.slice(cursor),
      translation: false,
      start: cursor,
      end: source.length
    });
  }

  function splitDisplayWords(text, language = state.targetLanguage) {
    return splitDisplayWordTokens(text, language).filter(token => token.clickable).map(token => token.text);
  }

  function stripReaderTranslations(text) {
    let result = "";
    forEachReaderDisplaySegment(text, segment => { result += segment.translation ? " " : segment.raw; });
    return result.replace(/\s+/g, " ").trim();
  }

  function stripReaderNotes(text) {
    if (findMarkdownLinks(text).length) {
      let result = "";
      forEachReaderDisplaySegment(text, segment => { result += segment.note ? " " : segment.raw; });
      return result.replace(/\s+/g, " ").trim();
    }
    return String(text || "").replace(/\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
  }

  function stripReaderAnnotations(text) {
    return stripReaderNotes(stripReaderTranslations(text));
  }

  function normalizeSpeechText(text, language = state.targetLanguage) {
    let source = mapMarkdownLinks(text, link => link.text).trim();
    if (/^de(-|$)/i.test(language) && /^[A-Z]$/.test(source)) source = source.toLowerCase();
    return filterSpeechText(source, language);
  }

  function splitReaderSentences(text) {
    const sentences = splitSentencesForDisplay(text).filter((sentence) => stripReaderAnnotations(sentence));
    return sentences.length ? sentences : [String(text || "").trim()].filter(stripReaderAnnotations);
  }

  function splitDisplayWordTokens(text, language = state.targetLanguage) {
    const source = String(text || "");
    if (findMarkdownLinks(source).length) {
      return splitWordTokens(source, language).flatMap(token => {
        if (token.link || !/^zh(-|$)/i.test(language)) return [token];
        return splitDisplayWordTokens(token.text, language).map(part => ({
          ...part, start: part.start + token.start, end: part.end + token.start
        }));
      });
    }
    if (/^zh(-|$)/i.test(language)) {
      let offset = 0;
      return [...source].map((char) => {
        const token = {
          text: char,
          clickable: /\S/.test(char),
          start: offset,
          end: offset + char.length
        };
        offset += char.length;
        return token;
      });
    }
    return splitWordTokens(source, language);
  }

  function splitSentenceRangesForDisplay(text) {
    return splitSentenceRanges(text);
  }

  function splitSentencesForDisplay(text) {
    return splitSentenceRangesForDisplay(text).map((range) => range.text);
  }

  function getSentenceIndexAtOffset(text, offset) {
    const ranges = splitSentenceRangesForDisplay(text);
    const index = ranges.findIndex((range) => offset >= range.start && offset <= range.end);
    if (index >= 0) return index;
    for (let previous = ranges.length - 1; previous >= 0; previous -= 1) {
      if (ranges[previous].end < offset) return previous;
    }
    return 0;
  }

  return { getValidClickMode, getClickUnitMode, getClickUnitModeForValue, getClickUnitLevel, getSelectionUnitMode, getRenderClickMode, getPlaybackUnitLevel, getValidPlaybackUnit, isFromHereClickMode, getEffectiveClickMode, findHorizontalKeyboardTarget, findVerticalKeyboardTarget, getKeyboardUnits, canUseKeyboardTarget, buildClickPlaybackRequest, buildButtonPlaybackRequest, buildPlaybackRequest, getAutoPlaybackRange, getPlaybackStartCursor, normalizePlaybackCursor, isRowPlayable, buildPlaybackUnits, refreshPlaybackCell, applyPlaybackStart, getSentenceTailFromWord, getSingleUnit, getFromHereUnits, getColumnFromHereUnits, getRowUnits, getColumnUnits, getCellUnits, getReaderCellUnits, buildReaderSpeechSegments, isUnitAtOrAfterCursor, findUnitAtCursor, getSelectionCursor, getColumnCount, findFirstPlayableCell, findFirstPlayableColumn, range, forEachReaderDisplaySegment, splitDisplayWords, stripReaderTranslations, stripReaderNotes, stripReaderAnnotations, normalizeSpeechText, splitReaderSentences, splitDisplayWordTokens, splitSentenceRangesForDisplay, splitSentencesForDisplay, getSentenceIndexAtOffset };
}
