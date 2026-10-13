import { stableLocalSourceKey } from "../core/config.js";

export const STUDY_VERSION = 1;
export const STUDY_MODES = ["learn", "recall", "dictation"];

export async function createStudyDocument({
  items,
  columnRoles,
  source,
  rawText,
  targetLanguage,
  translationLanguage,
  vocabularyValid = true,
  previousDocument = null
}) {
  const built = buildStudyTree(items, columnRoles);
  if (!vocabularyValid || !built.cardCount) {
    return {
      valid: false,
      issues: !vocabularyValid
        ? [{ type: "invalid-vocabulary", rowIndex: -1 }]
        : built.issues.length
          ? built.issues
          : [{ type: "empty-vocabulary", rowIndex: -1 }],
      cardCount: built.cardCount,
      document: null
    };
  }

  const document = {
    version: STUDY_VERSION,
    source: normalizeStudySource(source),
    fileHash: await hashStudySource(rawText),
    target: targetLanguage,
    translation: translationLanguage,
    ...built.tree
  };

  return {
    valid: true,
    issues: built.issues,
    cardCount: built.cardCount,
    document: previousDocument ? reconcileStudyDocument(document, previousDocument) : document
  };
}

export function buildStudyTree(items, columnRoles = []) {
  const root = { cards: [], sections: [] };
  const stack = [{ level: 0, node: root }];
  const issues = [];
  let cardCount = 0;

  items.forEach((item, rowIndex) => {
    if (item?.sourceType === "instruction") return;
    if (item?.sourceType === "section") {
      const level = getHeadingLevel(item.raw);
      const section = { title: item.parts?.[0]?.text || "", cards: [], sections: [] };
      while (stack.length > 1 && stack.at(-1).level >= level) stack.pop();
      stack.at(-1).node.sections.push(section);
      stack.push({ level, node: section });
      return;
    }

    const card = createStudyCard(item, columnRoles);
    if (!card.vocab || !card.meaning) {
      issues.push({
        type: !card.vocab ? "missing-vocab" : "missing-meaning",
        rowIndex,
        raw: item?.raw || ""
      });
      return;
    }
    stack.at(-1).node.cards.push(card);
    cardCount += 1;
  });

  return { tree: pruneStudyNode(root), issues, cardCount };
}

export function createStudyCard(item, columnRoles = []) {
  const parts = Array.isArray(item?.parts) ? item.parts : [];
  const wordParts = [];
  const meaningParts = [];
  const sentenceParts = [];

  parts.forEach((part, index) => {
    const text = String(part?.text || "").trim();
    if (!text) return;
    const role = normalizeStudyRole(columnRoles[index] || part.role, index);
    if (role === "word") wordParts.push(text);
    else if (role === "translation") meaningParts.push(text);
    else if (!["mute", "hide", "instruction", "section"].includes(role)) sentenceParts.push(text);
  });

  const card = {
    vocab: wordParts.join(" / "),
    meaning: meaningParts.join(" / ")
  };
  if (sentenceParts.length) card.sentence = sentenceParts.join(" / ");
  return card;
}

export function reconcileStudyDocument(nextDocument, previousDocument) {
  if (!isStudyDocument(previousDocument)) return nextDocument;
  const previousSections = collectSectionCandidates(previousDocument.sections || []);
  const reconciled = {
    ...nextDocument,
    ...(nextDocument.cards?.length
      ? { cards: reconcileCards(nextDocument.cards, previousDocument.cards || []) }
      : {})
  };
  if (nextDocument.sections?.length) {
    reconciled.sections = nextDocument.sections.map((section) =>
      reconcileSection(section, takeSectionCandidate(previousSections, section), previousSections)
    );
  }
  return reconciled;
}

export function updateStudyProgress(card, mode, passed, reviewedAt = new Date().toISOString()) {
  if (!card || !STUDY_MODES.includes(mode)) return card;
  const progress = { ...(card.progress || {}) };
  const previous = normalizeProgressTuple(progress[mode]);
  progress[mode] = [
    reviewedAt,
    previous[1] + (passed ? 1 : 0),
    previous[2] + (passed ? 0 : 1),
    passed ? previous[3] + 1 : 0
  ];
  card.progress = progress;
  return card;
}

export function resetStudyProgress(cards) {
  (cards || []).forEach((entry) => {
    const card = entry?.card || entry;
    if (card && typeof card === "object") delete card.progress;
  });
}

