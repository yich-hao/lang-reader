import { flattenStudyCardsForScopes, normalizeProgressTuple, updateStudyProgress } from "./model.js";
import { canonicalLanguageTag, splitGraphemes } from "../i18n/languages.js";

export const STUDY_ORDERS = ["sequential", "random", "mistakes"];
export const MAX_STUDY_ANSWER_LENGTH = 10000;
export function createStudySession({
  document,
  mode = "learn",
  order = "sequential",
  size = 0,
  scopePaths = [[]],
  cardEntries = null,
  round = "standard",
  random = Math.random
}) {
  let queue = Array.isArray(cardEntries)
    ? [...cardEntries]
    : flattenStudyCardsForScopes(document, scopePaths);
  if (order === "random" && round !== "mistakes") queue = shuffle(queue, random);
  if (order === "mistakes") queue = [...queue].sort((left, right) =>
    getFailurePriority(right.card, mode) - getFailurePriority(left.card, mode)
  );
  const limit = normalizeStudySize(size);
  if (limit) queue = queue.slice(0, limit);
  return {
    mode,
    language: document?.target || "de",
    order,
    size: limit,
    round,
    scopePaths: scopePaths.map((path) => [...path]),
    queue,
    index: 0,
    activeIndex: 0,
    revealed: mode === "learn",
    checked: false,
    graded: false,
    answer: "",
    lastCorrect: null,
    lastFuzzy: false,
    lastSeverity: null,
    lastPassed: null,
    mistakes: [],
    results: Array(queue.length).fill(null),
    answers: Array(queue.length).fill(""),
    fuzzyResults: Array(queue.length).fill(false),
    severityResults: Array(queue.length).fill(null),
    resultSnapshots: Array(queue.length).fill(null),
    completed: !queue.length,
    initialCount: queue.length,
    completedCount: 0
  };
}

export function normalizeStudySize(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 0;
}

export function studySetupSize(total, value) {
  return total <= 10 ? 0 : normalizeStudySize(value);
}

export function getCurrentStudyCard(session) {
  return session?.queue?.[session.index] || null;
}

export function checkStudyAnswer(session, answer, options = {}) {
  const current = getCurrentStudyCard(session);
  if (!current || session.graded) {
    return { correct: false, expected: "", fuzzy: false, severity: "wrong", errorRatio: 1 };
  }
  const expected = current.card.vocab;
  const tooLong = String(answer || "").length > MAX_STUDY_ANSWER_LENGTH || expected.length > MAX_STUDY_ANSWER_LENGTH;
  answer = String(answer || "").slice(0, MAX_STUDY_ANSWER_LENGTH);
  const literalUser = normalizeLiteralAnswer(answer);
  const literalExpected = normalizeLiteralAnswer(expected.slice(0, MAX_STUDY_ANSWER_LENGTH));
  const normUser = normalizeAnswer(answer, session.language);
  const normExpected = normalizeAnswer(expected.slice(0, MAX_STUDY_ANSWER_LENGTH), session.language);
  const exactMatch = !tooLong && literalUser === literalExpected;
  const fuzzyEnabled = !tooLong && Boolean(options.fuzzyDictation ?? session?.fuzzyDictation ?? true);
  const fuzzyMatch = !exactMatch && fuzzyEnabled && isFuzzyEquivalent(normUser, normExpected, session.language);

  const correct = exactMatch || fuzzyMatch;
  const fuzzyUser = normalizeFuzzy(normUser, session.language);
  const fuzzyExpected = normalizeFuzzy(normExpected, session.language);
  const distance = tooLong ? 0 : levenshteinDistance(fuzzyUser, fuzzyExpected);
  const errorRatio = tooLong ? 1 : distance / Math.max(
    splitGraphemes(fuzzyUser).length,
    splitGraphemes(fuzzyExpected).length,
    1
  );
  const severity = correct ? "correct" : (errorRatio > 0.4 ? "wrong" : "close");
  session.answer = String(answer || "");
  session.checked = true;
  session.revealed = true;
  session.lastCorrect = correct;
  session.lastFuzzy = fuzzyMatch;
  session.lastSeverity = severity;
  session.answers[session.index] = session.answer;
  session.fuzzyResults[session.index] = fuzzyMatch;
  session.severityResults[session.index] = severity;
  return { correct, expected, fuzzy: fuzzyMatch, severity, errorRatio };
}

export function submitStudyResult(session, passed, reviewedAt = new Date().toISOString()) {
  const current = getCurrentStudyCard(session);
  if (!current || session.completed) return session;
  const index = session.index;
  const nextPassed = Boolean(passed);
  const previousResult = session.results[index];
  if (previousResult === nextPassed) return session;
  if (previousResult === null) {
    session.resultSnapshots[index] = snapshotProgress(current.card, session.mode);
    session.completedCount += 1;
  } else {
    restoreProgress(current.card, session.mode, session.resultSnapshots[index]);
  }
  updateStudyProgress(current.card, session.mode, passed, reviewedAt);
  session.results[index] = nextPassed;
  session.graded = true;
  session.revealed = true;
  session.lastPassed = nextPassed;
  session.mistakes = session.queue.filter((entry, queueIndex) => session.results[queueIndex] === false);
  return session;
}

