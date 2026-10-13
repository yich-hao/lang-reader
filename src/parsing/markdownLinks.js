// Preserve explicit inline links across display and speech segmentation.
export function findMarkdownLinks(value) {
  const source = String(value || "");
  const links = [];
  const opening = /(?<!!)\[([^\]\n]+)\]\(/g;
  let match;
  while ((match = opening.exec(source))) {
    let cursor = opening.lastIndex;
    let depth = 1;
    for (; cursor < source.length && depth; cursor += 1) {
      if (source[cursor] === "\\") { cursor += 1; continue; }
      if (source[cursor] === "(") depth += 1;
      if (source[cursor] === ")") depth -= 1;
    }
    if (depth) continue;
    const destination = source.slice(opening.lastIndex, cursor - 1).trim();
    const target = destination.match(/^(?:<([^<>]*)>|(\S+?))(?:\s+["'][\s\S]*["'])?$/);
    if (!target) continue;
    const href = (target[1] ?? target[2]).replace(/\\([()])/g, "$1");
    const safe = !/[\u0000-\u0020\u007f]/.test(href)
      && (!/^[a-z][a-z\d+.-]*:/i.test(href) || /^(https?:|mailto:)/i.test(href));
    links.push({ start: match.index, end: cursor, raw: source.slice(match.index, cursor), text: match[1], href: safe ? href : null });
    opening.lastIndex = cursor;
  }
  return links;
}

export function mapMarkdownLinks(value, transform) {
  const source = String(value || "");
  let cursor = 0;
  let result = "";
  for (const link of findMarkdownLinks(source)) {
    result += source.slice(cursor, link.start) + transform(link);
    cursor = link.end;
  }
  return result + source.slice(cursor);
}
