import { cleanBullet, isLikelyExplanation, shouldSkipLine } from "./languageFilter.js";
import { splitSentences } from "./textSegmentation.js";

const DEFAULT_PART_LANGUAGES = ["de", "en", "de"];
const DEFAULT_PART_ROLES = ["word", "translation", "sentence"];

export function parseInput(rawText, options = {}) {
  const text = normalizeText(rawText);
  const partLanguages = options.partLanguages || DEFAULT_PART_LANGUAGES;
  const partRoles = options.partRoles || DEFAULT_PART_ROLES;
  const parseMode = options.parseMode || "auto";
  const targetLanguage = options.targetLanguage || "de";
  const translationLanguage = options.translationLanguage || "en";
  const paragraph = options.paragraph || {};
  if (!text.trim()) return [];

  const lines = splitInputLines(text);
  if (parseMode === "paragraph") return parseArticle(text, partLanguages, partRoles, targetLanguage, paragraph);

  const vocabularyStructure = analyzeVocabularyStructure(text);
  if (!vocabularyStructure.valid) {
    return parseArticle(text, partLanguages, partRoles, targetLanguage, paragraph);
  }

  if (vocabularyStructure.format === "markdown-table") {
    return parseMarkdownTable(lines, partLanguages, partRoles, targetLanguage, translationLanguage);
  }

  if (vocabularyStructure.format === "tsv-table") {
    return parseDelimitedTable(lines, (line) => line.split("\t"), "tsv-table", partLanguages, partRoles, targetLanguage, translationLanguage);
  }

  if (vocabularyStructure.format === "csv-table") {
    return parseDelimitedTable(lines, splitCsvRow, "csv-table", partLanguages, partRoles, targetLanguage, translationLanguage);
  }

  return parseVocabularyLines(lines, partLanguages, partRoles, targetLanguage, translationLanguage);
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .trim();
}

