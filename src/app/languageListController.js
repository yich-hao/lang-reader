import { getLanguageLabel } from "../i18n/languages.js";
import { defaultLanguagePreferences, normalizeLanguagePreferences, finalizeLanguagePreferences, normalizeLanguageSearch, languageSearchMatch } from "../i18n/languagePreferences.js";
import { createModal } from "../ui/modal.js";
import { bindFilesSortGesture } from "../files/filesTree.js";
import { FILES_GRIP_SVG, FILES_TRASH_SVG } from "../files/fileIcons.js";

export function createLanguageListController({ document, window, preferences, getPreference, setPreference, getUiLanguage, t }) {
  const $ = id => document.getElementById(id);
  const entry = $("languageListButton"), dialog = $("languageDialog"), search = $("languageSearch");
  const results = $("languageResults"), selected = $("selectedLanguages");
  const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const MINUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
  let catalog = [], draft, filtered = [], chosenMatches = [], highlighted = -1, keyboardGroup = "available";
  let keyboardNavigated = false, composing = false, dragging = false, nameLens, lensRow, hoveredRow, lastPointer, activePointer;
  const modal = createModal({ overlay: $("languageModal"), content: dialog,
    closeButton: $("closeLanguages"), initialFocus: search, document,
    onOpen: syncScrollGutters,
    onClose: () => {
      const pointer = activePointer; activePointer = null;
      if (pointer?.row.hasPointerCapture(pointer.id)) pointer.row.releasePointerCapture(pointer.id);
      lastPointer = null; setHoveredRow(null); clearCandidateVisuals(); clearDrop();
      dialog.querySelectorAll(".language-drag-card,.language-removal-target").forEach(node => node.remove());
      dragging = false;
      setPreference(finalizeLanguagePreferences(draft)); draft = null; refresh();
    }
  });

  function codesFor(value) { return preferences.codesFor(value, catalog); }
  function description(code) {
    const name = getLanguageLabel(code, getUiLanguage());
    let nativeName;
    try { nativeName = new Intl.DisplayNames([code], { type:"language" }).of(code); } catch { nativeName = name; }
    return { name, nativeName };
  }
  function labelFor(code) {
    const { name, nativeName } = description(code);
    const label = document.createElement("span"), title = document.createElement("span"), detail = document.createElement("small");
    label.className = "language-label"; title.textContent = name; detail.textContent = nativeName + " · " + code;
    label.append(title, detail); return label;
  }
  function syncScrollGutters() {
    for (const list of [results, selected]) list.closest(".language-pane").style.setProperty("--language-scroll-gutter", (list.offsetWidth-list.clientWidth) + "px");
  }
  function refresh() {
    if (dragging) return;
    catalog = preferences.catalog(draft?.codes || []);
    const codes = preferences.codesFor(getPreference(), catalog);
    entry.replaceChildren();
    for (const code of codes.slice(0,4)) {
      const chip = document.createElement("span"); chip.className = "language-code"; chip.textContent = code.toUpperCase(); entry.append(chip);
    }
    if (codes.length > 4 || !codes.length) {
      const extra = document.createElement("span"); extra.className = "language-more"; extra.textContent = codes.length ? "…" : "—"; entry.append(extra);
    }
    entry.setAttribute("aria-label", t("languageList"));
    entry.title = t("languageList") + (codes.length ? ": " + codes.map(code => getLanguageLabel(code,getUiLanguage())).join(", ") : "");
    if (modal.isOpen()) render();
  }
  function keyboardEntries() { return keyboardGroup === "selected" ? chosenMatches : filtered; }
  function filterAvailable() {
    const codes = new Set(codesFor(draft)), query = normalizeLanguageSearch(search.value);
    filtered = catalog.filter(language => !codes.has(language.code))
      .map(language => ({ code:language.code, ...languageSearchMatch(language.code,query) }))
      .filter(entry => entry.match).sort((a,b) => a.score-b.score).map(entry => entry.code);
    chosenMatches = codesFor(draft).filter(code => languageSearchMatch(code,query).match);
    highlighted = Math.max(-1,Math.min(highlighted,keyboardEntries().length-1));
  }
  function change(code, destination = null) {
    const codes = codesFor(draft), existing = codes.indexOf(code);
    if (existing >= 0) codes.splice(existing,1);
    if (destination !== null) codes.splice(Math.max(0,Math.min(destination,codes.length)),0,code);
    draft = { mode:"custom", codes }; render(); refreshHover();
    $("languageStatus").textContent = t(destination === null ? "languageRemoved" : "languageAdded",description(code).name);
  }
  function add(code) { if (!codesFor(draft).includes(code)) change(code,codesFor(draft).length); }
  function clearDrop() {
    dialog.querySelectorAll(".drop-before,.drop-after,.is-drop-zone").forEach(node => node.classList.remove("drop-before","drop-after","is-drop-zone"));
  }
  function hideNameLens() { nameLens?.remove(); nameLens = lensRow = null; }
  function clearCandidateVisuals() {
    highlighted = -1; keyboardGroup = "available"; keyboardNavigated = false;
    search.removeAttribute("aria-activedescendant");
    dialog.querySelectorAll(".is-highlighted,.is-keyboard-candidate,.is-keyboard-focused").forEach(row => row.classList.remove("is-highlighted","is-keyboard-candidate","is-keyboard-focused"));
  }
  function handleActionHover(event) {
    if (event.pointerType !== "mouse") return;
    const action = event.target.closest(".add-language,.remove-language");
    if (!action || action.contains(event.relatedTarget)) return;
    clearCandidateVisuals(); dialog.classList.add("is-pointer-actions");
  }
  function revealName(row) {
      if (dragging || !row?.isConnected) return;
      if (lensRow === row) return;
      hideNameLens();
      const label = row.querySelector(".language-label");
      if (![...label.children].some(node => node.scrollWidth > node.clientWidth)) return;
      const isSelected = row.dataset.selected === "true";
      const frame = dialog.getBoundingClientRect(), rect = row.getBoundingClientRect();
      const width = Math.min(dialog.clientWidth-24,Math.max(rect.width,...[...label.children].map(node => node.scrollWidth+64)));
      const lens = document.createElement("div"), copy = row.cloneNode(true);
      lens.className = "language-name-lens app-files-tree folder-gray-icon"; lens.setAttribute("aria-hidden","true");
      copy.removeAttribute("id"); copy.removeAttribute("role"); copy.classList.remove("is-held","is-highlighted"); copy.tabIndex = -1;
      copy.classList.toggle("is-keyboard-candidate",row.classList.contains("is-highlighted") || row.classList.contains("is-keyboard-focused"));
      copy.querySelector("button").tabIndex = -1;
      copy.querySelector("button").addEventListener("click",() => row.querySelector("button").click());
      lens.append(copy); dialog.append(lens); nameLens = lens; lensRow = row;
      const edge = (isSelected ? rect.right-width : rect.left)-frame.left-dialog.clientLeft;
      lens.style.width = width + "px"; lens.style.left = Math.max(12,Math.min(edge,dialog.clientWidth-width-12)) + "px";
      lens.style.top = Math.max(12,Math.min(rect.top-frame.top-dialog.clientTop,dialog.clientHeight-lens.offsetHeight-12)) + "px";
  }
  function setHoveredRow(row) {
    if (hoveredRow !== row) { hoveredRow?.classList.remove("is-hovered"); hoveredRow = row; row?.classList.add("is-hovered"); hideNameLens(); }
    if (row) revealName(row); else hideNameLens();
  }
  function refreshHover() {
    if (!modal.isOpen() || dragging || !lastPointer) return;
    hideNameLens();
    const hit = document.elementFromPoint(lastPointer.x,lastPointer.y);
    const row = hit?.closest(".language-row"); setHoveredRow(row && dialog.contains(row) ? row : null);
  }
  function wireNameLens(row) {
    row.addEventListener("focusin",event => {
      if (event.target.matches(":focus-visible")) { clearCandidateVisuals(); row.classList.add("is-keyboard-focused"); }
      revealName(row);
    });
    row.addEventListener("focusout",() => { row.classList.remove("is-keyboard-focused"); hideNameLens(); });
  }

  function wireDrag(row, code, isSelected) {
    let destination = null, origin, card, removal;
    row.addEventListener("pointerdown",event => {
      if (event.button !== 0 || !event.isPrimary || event.target.closest("button")) return;
      origin = { rect:row.getBoundingClientRect(), x:event.clientX, y:event.clientY };
      activePointer = { row, id:event.pointerId };
    });
    function carry(event) {
      if (!card) {
        hideNameLens();
        const frame = dialog.getBoundingClientRect(), copy = row.cloneNode(true);
        card = document.createElement("div"); card.className = "language-drag-card app-files-tree folder-gray-icon";
        card.setAttribute("aria-hidden","true");
        copy.removeAttribute("id"); copy.removeAttribute("role"); copy.removeAttribute("aria-label");
        copy.classList.remove("is-held","is-highlighted"); copy.tabIndex = -1;
        copy.querySelectorAll("button").forEach(button => { button.disabled = true; button.tabIndex = -1; });
        card.append(copy); dialog.append(card); row.classList.add("language-drag-source");
        card.style.left = origin.rect.left-frame.left-dialog.clientLeft + "px";
        card.style.top = origin.rect.top-frame.top-dialog.clientTop + "px";
        card.style.width = origin.rect.width + "px";
      }
      const pull = event.clientX-origin.x;
      card.style.transform = `translate(${pull}px,${event.clientY-origin.y}px)`;
      return { x:origin.rect.left+origin.rect.width/2+pull, y:origin.rect.top+origin.rect.height/2+event.clientY-origin.y };
    }
    function showDestination(pane) {
      if (destination?.kind !== "remove") { removal?.remove(); removal = null; return; }
      pane.classList.add("is-drop-zone");
      if (!removal) {
        removal = document.createElement("div"); removal.className = "language-removal-target";
        removal.setAttribute("aria-hidden","true"); removal.innerHTML = FILES_TRASH_SVG; pane.append(removal);
      }
    }
    bindFilesSortGesture(row, {
      gripSelector:".language-grip", suppressHeld:true,
      ignore:event => Boolean(event.target.closest("button")),
      onMove:event => {
        if (!modal.isOpen()) return;
        dragging = true; const center = carry(event); clearDrop(); destination = null;
        const selectedZone = selected;
        const availableZone = dialog.querySelector(".available-pane");
        const contains = zone => { const rect = zone.getBoundingClientRect(); return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom; };
        const availableRect = availableZone.getBoundingClientRect();
        const boundary = dialog.querySelector(".selected-pane").getBoundingClientRect().left;
        if (isSelected && contains(dialog) && center.x >= availableRect.left && center.x <= boundary && center.y >= availableRect.top && center.y <= availableRect.bottom) {
          destination = { kind:"remove" };
        }
        const scroll = dialog.querySelector(event.clientX < selected.getBoundingClientRect().left ? "#languageResults" : "#selectedLanguages");
        const scrollRect = scroll.getBoundingClientRect();
        if (contains(scroll)) {
          if (event.clientY < scrollRect.top+35) scroll.scrollTop -= 18;
          if (event.clientY > scrollRect.bottom-35) scroll.scrollTop += 18;
          if (destination?.kind !== "remove" && contains(selectedZone)) {
            selectedZone.classList.add("is-drop-zone");
            const rows = [...selectedZone.querySelectorAll('.language-row[data-selected="true"]')].filter(entry => entry.dataset.code !== code);
            const next = rows.find(entry => event.clientY < entry.getBoundingClientRect().top+entry.getBoundingClientRect().height/2);
            const anchor = next || rows.at(-1);
            anchor?.classList.add(next ? "drop-before" : "drop-after");
            const ordered = codesFor(draft).filter(entry => entry !== code);
            destination = { kind:"select", index:next ? ordered.indexOf(next.dataset.code) : ordered.length };
          }
        }
        showDestination(availableZone);
      },
      onFinish:(event,state) => {
        activePointer = null;
        dragging = false; clearDrop(); card?.remove(); removal?.remove(); card = removal = null; row.classList.remove("language-drag-source");
        if (modal.isOpen() && state.dragging && !state.cancelled && destination) {
          if (destination.kind === "remove") { search.value = ""; highlighted = -1; change(code); }
          else change(code,destination.index);
        }
        destination = null; origin = null;
      }
    });
    if (isSelected) row.addEventListener("keydown", event => {
      if (event.target !== row || !["ArrowUp","ArrowDown"].includes(event.key)) return;
      event.preventDefault(); const codes = codesFor(draft), index = codes.indexOf(code);
      const destination = index+(event.key === "ArrowUp" ? -1 : 1);
      if (destination < 0 || destination >= codes.length) return;
      change(code,destination);
      [...dialog.querySelectorAll('.language-row[data-selected="true"]')].find(entry => entry.dataset.code === code)?.focus();
    });
  }

  function languageRow(code,isSelected,index) {
    const row = document.createElement("div"); row.className = "language-row source-heading";
    row.dataset.code = code; row.dataset.selected = String(isSelected); row.tabIndex = isSelected ? 0 : -1;
    row.setAttribute("role",isSelected ? "listitem" : "option"); row.setAttribute("aria-label",description(code).name + ", " + code);
    row.id = (isSelected ? "language-selected-" : "language-option-") + index;
    row.classList.toggle("is-highlighted",index === highlighted && (isSelected === (keyboardGroup === "selected")));
    const grip = document.createElement("span"); grip.className = "language-grip"; grip.innerHTML = FILES_GRIP_SVG; grip.setAttribute("aria-hidden","true");
    const action = document.createElement("button"); action.type = "button"; action.className = "tree-action " + (isSelected ? "remove-language" : "add-language");
    action.setAttribute("aria-label",t(isSelected ? "removeLanguage" : "addLanguage",description(code).name) + ", " + code);
    action.innerHTML = isSelected ? MINUS_SVG : PLUS_SVG;
    action.addEventListener("click",event => { event.stopPropagation(); if (isSelected) change(code); else add(code); });
    row.append(grip,labelFor(code),action); wireDrag(row,code,isSelected); wireNameLens(row); return row;
  }
  function render() {
    const active = document.activeElement;
    const focusedRow = dialog.contains(active) ? active?.closest(".language-row") : null;
    hideNameLens(); const scrolls = [results.scrollTop,selected.scrollTop]; filterAvailable();
    const block = document.createElement("div"); block.className = "selected-block";
    chosenMatches.forEach((code,index) => block.append(languageRow(code,true,index)));
    selected.replaceChildren(block); results.replaceChildren(...filtered.map((code,index) => languageRow(code,false,index)));
    [results,selected].forEach((list,index) => list.scrollTop = scrolls[index]);
    if (highlighted >= 0 && keyboardEntries().length) search.setAttribute("aria-activedescendant",(keyboardGroup === "selected" ? "language-selected-" : "language-option-") + highlighted);
    else search.removeAttribute("aria-activedescendant");
    if (focusedRow) {
      const replacement = [...dialog.querySelectorAll(".language-row")].find(row => row.dataset.code === focusedRow.dataset.code);
      const focus = replacement && (active.matches("button") ? replacement.querySelector("button") : replacement);
      (focus || search).focus({ preventScroll:true });
    }
  }
  function open() {
    draft = normalizeLanguagePreferences(getPreference());
    composing = false;
    search.value = ""; clearCandidateVisuals(); lastPointer = null; setHoveredRow(null);
    dialog.classList.remove("is-pointer-actions"); refresh(); render();
    [results,selected].forEach(list => list.scrollTop = 0);
    modal.setOpen(true);
  }
  function searchChanged() {
    highlighted = normalizeLanguageSearch(search.value) ? 0 : -1; keyboardGroup = "available"; keyboardNavigated = false; render();
    if (!filtered.length && chosenMatches.length) { keyboardGroup = "selected"; highlighted = 0; render(); }
    results.scrollTop = selected.scrollTop = 0; refreshHover();
  }
  function handleSearchKey(event) {
    if (composing || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
    if (["ArrowLeft","ArrowRight"].includes(event.key)) {
      event.preventDefault(); keyboardNavigated = true; keyboardGroup = event.key === "ArrowLeft" ? "available" : "selected"; highlighted = 0; render();
    } else if (["ArrowUp","ArrowDown"].includes(event.key)) {
      event.preventDefault(); keyboardNavigated = true; const entries = keyboardEntries();
      highlighted = entries.length ? Math.max(0,Math.min(entries.length-1,highlighted < 0 ? 0 : highlighted+(event.key === "ArrowDown" ? 1 : -1))) : -1; render();
    } else if (event.key === "Enter" || (event.key === " " && keyboardNavigated && highlighted >= 0)) {
      event.preventDefault(); if (event.repeat) return;
      const code = keyboardEntries()[Math.max(0,highlighted)];
      if (code) {
        if (keyboardGroup === "selected") change(code); else add(code);
        search.value = ""; searchChanged(); search.focus({preventScroll:true});
      }
      return;
    } else return;
    if (highlighted >= 0) {
      const row = $("language-" + (keyboardGroup === "selected" ? "selected-" : "option-") + highlighted);
      row?.scrollIntoView({block:"nearest"}); if (row) revealName(row);
    }
  }
  function bindEvents() {
    entry.addEventListener("click",open);
    $("addAll").innerHTML = PLUS_SVG; $("removeAll").innerHTML = MINUS_SVG;
    $("addAll").addEventListener("click",() => { draft = {mode:"all",codes:[]}; clearCandidateVisuals(); render(); });
    $("removeAll").addEventListener("click",() => { draft = {mode:"custom",codes:[]}; clearCandidateVisuals(); render(); });
    $("restoreDefault").addEventListener("click",() => { draft = defaultLanguagePreferences(); clearCandidateVisuals(); render(); });
    modal.bindEvents();
    dialog.addEventListener("pointerdown",event => { if (event.button === 0 && event.isPrimary) clearCandidateVisuals(); },{capture:true});
    dialog.addEventListener("pointerover",handleActionHover);
    dialog.addEventListener("keydown",event => { dialog.classList.remove("is-pointer-actions"); event.stopPropagation(); });
    search.addEventListener("pointerdown",() => { clearCandidateVisuals(); render(); });
    search.addEventListener("compositionstart",() => composing = true);
    search.addEventListener("compositionend",() => { composing = false; searchChanged(); });
    search.addEventListener("input",searchChanged); search.addEventListener("keydown",handleSearchKey);
    for (const list of [results,selected]) {
      let timer;
      list.addEventListener("scroll",() => {
        list.classList.add("is-scrolling"); window.clearTimeout(timer);
        timer = window.setTimeout(() => list.classList.remove("is-scrolling"),650); refreshHover();
      },{passive:true});
    }
    new window.ResizeObserver(syncScrollGutters).observe(dialog);
    dialog.addEventListener("pointermove",event => {
      if (event.pointerType !== "mouse" || dragging) return;
      lastPointer = {x:event.clientX,y:event.clientY};
      setHoveredRow(event.target.closest(".language-name-lens") ? lensRow : event.target.closest(".language-row"));
    });
    dialog.addEventListener("pointerleave",() => { lastPointer = null; setHoveredRow(null); });
    window.addEventListener("resize",hideNameLens);
  }
  return { bindEvents, refresh, open };
}
