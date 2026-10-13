export function groupSourceSelection(document, parent) {
  const children = Array.from(parent.childNodes);
  const grouped = [];
  let cell = null;
  let sentence = null;
  children.forEach((node) => {
    if (node.dataset?.itemIndex === undefined) {
      if (node.nodeType === 3 && sentence) sentence.append(node);
      else {
        grouped.push(node);
        cell = null;
        sentence = null;
      }
      return;
    }
    if (!cell) {
      cell = document.createElement("span");
      cell.className = "source-selection-group";
      cell.dataset.itemIndex = node.dataset.itemIndex;
      cell.dataset.columnIndex = node.dataset.columnIndex || "0";
      cell.dataset.selectionLevel = "cell";
      grouped.push(cell);
    }
    if (!sentence || sentence.dataset.sentenceIndex !== node.dataset.sentenceIndex) {
      sentence = document.createElement("span");
      sentence.className = "source-selection-group";
      sentence.dataset.itemIndex = cell.dataset.itemIndex;
      sentence.dataset.columnIndex = cell.dataset.columnIndex;
      sentence.dataset.sentenceIndex = node.dataset.sentenceIndex || "0";
      sentence.dataset.selectionLevel = "sentence";
      cell.append(sentence);
    }
    sentence.append(node);
  });
  parent.replaceChildren(...grouped);
}