function splitInputLines(text) {
  let inFence = false;
  return text.split("\n").map(line => line.trim()).filter(line => {
    if (/^```/.test(line)) {
      inFence = !inFence;
      return true;
    }
    return inFence || Boolean(line);
  });
}

export function analyzeVocabularyStructure(rawText) {
  const text = normalizeText(rawText);
  if (!text) return createVocabularyAnalysis(false, "none");

  const lines = splitInputLines(text);
  if (looksLikeMarkdownTable(lines) && hasOnlyMarkdownTableContent(lines)) {
    return createVocabularyAnalysis(true, "markdown-table");
  }
  if (looksLikeTsv(lines) && hasOnlyDelimitedContent(lines, (line) => line.includes("\t"))) {
    return createVocabularyAnalysis(true, "tsv-table");
  }
  if (looksLikeCsv(lines) && hasOnlyDelimitedContent(lines, (line) => splitCsvRow(line).length >= 2)) {
    return createVocabularyAnalysis(true, "csv-table");
  }

  return analyzeCompactVocabulary(lines);
}

function createVocabularyAnalysis(valid, format, details = {}) {
  return {
    valid,
    format,
    structuredRows: details.structuredRows || 0,
    contentRows: details.contentRows || 0
  };
}

function hasOnlyMarkdownTableContent(lines) {
  let inFence = false;
  let tableRows = 0;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || isVocabularyContextLine(line)) continue;
    if (!line.includes("|")) return false;
    tableRows += 1;
  }
  return tableRows >= 2;
}

function hasOnlyDelimitedContent(lines, isDelimitedLine) {
  let inFence = false;
  let tableRows = 0;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || isVocabularyContextLine(line)) continue;
    if (!isDelimitedLine(line)) return false;
    tableRows += 1;
  }
  return tableRows >= 2;
}

function analyzeCompactVocabulary(lines) {
  let inFence = false;
  let contentRows = 0;
  let structuredRows = 0;
  let explicitBracketRows = 0;

  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || isVocabularyContextLine(line)) continue;

    contentRows += 1;
    const entries = splitInlineEntries(cleanBullet(line));
    const evidence = entries.map(analyzeVocabularyEntry);
    if (!evidence.length || evidence.some((entry) => !entry.structured)) continue;

    structuredRows += 1;
    if (evidence.every((entry) => entry.explicitBracket)) explicitBracketRows += 1;
  }

  const ratio = contentRows ? structuredRows / contentRows : 0;
  const repeatedStructure = structuredRows >= 2 && ratio >= 0.75;
  const singleExplicitPair = contentRows === 1 && explicitBracketRows === 1;
  return createVocabularyAnalysis(repeatedStructure || singleExplicitPair, "compact-vocabulary", {
    structuredRows,
    contentRows
  });
}

function isVocabularyContextLine(line) {
  return shouldSkipLine(line) || Boolean(parseMarkdownHeading(line));
}

function analyzeVocabularyEntry(line) {
  const source = String(line || "").trim();
  if (!source) return { structured: false, explicitBracket: false };

  const bracket = extractBracketTranslation(source);
  const split = splitVocabularyFields(bracket.text);
  const head = split.parts[0] || bracket.text;
  const hasTranslation = hasBracketTranslationSyntax(source) && Boolean(bracket.translation);
  const hasFieldDelimiter = Boolean(split.firstDelimiter) && split.parts.length >= 2;
  const explicitBracket = hasTranslation && looksLikeVocabularyHead(head);

  return {
    structured: hasFieldDelimiter || explicitBracket,
    explicitBracket
  };
}

function hasBracketTranslationSyntax(value) {
  const source = String(value || "");
  const openIndex = findTranslationBracket(source);
  if (openIndex < 0 || source[openIndex - 1] === "!") return false;
  const closeIndex = source.indexOf("]", openIndex + 1);
  return closeIndex < 0 || source[closeIndex + 1] !== "(";
}

function looksLikeVocabularyHead(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 80 || /[.!?。！？]\s*$/.test(text)) return false;
  const words = text.match(/\p{L}[\p{L}\p{M}'’-]*/gu) || [];
  return words.length > 0 && words.length <= 8;
}

function tableContentLines(lines) {
  let inFence = false;
  return lines.filter(line => {
    if (/^```/.test(line)) { inFence = !inFence; return false; }
    const separator = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
    return !inFence && (separator || !isVocabularyContextLine(line));
  });
}

function looksLikeMarkdownTable(lines) {
  lines = tableContentLines(lines);
  return lines.some((line) => line.includes("|")) && lines.some((line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line));
}

function parseMarkdownTable(lines, partLanguages, partRoles, targetLanguage, translationLanguage) {
  return parseTableWithContext(lines, splitMarkdownRow, "markdown-table", partRoles, targetLanguage, translationLanguage);
}

