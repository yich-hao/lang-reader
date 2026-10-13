const TABLE_SEPARATOR_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;

import { mapMarkdownLinks } from "./markdownLinks.js";

export function parseMarkdownReader(rawText) {
  const normalized = normalizeMarkdown(rawText);
  if (typeof window !== "undefined" && window.marked && typeof window.marked.lexer === "function") {
    try {
      const tokens = window.marked.lexer(normalized);
      return normalizeMarkedTokens(tokens);
    } catch (error) {
      window.console.warn("marked.lexer failed, falling back to custom parser:", error);
    }
  }

  const lines = normalized.split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line.trim())) {
      const code = readCodeBlock(lines, index);
      blocks.push(code.block);
      index = code.nextIndex;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: cleanInlineMarkdown(heading[2]) });
      index += 1;
      continue;
    }

    if (looksLikeTableStart(lines, index)) {
      const table = readTable(lines, index);
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = readPrefixedBlock(lines, index, /^\s*>\s?/, "blockquote");
      blocks.push(quote.block);
      index = quote.nextIndex;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const list = readList(lines, index);
      blocks.push(list.block);
      index = list.nextIndex;
      continue;
    }

    const paragraph = readParagraph(lines, index);
    blocks.push(paragraph.block);
    index = paragraph.nextIndex;
  }

  return blocks.filter((block) => block.type === "table" || block.text || block.items?.length);
}

export function cleanInlineMarkdown(text) {
  const links = [];
  const protectedText = mapMarkdownLinks(text, link => {
    links.push(link.raw);
    return `\uE000${links.length - 1}\uE001`;
  });
  return protectedText
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/\uE000(\d+)\uE001/g, (_, index) => links[Number(index)] ?? "");
}

function normalizeMarkdown(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .trim();
}

function looksLikeTableStart(lines, index) {
  return lines[index]?.includes("|") && TABLE_SEPARATOR_RE.test(lines[index + 1] || "");
}

function readTable(lines, index) {
  const header = splitMarkdownRow(lines[index]);
  let cursor = index + 2;
  const rows = [];
  while (cursor < lines.length && lines[cursor].includes("|") && lines[cursor].trim()) {
    rows.push(splitMarkdownRow(lines[cursor]));
    cursor += 1;
  }
  return {
    block: {
      type: "table",
      headers: header.map(cleanInlineMarkdown),
      rows: rows.map((row) => row.map(cleanInlineMarkdown))
    },
    nextIndex: cursor
  };
}

function readCodeBlock(lines, index) {
  const opening = lines[index].trim();
  const language = opening.replace(/^```/, "").trim().toLowerCase();
  const parts = [];
  let cursor = index + 1;
  while (cursor < lines.length && !/^```/.test(lines[cursor].trim())) {
    parts.push(lines[cursor]);
    cursor += 1;
  }
  return {
    block: { type: "code", language, text: parts.join("\n").trim() },
    nextIndex: cursor < lines.length ? cursor + 1 : cursor
  };
}

function splitMarkdownRow(line) {
  return String(line || "")
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function readPrefixedBlock(lines, index, prefixRe, type) {
  const parts = [];
  let cursor = index;
  while (cursor < lines.length && prefixRe.test(lines[cursor])) {
    parts.push(lines[cursor].replace(prefixRe, ""));
    cursor += 1;
  }
  return {
    block: { type, text: cleanInlineMarkdown(parts.join(" ")) },
    nextIndex: cursor
  };
}

function readList(lines, index) {
  const items = [];
  let cursor = index;
  while (cursor < lines.length && /^\s*[-*+]\s+/.test(lines[cursor])) {
    items.push(cleanInlineMarkdown(lines[cursor].replace(/^\s*[-*+]\s+/, "")));
    cursor += 1;
  }
  return { block: { type: "list", items }, nextIndex: cursor };
}

function readParagraph(lines, index) {
  return {
    block: { type: "paragraph", text: cleanInlineMarkdown(lines[index]) },
    nextIndex: index + 1
  };
}

function normalizeMarkedTokens(tokens) {
  const blocks = [];
  tokens.forEach((token) => {
    if (token.type === "heading") {
      blocks.push({
        type: "heading",
        level: token.depth,
        text: cleanInlineMarkdown(token.text)
      });
    } else if (token.type === "blockquote") {
      blocks.push({
        type: "blockquote",
        text: cleanInlineMarkdown(token.text)
      });
    } else if (token.type === "list") {
      blocks.push({
        type: "list",
        items: token.items.map((item) => cleanInlineMarkdown(item.text))
      });
    } else if (token.type === "code") {
      blocks.push({
        type: "code",
        language: token.lang || "",
        text: token.text
      });
    } else if (token.type === "table") {
      const headers = token.header.map((h) => {
        const hText = typeof h === "object" ? h.text : h;
        return cleanInlineMarkdown(hText);
      });
      const rows = token.rows.map((row) => row.map((cell) => {
        const cText = typeof cell === "object" ? cell.text : cell;
        return cleanInlineMarkdown(cText);
      }));
      blocks.push({
        type: "table",
        headers,
        rows
      });
    } else if (token.type === "space") {
      // ignore
    } else {
      if (token.text) {
        blocks.push({
          type: "paragraph",
          text: cleanInlineMarkdown(token.text)
        });
      }
    }
  });
  return blocks;
}