export function getStudyStats(document, scopePaths = [[]]) {
  return getStudyStatsForCards(flattenStudyCardsForScopes(document, scopePaths));
}

export function getStudyStatsForCards(cards) {
  const stats = {
    cards: cards.length,
    reviewed: 0,
    correct: 0,
    incorrect: 0,
    passes: 0,
    failures: 0,
    byMode: Object.fromEntries(STUDY_MODES.map((mode) => [
      mode,
      { reviewed: 0, correct: 0, incorrect: 0, passes: 0, failures: 0 }
    ]))
  };
  cards.forEach(({ card }) => {
    let latest = null;
    STUDY_MODES.forEach((mode) => {
      const tuple = normalizeProgressTuple(card.progress?.[mode]);
      const attempts = tuple[1] + tuple[2];
      stats.byMode[mode].passes += tuple[1];
      stats.byMode[mode].failures += tuple[2];
      if (attempts) {
        stats.byMode[mode].reviewed += 1;
        if (tuple[3] > 0) stats.byMode[mode].correct += 1;
        else stats.byMode[mode].incorrect += 1;
        if (!latest || String(tuple[0]) > String(latest[0])) latest = tuple;
      }
      stats.passes += tuple[1];
      stats.failures += tuple[2];
    });
    if (!latest) return;
    stats.reviewed += 1;
    if (latest[3] > 0) stats.correct += 1;
    else stats.incorrect += 1;
  });
  return stats;
}

export function flattenStudyCards(document, scopePath = []) {
  const root = document || {};
  const scope = getStudySection(root, scopePath);
  if (!scope) return [];
  const cards = [];
  appendNodeCards(scope, scopePath, cards);
  return cards;
}

export function flattenStudyCardsForScopes(document, scopePaths = [[]]) {
  const paths = Array.isArray(scopePaths) && scopePaths.length ? scopePaths : [];
  const cards = [];
  const seen = new Set();
  paths.forEach((path) => {
    flattenStudyCards(document, Array.isArray(path) ? path : []).forEach((entry) => {
      if (seen.has(entry.card)) return;
      seen.add(entry.card);
      cards.push(entry);
    });
  });
  return cards;
}

export function listStudySections(document) {
  const sections = [{ path: [], title: "", depth: 0, cardCount: countNodeCards(document) }];
  appendSectionOptions(document?.sections || [], [], 1, sections);
  return sections;
}

export function mergeStudyProgressDeltas(baseDocument, localDocument, remoteDocument, { replaceProgress = false } = {}) {
  if (!isStudyDocument(remoteDocument)) return localDocument;
  if (!isStudyDocument(localDocument)) return remoteDocument;
  const structure = value => JSON.stringify(value, (key, entry) => key === "progress" || key === "fileHash" ? undefined : entry);
  const localChanged = structure(baseDocument) !== structure(localDocument);
  const merged = structuredCloneSafe(localChanged ? localDocument : remoteDocument);
  if (localChanged) appendRemoteAdditions(merged, baseDocument, remoteDocument);
  const baseCards = groupCardsBySignature(flattenStudyCards(baseDocument));
  const localCards = groupCardsBySignature(flattenStudyCards(localDocument));
  const remoteCards = groupCardsBySignature(flattenStudyCards(remoteDocument));

  flattenStudyCards(merged).forEach(({ card }) => {
    const signature = getCardSignature(card);
    const baseCard = shiftGroupedCard(baseCards, signature);
    const localCard = shiftGroupedCard(localCards, signature);
    const remoteCard = shiftGroupedCard(remoteCards, signature);
    if (!localCard || !remoteCard) return;
    if (replaceProgress) {
      if (localCard.progress) card.progress = structuredCloneSafe(localCard.progress);
      else delete card.progress;
      return;
    }
    card.progress = structuredCloneSafe(remoteCard.progress || {});
    STUDY_MODES.forEach((mode) => {
      const base = normalizeProgressTuple(baseCard?.progress?.[mode]);
      const local = normalizeProgressTuple(localCard.progress?.[mode]);
      const remote = normalizeProgressTuple(remoteCard.progress?.[mode]);
      if (baseCard?.progress?.[mode] && !localCard.progress?.[mode]) {
        delete card.progress[mode];
        return;
      }
      const passDelta = local[1] - base[1];
      const failDelta = local[2] - base[2];
      if (!passDelta && !failDelta) return;
      card.progress ||= {};
      card.progress[mode] = [
        latestTimestamp(remote[0], local[0]),
        Math.max(0, remote[1] + passDelta),
        Math.max(0, remote[2] + failDelta),
        local[0] >= remote[0] ? local[3] : remote[3]
      ];
    });
    if (!Object.keys(card.progress).length) delete card.progress;
  });
  if (localDocument.fileHash !== baseDocument?.fileHash) merged.fileHash = localDocument.fileHash;
  return merged;
}