function splitMarkdownRow(line) {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function looksLikeTsv(lines) {
  lines = tableContentLines(lines);
  return lines.filter((line) => line.includes("\t")).length >= 2;
}

function looksLikeCsv(lines) {
  const rows = tableContentLines(lines).slice(0, 5).map(splitCsvRow);
  const firstTableRows = rows.slice(0, 2);
  return firstTableRows.length === 2
    && firstTableRows.every((row) => row.length >= 2)
    && firstTableRows[0].length === firstTableRows[1].length;
}

function splitCsvRow(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseDelimitedTable(lines, splitRow, sourceType, partLanguages, partRoles, targetLanguage, translationLanguage) {
  return parseTableWithContext(lines, splitRow, sourceType, partRoles, targetLanguage, translationLanguage);
}

function parseTableWithContext(lines, splitRow, sourceType, partRoles, targetLanguage, translationLanguage) {
  const items = [];
  let labels = [], targetIndex = 0, translationIndex = 1, firstRow = true;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/.test(line)) {
      const block = readFencedTextBlock(lines, index);
      if (block.text) items.push(createInstructionItem(`instruction-${items.length + 1}`, block.text, block.raw));
      index = block.nextIndex;
      continue;
    }
    const heading = parseMarkdownHeading(line);
    if (heading) {
      items.push(createSectionItem(`section-${items.length + 1}`, heading.text, line, targetLanguage));
      continue;
    }
    if (shouldSkipLine(line) || /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line)) continue;
    const cells = splitRow(line).map(cell => cell.trim());
    if (!cells.some(Boolean)) continue;
    if (firstRow) {
      firstRow = false;
      const headers = cells.map(cell => cell.toLowerCase());
      if (sourceType === "markdown-table" || headers.some(cell => ["deutsch", "german", "translation", "english", "中文"].includes(cell))) {
        labels = cells;
        targetIndex = findDeutschColumn(headers);
        translationIndex = findTranslationColumn(headers, targetIndex);
        continue;
      }
    }
    const item = createItem({
      id: `table-${items.length + 1}`, sourceType, parts: cells, partLabels: labels,
      partLanguages: cells.map((_, column) => column === targetIndex ? targetLanguage : column === translationIndex ? translationLanguage : "skip"),
      partRoles: cells.map((_, column) => column === targetIndex ? "word" : column === translationIndex ? "translation" : partRoles[column] || "skip"),
      raw: cells.join(" | "), targetLanguage
    });
    if (item.targetText) items.push(item);
  }
  return items;
}

function findDeutschColumn(headers) {
  const index = headers.findIndex((header) => /^(deutsch|german|de|wort|vokabel)/i.test(header));
  return index >= 0 ? index : 0;
}

function findTranslationColumn(headers, targetIndex) {
  const index = headers.findIndex((header, cellIndex) => cellIndex !== targetIndex && /(translation|english|englisch|中文|chinese|bedeutung|meaning)/i.test(header));
  return index >= 0 ? index : headers.findIndex((_, cellIndex) => cellIndex !== targetIndex);
}

function parseVocabularyLines(lines, partLanguages, partRoles, targetLanguage, translationLanguage = "en") {
  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (shouldSkipLine(line)) continue;
    if (/^```/.test(line)) {
      const block = readFencedTextBlock(lines, index);
      if (block.text) items.push(createInstructionItem(`instruction-${items.length + 1}`, block.text, block.raw));
      index = block.nextIndex;
      continue;
    }
    const heading = parseMarkdownHeading(line);
    if (heading) {
      items.push(createSectionItem(`section-${items.length + 1}`, heading.text, line, targetLanguage));
      continue;
    }
    const cleaned = cleanBullet(line);
    const entries = splitInlineEntries(cleaned).map(parseVocabularyEntry).filter((entry) => entry.parts.some(Boolean));
    if (!entries.length) continue;
    entries.forEach((entry) => {
      const roles = entry.parts.map((_, index) => partRoles[index] || (index === 0 ? "word" : index === 1 ? "translation" : "sentence"));
      const languages = roles.map((role, index) => role === "translation" ? partLanguages[index] || translationLanguage : partLanguages[index] || targetLanguage);
      const item = createItem({
        id: `vocab-${items.length + 1}`,
        sourceType: "vocabulary",
        parts: entry.parts,
        partLanguages: languages,
        partRoles: roles,
        partWarnings: entry.warnings,
        targetLanguage,
        raw: line
      });
      if (item.targetText || item.parts.length) items.push(item);
    });
  }
  return items;
}

function readFencedTextBlock(lines, index) {
  const raw = [lines[index]];
  const parts = [];
  let cursor = index + 1;
  while (cursor < lines.length && !/^```/.test(lines[cursor])) {
    raw.push(lines[cursor]);
    parts.push(lines[cursor]);
    cursor += 1;
  }
  if (cursor < lines.length) raw.push(lines[cursor]);
  return {
    text: parts.join("\n").trim(),
    raw: raw.join("\n"),
    nextIndex: cursor
  };
}

