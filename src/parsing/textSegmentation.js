import { findMarkdownLinks } from "./markdownLinks.js";

export function splitSentenceRanges(text, { collapseNewlines = false } = {}) {
  const source = collapseNewlines
    ? String(text || "").replace(/\n+/g, " ")
    : String(text || "");
  const parts = [];
  let start = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  const links = new Map(findMarkdownLinks(source).map(link => [link.start, link]));

  for (let index = 0; index < source.length; index += 1) {
    if (links.has(index)) { index = links.get(index).end - 1; continue; }
    const char = source[index];
    if (char === "[") bracketDepth += 1;
    if (char === "]" && bracketDepth > 0) bracketDepth -= 1;
    if (char === "{") braceDepth += 1;
    if (char === "}" && braceDepth > 0) braceDepth -= 1;
    if (bracketDepth > 0 || braceDepth > 0) continue;

    const next = source[index + 1] || "";
    const sentenceEnd = getSentenceEnd(source, index);
    if (sentenceEnd) {
      pushSentenceRange(parts, source, start, sentenceEnd);
      start = sentenceEnd;
      index = sentenceEnd - 1;
      continue;
    }
    if (/[;；:：]/.test(char) && !isNumericSeparator(source, index)) {
      pushSentenceRange(parts, source, start, index + 1);
      start = index + 1;
      continue;
    }
    const arrowLength = source.startsWith("->", index) || source.startsWith("=>", index)
      ? 2
      : source.startsWith("→", index)
        ? 1
        : 0;
    if (arrowLength) {
      pushSentenceRange(parts, source, start, index + arrowLength);
      start = index + arrowLength;
      index += arrowLength - 1;
      continue;
    }
    if (/[–—-]/.test(char) && /\s/.test(source[index - 1] || "") && /\s/.test(next)) {
      pushSentenceRange(parts, source, start, index + 1);
      start = index + 1;
    }
  }

  pushSentenceRange(parts, source, start, source.length);
  return parts;
}

export function splitSentences(text, options) {
  return splitSentenceRanges(text, options).map((range) => range.text);
}

const wordSegmenters = new Map();

export function splitWordTokens(text, language = "en") {
  const source = String(text || "");
  const links = findMarkdownLinks(source);
  if (links.length) {
    const tokens = [];
    let cursor = 0;
    const append = end => tokens.push(...splitWordTokens(source.slice(cursor, end), language)
      .map(token => ({ ...token, start: token.start + cursor, end: token.end + cursor })));
    for (const link of links) {
      append(link.start);
      tokens.push({ ...link, clickable: true, link: true });
      cursor = link.end;
    }
    append(source.length);
    return tokens;
  }
  if (/^(ja|th|lo|km|my)(-|$)/i.test(language) && typeof Intl.Segmenter === "function") {
    try {
      if (!wordSegmenters.has(language)) {
        if (wordSegmenters.size >= 32) wordSegmenters.clear();
        wordSegmenters.set(language, new Intl.Segmenter(language, { granularity: "word" }));
      }
      return [...wordSegmenters.get(language).segment(source)].map(part => ({
        text: part.segment, clickable: Boolean(part.isWordLike), start: part.index, end: part.index + part.segment.length
      }));
    } catch { /* Preserve source offsets without Intl support. */ }
  }
  const tokens = [];
  const words = /[\p{L}\p{N}][\p{L}\p{M}\p{N}\u200c\u200d]*(?:[-'’][\p{L}\p{M}\p{N}\u200c\u200d]+)*/gu;
  let cursor = 0;
  for (const match of source.matchAll(words)) {
    if (match.index > cursor) tokens.push({ text: source.slice(cursor, match.index), clickable: false, start: cursor, end: match.index });
    const end = match.index + match[0].length;
    tokens.push({ text: match[0], clickable: true, start: match.index, end });
    cursor = end;
  }
  if (cursor < source.length) tokens.push({ text: source.slice(cursor), clickable: false, start: cursor, end: source.length });
  return tokens;
}

function getSentenceEnd(source, index) {
  const char = source[index];
  if (!/[.!?。！？．…؟।॥]/.test(char)) return 0;
  if (/[.．]/.test(char) && isNumericSeparator(source, index)) return 0;

  let end = index + 1;
  while (end < source.length && /[.!?。！？．…؟।॥]/.test(source[end])) end += 1;
  const terminal = source.slice(index, end);
  while (end < source.length && /["'‘’“”«»」』）)]/.test(source[end])) end += 1;
  const next = source[end] || "";
  // Keep trailing translations/notes with their source sentence.
  let annotated = false;
  for (;;) {
    let annotationStart = end;
    while (/\s/.test(source[annotationStart] || "")) annotationStart += 1;
    const annotationEnd = getAnnotationEnd(source, annotationStart);
    if (!annotationEnd) break;
    end = annotationEnd;
    annotated = true;
    while (end < source.length && /[.!?。！？．…؟।॥;；:："'‘’“”«»」』）)]/.test(source[end])) end += 1;
  }
  // CJK terminals and question/exclamation marks need no following space.
  return /[!?。！？؟।॥]/.test(terminal) || !next || /\s/u.test(next)
    || /\p{Script=Han}/u.test(next) || annotated ? end : 0;
}

function getAnnotationEnd(source, start) {
  if (findMarkdownLinks(source.slice(start))[0]?.start === 0) return 0;
  const open = source[start];
  const close = open === "[" ? "]" : open === "{" ? "}" : "";
  if (!close) return 0;
  let depth = 1;
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    if (source[index] === close) depth -= 1;
    if (!depth) return index + 1;
  }
  return 0;
}

function isNumericSeparator(source, index) {
  return /\p{N}/u.test(source[index - 1] || "")
    && /\p{N}/u.test(source[index + 1] || "");
}

function pushSentenceRange(parts, source, start, end) {
  const raw = source.slice(start, end);
  const text = raw.trim();
  if (!text) return;
  const leadingTrim = raw.length - raw.trimStart().length;
  const trailingTrim = raw.length - raw.trimEnd().length;
  parts.push({
    text,
    start: start + leadingTrim,
    end: end - trailingTrim
  });
}