function appendRemoteAdditions(local, base, remote) {
  for (const field of ["cards", "sections"]) {
    const signature = field === "cards" ? getCardSignature : section => section.title;
    const group = values => {
      const counts = new Map();
      return new Map((values || []).map(value => {
        const key = signature(value);
        const occurrence = counts.get(key) || 0;
        counts.set(key, occurrence + 1);
        return [JSON.stringify([key, occurrence]), value];
      }));
    };
    const baseEntries = group(base?.[field]);
    const localEntries = group(local[field]);
    for (const [key, value] of group(remote?.[field])) {
      if (!localEntries.has(key) && !baseEntries.has(key)) {
        (local[field] ||= []).push(structuredCloneSafe(value));
      } else if (field === "sections" && localEntries.has(key)) {
        appendRemoteAdditions(localEntries.get(key), baseEntries.get(key), value);
      }
    }
  }
}

export function studySourceIdentity(key, name) {
  if (key.startsWith("draft:")) return { source: `drafts/by-id/${encodeURIComponent(key.slice(6))}.md`, legacySource: `drafts/${name}` };
  if (key.startsWith("local-file:")) return { source: `imports/by-id/${encodeURIComponent(key.slice(11))}.md`, legacySource: `imports/${name}` };
  return { source: key.startsWith("folder:") ? `folders/${key.slice(7)}` : key || name, legacySource: "" };
}

export function isStudyDocument(value) {
  if (!value || typeof value !== "object" || Number(value.version) !== STUDY_VERSION) return false;
  if (!isBoundedString(value.source, 2048) || !isBoundedString(value.fileHash, 256)) return false;
  if (!isBoundedString(value.target, 16) || !isBoundedString(value.translation, 16)) return false;
  return validateStudyNode(value, 0);
}

function validateStudyNode(node, depth) {
  if (!node || typeof node !== "object" || depth > 32) return false;
  if (node.title !== undefined && !isBoundedString(node.title, 500, true)) return false;
  if (node.cards !== undefined && !Array.isArray(node.cards)) return false;
  if (node.sections !== undefined && !Array.isArray(node.sections)) return false;
  for (const card of node.cards || []) {
    if (!card || typeof card !== "object") return false;
    if (!isBoundedString(card.vocab, 5000) || !isBoundedString(card.meaning, 5000)) return false;
    if (card.sentence !== undefined && !isBoundedString(card.sentence, 10000, true)) return false;
    if (card.progress != null) {
      if (typeof card.progress !== "object" || Array.isArray(card.progress)) return false;
      for (const mode of STUDY_MODES) {
        const tuple = card.progress[mode];
        if (tuple != null && !isValidProgressTuple(tuple)) return false;
      }
    }
  }
  for (const section of node.sections || []) {
    if (!section || typeof section !== "object" || typeof section.title !== "string") return false;
    if (!validateStudyNode(section, depth + 1)) return false;
  }
  return true;
}

function isValidProgressTuple(value) {
  return Array.isArray(value)
    && value.length >= 3
    && value.length <= 4
    && typeof value[0] === "string"
    && value.slice(1).every((entry) => Number.isFinite(entry) && entry >= 0);
}

function isBoundedString(value, maxLength, allowEmpty = false) {
  return typeof value === "string"
    && value.length <= maxLength
    && (allowEmpty || value.trim().length > 0);
}

export function normalizeProgressTuple(value) {
  const source = Array.isArray(value) ? value : [];
  return [
    typeof source[0] === "string" ? source[0] : "",
    Math.max(0, Number(source[1]) || 0),
    Math.max(0, Number(source[2]) || 0),
    Math.max(0, Number(source[3]) || 0)
  ];
}

export function normalizeStudySource(value) {
  const source = String(value || "untitled.md")
    .replace(/\\/g, "/")
    .replace(/^[a-z-]+:/i, "")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return stableLocalSourceKey(source) || "untitled.md";
}