function parseVocabularyEntry(line) {
  const { text, translation, warning } = extractBracketTranslation(line);
  const split = splitVocabularyFields(text);
  const parts = split.parts;
  const warnings = split.parts.map(() => "");

  if (translation) {
    const first = parts[0] || text;
    const tail = parts.slice(1);
    return {
      parts: [first, translation, ...tail],
      warnings: ["", warning, ...tail.map(() => "")]
    };
  }
  if (split.firstDelimiter === "arrow" && parts.length >= 2) {
    return {
      parts: [parts[0], "", ...parts.slice(1)],
      warnings: ["", "", ...parts.slice(1).map(() => "")]
    };
  }
  if (parts.length) {
    return { parts, warnings };
  }
  return { parts: [line.trim()], warnings: [""] };
}

function splitVocabularyFields(line) {
  const source = String(line || "").trim();
  if (!source) return { parts: [], firstDelimiter: "" };
  const first = findFirstVocabularyDelimiter(source);
  if (!first) return { parts: [source], firstDelimiter: "" };
  if (first.type === "arrow") {
    const head = source.slice(0, first.index).trim();
    const tail = source.slice(first.index + first.length).trim();
    return {
      parts: [head, ...splitVocabularySeparators(tail)],
      firstDelimiter: "arrow"
    };
  }
  return {
    parts: splitVocabularySeparators(source),
    firstDelimiter: "separator"
  };
}

function findFirstVocabularyDelimiter(source) {
  let bracketDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const rest = source.slice(index);
    const char = source[index];
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (!bracketDepth) {
      const arrow = rest.match(/^(?:→|->|=>)/);
      if (arrow) {
        return { index, length: arrow[0].length, type: "arrow" };
      }
      const separator = rest.match(/^\s+(?:-|–|—|=)\s+/);
      if (separator) {
        return { index, length: separator[0].length, type: "separator" };
      }
    }
  }
  return null;
}

function splitVocabularySeparators(source) {
  const parts = [];
  let current = "";
  let bracketDepth = 0;
  const push = () => {
    const value = current.trim();
    if (value) parts.push(value);
    current = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const rest = source.slice(index);
    const char = source[index];
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (!bracketDepth) {
      const separator = rest.match(/^\s+(?:-|–|—|=)\s+/);
      if (separator) {
        push();
        index += separator[0].length - 1;
        continue;
      }
    }
    current += char;
  }
  push();
  return parts.length ? parts : [source.trim()].filter(Boolean);
}

function splitInlineEntries(line) {
  const entries = [];
  let current = "";
  let bracketDepth = 0;
  String(line || "").split("").forEach((char) => {
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === ";" && !bracketDepth) {
      if (current.trim()) entries.push(current.trim());
      current = "";
      return;
    }
    current += char;
  });
  if (current.trim()) entries.push(current.trim());
  return entries;
}

function parseArticle(text, partLanguages, partRoles, targetLanguage, paragraph) {
  return splitParagraphs(text, paragraph).map((raw, index) => {
    const heading = parseMarkdownHeading(raw);
    if (heading) return createSectionItem(`section-${index + 1}`, heading.text, raw, targetLanguage);
    const cleaned = cleanMarkdownText(raw);
    if (!cleaned || isLikelyExplanation(cleaned)) return null;
    return createItem({
      id: `sentence-${index + 1}`,
      sourceType: "plain-text",
      parts: [cleaned],
      partLanguages: [partLanguages[0] || targetLanguage],
      partRoles: [partRoles[0] === "translation" ? "sentence" : partRoles[0] || "sentence"],
      partWarnings: [hasUnclosedBracket(cleaned) ? "missing-closing-bracket" : ""],
      targetLanguage,
      raw
    });
  }).filter(Boolean);
}

function splitParagraphs(text, paragraph = {}) {
  const mode = paragraph.mode || "newline";
  if (mode === "newline") return text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  if (mode === "dash") return text.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (mode === "regex" && paragraph.pattern) {
    try {
      return text.split(new RegExp(paragraph.pattern)).map((part) => part.trim()).filter(Boolean);
    } catch {
      return text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
    }
  }
  return splitSentences(text, { collapseNewlines: true });
}

