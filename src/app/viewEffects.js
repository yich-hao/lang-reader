import {
  getBaseColumnWidth as getLayoutBaseColumnWidth,
  getMinColumnWidth as getLayoutMinColumnWidth,
  getRenderedColumnWidths as getLayoutRenderedColumnWidths,
  getTableWidth as getLayoutTableWidth,
  isLastResizableColumn as isLayoutLastResizableColumn,
  redistributeColumnWidths as redistributeLayoutColumnWidths
} from "../ui/tableLayout.js";

export function createViewEffects({ state, document, elements, getColumnCount, getSelectionUnitMode, getSelectionCursor, ResizeObserver = globalThis.ResizeObserver }) {
  let tableResizeObserver = null;

  function observeTableLayout() {
    if (tableResizeObserver || !ResizeObserver) return;
    let previousWidth = null;
    tableResizeObserver = new ResizeObserver(() => {
      const width = elements.parsedTableWrap.clientWidth;
      if (width === previousWidth) return;
      previousWidth = width;
      if (width > 0 && state.parsedViewMode === "table") applyColumnLayout(getColumnCount());
    });
    tableResizeObserver.observe(elements.parsedTableWrap);
  }

  function getColumnWidth(index, columnCount = getColumnCount()) {
    return `${getRenderedColumnWidths(columnCount)[index] || getBaseColumnWidth(index)}px`;
  }

  function getTableWidth(columnLayoutOrCount) {
    const widths = Array.isArray(columnLayoutOrCount) ? columnLayoutOrCount : getRenderedColumnWidths(columnLayoutOrCount);
    return getLayoutTableWidth(widths);
  }

  function getRenderedColumnWidths(columnCount) {
    return getLayoutRenderedColumnWidths({
      columnCount,
      columnRoles: state.columnRoles,
      columnWidths: state.columnWidths,
      availableWidth: getTableAvailableWidth()
    });
  }

  function redistributeColumnWidths(startWidths, index, nextWidth) {
    return redistributeLayoutColumnWidths({ startWidths, index, nextWidth, columnRoles: state.columnRoles });
  }

  function isLastResizableColumn(index, columnCount) {
    return isLayoutLastResizableColumn(index, columnCount, state.columnRoles);
  }

  function getMinColumnWidth(index) {
    return getLayoutMinColumnWidth(index, state.columnRoles);
  }

  function getBaseColumnWidth(index) {
    return getLayoutBaseColumnWidth(index, state.columnRoles, state.columnWidths);
  }

  function applyColumnLayout(columnCount, explicitWidths = null) {
    const table = document.querySelector(".parsed-table");
    if (!table) return;
    const widths = explicitWidths || getRenderedColumnWidths(columnCount);
    table.style.width = getTableWidth(widths);
    widths.forEach((width, index) => {
      const col = table.querySelector(`colgroup col:nth-child(${index + 2})`);
      if (col) col.style.width = `${width}px`;
      table.querySelectorAll(`tr > :nth-child(${index + 2})`).forEach((cell) => {
        cell.style.width = `${width}px`;
      });
    });
  }

  function getCurrentRenderedColumnWidths(columnCount) {
    const table = document.querySelector(".parsed-table");
    if (!table) return getRenderedColumnWidths(columnCount);
    return Array.from({ length: columnCount }, (_, index) => {
      const col = table.querySelector(`colgroup col:nth-child(${index + 2})`);
      return Number.parseFloat(col?.style.width) || getBaseColumnWidth(index);
    });
  }

  function getTableAvailableWidth() {
    return Math.max(0, (elements.parsedTableWrap.clientWidth || 0) - 4)
      || Math.max(0, (document.querySelector(".main-panel")?.clientWidth || 0) - 32)
      || 824;
  }

  function updateActiveTableState() {
    const mode = getSelectionUnitMode();
    const cursor = getSelectionCursor(mode);
    document.querySelectorAll(".source-selection-group").forEach((group) => {
      const isActive = group.dataset.selectionLevel === mode
        && Number(group.dataset.itemIndex) === state.activeItemIndex
        && Number(group.dataset.columnIndex || 0) === state.activeColumnIndex
        && (mode === "cell" || Number(group.dataset.sentenceIndex) === cursor.sentenceIndex);
      group.classList.toggle("active-selection-group", isActive);
    });
    document.querySelectorAll(".reader-unit, .table-text-unit[data-item-index], .selection-fragment").forEach((unit) => {
      const isActive = Number(unit.dataset.itemIndex) === state.activeItemIndex
        && Number(unit.dataset.columnIndex || 0) === state.activeColumnIndex
        && (mode === "cell" || Number(unit.dataset.sentenceIndex || 0) === cursor.sentenceIndex)
        && (mode !== "word" || !unit.classList.contains("selection-fragment") && Number(unit.dataset.wordIndex || 0) === cursor.wordIndex);
      unit.classList.toggle("active-reader-unit", isActive);
    });
    if (state.parsedViewMode === "reader") {
      const activeUnitNode = document.querySelector(".reader-unit.active-reader-unit");
      document.querySelectorAll(".reader-markdown-table td").forEach((cell) => {
        const isActive = Number(cell.dataset.itemIndex) === state.activeItemIndex
          && Number(cell.dataset.columnIndex || 0) === state.activeColumnIndex;
        cell.classList.toggle("active-reader-cell", isActive);
      });

      const indicator = document.getElementById("readerActiveIndicator");
      const displayUnitNode = activeUnitNode
        || document.querySelector(`.reader-unit[data-item-index="${state.activeItemIndex}"][data-column-index="${state.activeColumnIndex}"]`)
        || document.querySelector(`.reader-unit[data-item-index="${state.activeItemIndex}"]`);
      if (displayUnitNode && indicator) {
        let block = displayUnitNode.parentElement;
        while (block && block.parentElement && !block.parentElement.classList.contains("reader-view")) {
          block = block.parentElement;
        }
        if (block) {
          indicator.style.opacity = "1";
          indicator.style.top = `${block.offsetTop}px`;
          indicator.style.height = `${block.offsetHeight}px`;
        }
      }
      return;
    }
    document.querySelectorAll(".parsed-table tr").forEach((row) => {
      row.classList.toggle("active-row", Number(row.dataset.index) === state.activeItemIndex);
    });
    document.querySelectorAll(".parsed-table tr > *").forEach((cell) => {
      cell.classList.toggle("active-cell", Number(cell.parentElement?.dataset.index) === state.activeItemIndex && cell.cellIndex === state.activeColumnIndex + 1);
    });
  }

  function scrollActiveRowIntoView() {
    const wrap = elements.parsedTableWrap;
    if (state.parsedViewMode === "reader") {
      const cursor = state.playbackSession?.anchor || state.activeUnitCursor;
      const scope = cursor && `.reader-unit[data-item-index="${cursor.rowIndex}"][data-column-index="${cursor.columnIndex}"][data-sentence-index="${cursor.sentenceIndex}"]`;
      const unit = (scope && document.querySelector(`${scope}[data-word-index="${cursor.wordIndex}"]`))
        || (scope && document.querySelector(scope)) || document.querySelector(".reader-unit.active-reader-unit") || document.querySelector(
        `.reader-unit[data-item-index="${state.activeItemIndex}"][data-column-index="${state.activeColumnIndex}"]`
      ) || document.querySelector(`.reader-unit[data-item-index="${state.activeItemIndex}"]`);
      if (!wrap || !unit) return;
      const wrapRect = wrap.getBoundingClientRect();
      const unitRect = unit.getClientRects?.()[0] || unit.getBoundingClientRect();
      const top = unitRect.top - wrapRect.top + wrap.scrollTop;
      const bottom = unitRect.bottom - wrapRect.top + wrap.scrollTop;
      const viewportTop = wrap.scrollTop;
      const viewportBottom = viewportTop + wrap.clientHeight;
      const buffer = 96;
      if (bottom + buffer > viewportBottom) {
        wrap.scrollTop = Math.max(0, bottom + buffer - wrap.clientHeight);
      } else if (top < viewportTop + buffer) {
        wrap.scrollTop = Math.max(0, top - buffer);
      }
      return;
    }
    const row = document.querySelector(`.parsed-table tr[data-index="${state.activeItemIndex}"]`);
    if (!wrap || !row) return;
    const rowHeight = row.offsetHeight || 44;
    const top = row.offsetTop;
    const bottom = top + rowHeight;
    const viewportTop = wrap.scrollTop;
    const viewportBottom = viewportTop + wrap.clientHeight;
    const bottomBuffer = rowHeight * 2;
    if (bottom + bottomBuffer > viewportBottom) {
      wrap.scrollTop = Math.max(0, bottom + bottomBuffer - wrap.clientHeight);
    } else if (top < viewportTop + rowHeight) {
      wrap.scrollTop = Math.max(0, top - rowHeight);
    }
  }

  return { observeTableLayout, getColumnWidth, getTableWidth, getRenderedColumnWidths, redistributeColumnWidths, isLastResizableColumn, getMinColumnWidth, getBaseColumnWidth, applyColumnLayout, getCurrentRenderedColumnWidths, getTableAvailableWidth, updateActiveTableState, scrollActiveRowIntoView };
}