export async function hashStudySource(value) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (globalThis.crypto?.subtle && typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(normalized);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeStudyRole(role, index) {
  const normalized = String(role || "").toLowerCase();
  if (["word", "vocab", "vocabulary"].includes(normalized)) return "word";
  if (["translation", "translate", "meaning", "translationmute"].includes(normalized)) return "translation";
  if (["mute", "hide", "instruction", "section"].includes(normalized)) return normalized;
  return index === 0 ? "word" : index === 1 ? "translation" : "sentence";
}

function getHeadingLevel(raw) {
  return Math.max(1, Math.min(6, String(raw || "").match(/^\s*(#{1,6})\s/)?.[1].length || 1));
}

function pruneStudyNode(node) {
  const result = {};
  if (node.title !== undefined) result.title = node.title;
  if (node.cards?.length) result.cards = node.cards;
  if (node.sections?.length) result.sections = node.sections.map(pruneStudyNode);
  return result;
}

function reconcileSection(section, previous, candidates) {
  if (!previous || previous.title !== section.title) return section;
  const result = {
    title: section.title,
    ...(section.cards?.length ? { cards: reconcileCards(section.cards, previous.cards || []) } : {})
  };
  if (section.sections?.length) {
    result.sections = section.sections.map((child) =>
      reconcileSection(child, takeSectionCandidate(candidates, child), candidates)
    );
  }
  return result;
}

function reconcileCards(nextCards, previousCards) {
  const previousBySignature = groupCardsBySignature(previousCards.map((card) => ({ card })));
  return nextCards.map((card) => {
    const previous = shiftGroupedCard(previousBySignature, getCardSignature(card));
    return previous?.progress ? { ...card, progress: structuredCloneSafe(previous.progress) } : card;
  });
}

function collectSectionCandidates(sections, target = new Map()) {
  sections.forEach((section) => {
    const list = target.get(section.title) || [];
    list.push({ section, used: false, fingerprint: getSectionFingerprint(section) });
    target.set(section.title, list);
    collectSectionCandidates(section.sections || [], target);
  });
  return target;
}

function takeSectionCandidate(candidates, section) {
  const list = candidates.get(section.title) || [];
  const fingerprint = getSectionFingerprint(section);
  const exact = list.find((entry) => !entry.used && entry.fingerprint === fingerprint);
  const selected = exact || list.find((entry) => !entry.used);
  if (!selected) return null;
  selected.used = true;
  return selected.section;
}

function getSectionFingerprint(section) {
  const cards = (section.cards || []).map(getCardSignature).join("\u001e");
  const children = (section.sections || []).map(getSectionFingerprint).join("\u001d");
  return `${section.title}\u001f${cards}\u001c${children}`;
}

function getCardSignature(card) {
  return [card?.vocab || "", card?.meaning || "", card?.sentence || ""].join("\u001f");
}

function appendNodeCards(node, path, target) {
  (node.cards || []).forEach((card, index) => {
    target.push({ card, sectionPath: [...path], cardIndex: index });
  });
  (node.sections || []).forEach((section, index) => appendNodeCards(section, [...path, index], target));
}

function getStudySection(document, path) {
  let node = document;
  for (const index of path || []) {
    node = node?.sections?.[index];
    if (!node) return null;
  }
  return node;
}

function appendSectionOptions(sections, parentPath, depth, target) {
  sections.forEach((section, index) => {
    const path = [...parentPath, index];
    target.push({ path, title: section.title, depth, cardCount: countNodeCards(section) });
    appendSectionOptions(section.sections || [], path, depth + 1, target);
  });
}

function countNodeCards(node) {
  return (node?.cards?.length || 0)
    + (node?.sections || []).reduce((count, section) => count + countNodeCards(section), 0);
}

function groupCardsBySignature(entries) {
  const groups = new Map();
  (entries || []).forEach((entry) => {
    const card = entry.card || entry;
    const signature = getCardSignature(card);
    const list = groups.get(signature) || [];
    list.push(card);
    groups.set(signature, list);
  });
  return groups;
}

function shiftGroupedCard(groups, signature) {
  const list = groups.get(signature);
  return list?.shift() || null;
}

function latestTimestamp(first, second) {
  return String(first || "") >= String(second || "") ? String(first || "") : String(second || "");
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