export function createReaderView({ document, container, getBlocks, getEffectiveClickMode, getPointerUnitMode, getTargetLanguage,
  createInteractiveTextUnit, forEachReaderDisplaySegment, splitDisplayWordTokens,
  getSentenceIndexAtOffset, splitSentenceRangesForDisplay, onSourceActivate, onTranslationActivate, onRendered }) {
  function renderReaderView() {
    const reader = document.createElement("article");
    reader.className = "reader-view";
  
    const indicator = document.createElement("div");
    indicator.id = "readerActiveIndicator";
    reader.append(indicator);

    getBlocks().forEach((block) => reader.append(renderReaderBlock(block)));
    container.append(reader);
    onRendered();
  }

  function renderReaderBlock(block) {
    if (block.type === "heading") {
      const level = Math.min(6, Math.max(1, block.level || 2));
      const heading = document.createElement(`h${level}`);
      heading.className = "reader-heading";
      heading.append(renderReaderInline(block.text, block.itemIndex));
      return heading;
    }
    if (block.type === "blockquote") {
      const quote = document.createElement("blockquote");
      quote.className = "reader-blockquote";
      quote.append(renderReaderInline(block.text, block.itemIndex));
      return quote;
    }
    if (block.type === "list") {
      const list = document.createElement("ul");
      list.className = "reader-list";
      block.items.forEach((item) => {
        const li = document.createElement("li");
        li.append(renderReaderInline(item.text, item.itemIndex));
        list.append(li);
      });
      return list;
    }
    if (block.type === "code") {
      const pre = document.createElement("pre");
      pre.className = "reader-code-block";
      pre.textContent = block.text;
      return pre;
    }
    if (block.type === "table") {
      return renderReaderTable(block);
    }
    const paragraph = document.createElement("p");
    paragraph.className = "reader-paragraph";
    paragraph.append(renderReaderInline(block.text, block.itemIndex));
    return paragraph;
  }

  function renderReaderTable(block) {
    const table = document.createElement("table");
    table.className = "reader-markdown-table";
    if (block.headers.length) {
      const thead = document.createElement("thead");
      const row = document.createElement("tr");
      block.headers.forEach((header) => {
        const th = document.createElement("th");
        th.append(renderReaderInline(header, -1));
        row.append(th);
      });
      thead.append(row);
      table.append(thead);
    }
    const tbody = document.createElement("tbody");
    block.rows.forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((cell) => {
        const td = document.createElement("td");
        td.dataset.itemIndex = String(cell.itemIndex);
        td.dataset.columnIndex = String(cell.columnIndex);
        td.append(renderReaderInline(cell.text, cell.itemIndex, cell.columnIndex));
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(tbody);
    return table;
  }

  function renderReaderInline(text, itemIndex, columnIndex = 0) {
    const wrap = document.createElement("span");
    wrap.className = "reader-inline";
    wrap.dir = "auto";
    if (itemIndex === undefined || itemIndex === null || itemIndex < 0) {
      forEachReaderDisplaySegment(text, segment => {
        if (segment.link) wrap.append(createReaderLink(segment, -1, { unitLevel: "word" }));
        else wrap.append(document.createTextNode(segment.raw));
      });
      return wrap;
    }
    wrap.addEventListener("click", (event) => {
      if (!getPointerUnitMode || getPointerUnitMode() === "word") return;
      if (event.target !== wrap && !event.target?.classList?.contains("selection-fragment")
        && !event.target?.classList?.contains("source-selection-group")) return;
      event.stopPropagation();
      onSourceActivate(itemIndex, {
        unitLevel: getPointerUnitMode(), columnIndex,
        sentenceIndex: Number(event.target?.dataset?.sentenceIndex || 0), wordIndex: 0
      });
    });
    const mode = getEffectiveClickMode();
    if (mode === "paragraph" || mode === "cell") {
      appendReaderUnitSegments(wrap, text, itemIndex, {
        unitLevel: "cell",
        sentenceIndex: 0,
        wordIndex: 0,
        unitIndex: 0,
        columnIndex,
        groupId: `reader-${itemIndex}-${columnIndex}-cell-0`
      });
      groupSourceSelection(document, wrap);
      return wrap;
    }
    if (mode === "word" || mode === "fromHereWord") {
      renderReaderWords(wrap, text, itemIndex, columnIndex, mode === "fromHereWord");
      groupSourceSelection(document, wrap);
      return wrap;
    }
    renderReaderSentences(wrap, text, itemIndex, columnIndex, mode === "fromHereSentence");
    groupSourceSelection(document, wrap);
    return wrap;
  }

  function renderReaderWords(wrap, text, itemIndex, columnIndex, fromHere) {
    let wordIndex = 0;
    forEachReaderDisplaySegment(text, (segment) => {
      if (segment.link) {
        wrap.append(createReaderLink(segment, itemIndex, {
          unitLevel: "word", columnIndex, wordIndex: wordIndex++,
          sentenceIndex: getSentenceIndexAtOffset(text, segment.start)
        }));
        return;
      }
      if (segment.translation) {
        wrap.append(createReaderTranslationUnit(segment.raw, segment.text, {
          itemIndex,
          columnIndex,
          sentenceIndex: getSentenceIndexAtOffset(text, segment.start),
          wordIndex
        }));
        return;
      }
      if (segment.note) {
        wrap.append(createReaderNote(segment.raw));
        return;
      }
      const tokens = splitDisplayWordTokens(segment.text, getTargetLanguage());
      let segmentOffset = 0;
      tokens.forEach((token) => {
        if (!token.clickable) {
          const fragment = document.createElement("span");
          fragment.className = "selection-fragment";
          fragment.textContent = token.text;
          fragment.dataset.itemIndex = String(itemIndex);
          fragment.dataset.columnIndex = String(columnIndex);
          fragment.dataset.sentenceIndex = String(getSentenceIndexAtOffset(text, segment.start + segmentOffset));
          wrap.append(fragment);
          segmentOffset += token.text.length;
          return;
        }
        const currentWordIndex = wordIndex;
        const currentSentenceIndex = getSentenceIndexAtOffset(text, segment.start + segmentOffset);
        wordIndex += 1;
        wrap.append(createReaderSourceUnit(token.text, itemIndex, {
          unitLevel: "word",
          sentenceIndex: currentSentenceIndex,
          wordIndex: currentWordIndex,
          unitIndex: currentWordIndex,
          columnIndex,
          groupId: `reader-${itemIndex}-${columnIndex}-${fromHere ? "from-word" : "word"}-${currentWordIndex}`
        }));
        segmentOffset += token.text.length;
      });
    });
  }

  function renderReaderSentences(wrap, text, itemIndex, columnIndex, fromHere) {
    const ranges = splitSentenceRangesForDisplay(text);
    const sentenceRanges = ranges.length ? ranges : [{ text, start: 0, end: text.length }];
    let cursor = 0;
    sentenceRanges.forEach((range, sentenceIndex) => {
      if (range.start > cursor) wrap.append(document.createTextNode(text.slice(cursor, range.start)));
      appendReaderUnitSegments(wrap, text.slice(range.start, range.end), itemIndex, {
        unitLevel: "sentence",
        sentenceIndex,
        wordIndex: 0,
        unitIndex: sentenceIndex,
        fromHere,
        columnIndex,
        groupId: `reader-${itemIndex}-${columnIndex}-${fromHere ? "from-sentence" : "sentence"}-${sentenceIndex}`
      });
      cursor = range.end;
    });
    if (cursor < text.length) wrap.append(document.createTextNode(text.slice(cursor)));
  }

  function createReaderSourceUnit(text, itemIndex, options) {
    const unit = createInteractiveTextUnit(text, {
      className: `reader-unit reader-${options.unitLevel}`,
      groupId: options.groupId,
      onActivate: () => {
        onSourceActivate(itemIndex, options);
      }
    });
    unit.dataset.itemIndex = String(itemIndex);
    unit.dataset.columnIndex = String(options.columnIndex || 0);
    unit.dataset.sentenceIndex = String(options.sentenceIndex || 0);
    unit.dataset.wordIndex = String(options.wordIndex || 0);
    return unit;
  }

  function appendReaderUnitSegments(parent, text, itemIndex, options) {
    forEachReaderDisplaySegment(text, (segment) => {
      if (segment.link) {
        parent.append(createReaderLink(segment, itemIndex, options));
      } else if (segment.translation) {
        parent.append(createReaderTranslationUnit(segment.raw, segment.text, {
          itemIndex,
          columnIndex: options.columnIndex || 0,
          sentenceIndex: options.sentenceIndex,
          wordIndex: options.wordIndex
        }));
      } else if (segment.note) {
        parent.append(createReaderNote(segment.raw));
      } else {
        parent.append(createReaderSourceUnit(segment.text, itemIndex, options));
      }
    });
  }

  function createReaderTranslationUnit(rawText, translationText, activeCursor) {
    return createInteractiveTextUnit(rawText, {
      className: "reader-translation",
      onActivate: () => onTranslationActivate(translationText, activeCursor)
    });
  }

  function createReaderNote(text) {
    const note = document.createElement("span");
    note.className = "reader-note";
    note.textContent = text;
    return note;
  }

  function createReaderLink(link, itemIndex, options) {
    const anchor = document.createElement(link.href === null ? "span" : "a");
    anchor.className = `reader-unit reader-link reader-${options.unitLevel}`;
    anchor.textContent = link.text;
    if (link.href !== null) {
      anchor.href = link.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    if (itemIndex >= 0) {
      anchor.dataset.itemIndex = String(itemIndex);
      anchor.dataset.columnIndex = String(options.columnIndex || 0);
      anchor.dataset.sentenceIndex = String(options.sentenceIndex || 0);
      anchor.dataset.wordIndex = String(options.wordIndex || 0);
    }
    anchor.addEventListener("click", event => event.stopPropagation());
    return anchor;
  }


  return { renderReaderView };
}