export function advanceStudySession(session) {
  if (!session || session.completed || !session.graded) return session;
  if (session.completedCount >= session.initialCount) {
    session.completed = true;
    return session;
  }
  session.index = findNextUngradedIndex(session);
  session.activeIndex = session.index;
  syncCurrentCardState(session);
  return session;
}

export function navigateStudySession(session, offset) {
  if (!session || session.completed || !session.initialCount) return session;
  const nextIndex = Math.max(0, Math.min(session.initialCount - 1, session.index + Number(offset || 0)));
  if (nextIndex === session.index) return session;
  session.index = nextIndex;
  syncCurrentCardState(session);
  return session;
}

export function returnToActiveStudyCard(session) {
  if (!session || session.completed || !session.initialCount) return session;
  session.index = Math.max(0, Math.min(session.initialCount - 1, session.activeIndex || 0));
  syncCurrentCardState(session);
  return session;
}

export function isStudySessionAtActiveCard(session) {
  return Boolean(session && session.index === session.activeIndex);
}

export function getStudySessionProgress(session) {
  if (!session?.queue?.length) return { current: 0, total: 0, ratio: 0 };
  const total = session.initialCount;
  const current = Math.min(session.index + 1, total);
  return {
    current,
    total,
    ratio: Math.min(1, session.completedCount / total)
  };
}

export function normalizeAnswer(value, language) {
  return normalizeLiteralAnswer(value)
    .toLocaleLowerCase(canonicalLanguageTag(language) || undefined);
}

function normalizeLiteralAnswer(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeFuzzy(value, language = "de") {
  const normalized = normalizeAnswer(value, language);
  if (!/^de(-|$)/i.test(language)) return normalized;
  return normalized
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss");
}

function normalizeGermanTransliteration(value) {
  return normalizeAnswer(value)
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function isFuzzyEquivalent(left, right, language = "de") {
  if (!left || !right) return false;
  if (!/^de(-|$)/i.test(language)) return left === right;
  const leftVariants = new Set([
    normalizeFuzzy(left),
    normalizeGermanTransliteration(left)
  ]);
  return [
    normalizeFuzzy(right),
    normalizeGermanTransliteration(right)
  ].some((variant) => leftVariants.has(variant));
}

function levenshteinDistance(left, right) {
  const source = splitGraphemes(left);
  const target = splitGraphemes(right);
  let previous = Array.from({ length: target.length + 1 }, (_, index) => index);

  source.forEach((sourceChar, sourceIndex) => {
    const current = [sourceIndex + 1];
    target.forEach((targetChar, targetIndex) => {
      current[targetIndex + 1] = Math.min(
        current[targetIndex] + 1,
        previous[targetIndex + 1] + 1,
        previous[targetIndex] + (sourceChar === targetChar ? 0 : 1)
      );
    });
    previous = current;
  });
  return previous[target.length];
}

function getFailurePriority(card, mode) {
  const tuple = normalizeProgressTuple(card?.progress?.[mode]);
  return tuple[2] * 3 - tuple[1] + (tuple[0] ? 0 : 1);
}

function findNextUngradedIndex(session) {
  for (let offset = 1; offset <= session.initialCount; offset += 1) {
    const index = (session.index + offset) % session.initialCount;
    if (session.results[index] === null) return index;
  }
  return session.index;
}

function syncCurrentCardState(session) {
  const result = session.results[session.index];
  session.revealed = session.mode === "learn" || result !== null;
  session.checked = session.mode === "dictation" && result !== null;
  session.graded = result !== null;
  session.answer = session.answers[session.index] || "";
  session.lastFuzzy = Boolean(session.fuzzyResults[session.index]);
  session.lastSeverity = session.severityResults[session.index]
    || (result === null ? null : (result ? "correct" : "wrong"));
  session.lastCorrect = session.mode === "dictation" ? result : null;
  session.lastPassed = result;
}

function snapshotProgress(card, mode) {
  const progress = card?.progress || {};
  return Object.hasOwn(progress, mode)
    ? { exists: true, value: [...progress[mode]] }
    : { exists: false, value: null };
}

function restoreProgress(card, mode, snapshot) {
  if (!card || !snapshot) return;
  const progress = { ...(card.progress || {}) };
  if (snapshot.exists) progress[mode] = [...snapshot.value];
  else delete progress[mode];
  if (Object.keys(progress).length) card.progress = progress;
  else delete card.progress;
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const next = Math.floor(random() * (index + 1));
    [result[index], result[next]] = [result[next], result[index]];
  }
  return result;
}