function createItem({ id, sourceType, parts, partLanguages, partRoles, partLabels = [], partWarnings = [], targetLanguage = "de", raw }) {
  const normalizedParts = parts.map((text, index) => ({
    index,
    text: cleanMarkdownText(text),
    language: partLanguages[index] || "skip",
    role: partRoles[index] === "skip" ? "mute" : partRoles[index] || "mute",
    label: partLabels[index] || "",
    warning: partWarnings[index] || ""
  }));

  return refreshItemMetadata({ id, sourceType, parts: normalizedParts, raw });
}

export function refreshItemMetadata(item) {
  const playableParts = item.parts.filter((part) => part.text && !["mute", "hide", "translationMute", "instruction"].includes(part.role));
  const translationParts = item.parts.filter((part) => part.text && (part.role === "translation" || part.role === "translationMute"));
  const wordParts = playableParts.filter((part) => part.role === "word");
  const sentenceParts = playableParts.filter((part) => part.role === "sentence" || part.role === "translation");
  const targetText = playableParts.map((part) => part.text).join(" ");

  return Object.assign(item, {
    targetText,
    playableParts,
    translationText: translationParts.map((part) => part.text).join(" / "),
    sentences: sentenceParts.length
      ? sentenceParts.flatMap((part) => splitSentences(part.text, { collapseNewlines: true }))
      : splitSentences(targetText, { collapseNewlines: true }),
    words: wordParts.length ? wordParts.flatMap((part) => splitWords(part.text)) : splitWords(targetText),
  });
}

function createSectionItem(id, text, raw, targetLanguage = "de") {
  return createItem({
    id,
    sourceType: "section",
    parts: [text],
    partLanguages: [targetLanguage],
    partRoles: ["section"],
    targetLanguage,
    raw
  });
}

function createInstructionItem(id, text, raw) {
  return createItem({
    id,
    sourceType: "instruction",
    parts: [text],
    partLanguages: ["skip"],
    partRoles: ["instruction"],
    targetLanguage: "de",
    raw
  });
}

function parseMarkdownHeading(line) {
  const match = String(line || "").match(/^(#{1,6})\s+(.+)$/);
  if (!match) return null;
  return {
    level: match[1].length,
    text: cleanMarkdownText(match[2])
  };
}

function findTranslationBracket(source) {
  let openIndex = source.indexOf("[");
  while (openIndex >= 0) {
    const close = source.indexOf("]", openIndex + 1);
    if (close < 0 || source[close + 1] !== "(") break;
    const linkEnd = source.indexOf(")", close + 2);
    if (linkEnd < 0) break;
    openIndex = source.indexOf("[", linkEnd + 1);
  }
  return openIndex;
}

function extractBracketTranslation(line) {
  const source = String(line || "").trim();
  const openIndex = findTranslationBracket(source);
  if (openIndex < 0) return { text: source, translation: "", warning: "" };
  const closeIndex = source.indexOf("]", openIndex + 1);
  if (closeIndex < 0) {
    return {
      text: source.slice(0, openIndex).trim(),
      translation: source.slice(openIndex + 1).trim(),
      warning: "missing-closing-bracket"
    };
  }
  return {
    text: `${source.slice(0, openIndex)} ${source.slice(closeIndex + 1)}`.trim(),
    translation: source.slice(openIndex + 1, closeIndex).trim(),
    warning: ""
  };
}

function hasUnclosedBracket(line) {
  const source = String(line || "");
  const openIndex = source.indexOf("[");
  if (openIndex < 0) return false;
  return source.indexOf("]", openIndex + 1) < 0;
}

function cleanMarkdownText(text) {
  return String(text || "")
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^(?:>\s*)+/, "")
    .replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
    .replace(/^[-*+]\s+(?=\S)/, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/<\/?mark>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitWords(text) {
  return text
    .split(/[\s,;:!?()"'„“”]+/)
    .map((word) => word.trim())
    .filter((word) => /\p{L}/u.test(word));
}
