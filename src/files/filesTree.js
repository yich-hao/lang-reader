import { loadFileGroupOrder, saveFileGroupOrder } from "../core/storage.js";
import { modifiedFileIcon, FILE_ICON_SVG, FOLDER_ICON_SVG, FILLED_FOLDER_ICON_SVG, FILES_GRIP_SVG, FILES_TRASH_SVG, openFolderIconSvg } from "./fileIcons.js";
export function suppressTreeClick({ elapsed, dragging, cancelled, outside }) {
  return dragging || elapsed >= 1000 || cancelled || outside;
}

export function bindFilesSortGesture(row, { onMove, onFinish, ignore = () => false, gripSelector = "", suppressHeld = false }) {
  let suppress = false;
  row.addEventListener("click", event => {
    if (suppress) { suppress = false; event.stopImmediatePropagation(); event.preventDefault(); }
  });
  row.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary || ignore(event)) return;
    suppress = false;
    const bounds = row.getBoundingClientRect(), started = performance.now();
    const threshold = gripSelector && event.target.closest(gripSelector) ? 3 : bounds.height * 2 / 3;
    const timer = setTimeout(() => row.classList.add("is-held"), 200);
    row.setPointerCapture(event.pointerId);
    let dragging = false;
    const move = e => {
      if (e.pointerId !== event.pointerId) return;
      if (!dragging && Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY) <= threshold) return;
      dragging = true; suppress = true; clearTimeout(timer); row.classList.add("is-held");
      onMove(e);
    };
    const end = e => {
      if (e.pointerId !== event.pointerId) return;
      clearTimeout(timer);
      const result = { elapsed: performance.now()-started, dragging, cancelled: e.type !== "pointerup",
        outside: e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom };
      suppress = suppressTreeClick(result) || (suppressHeld && result.elapsed >= 200);
      row.classList.remove("is-held");
      ["pointerup","pointercancel","lostpointercapture"].forEach(type => row.removeEventListener(type,end));
      row.removeEventListener("pointermove",move);
      if (row.hasPointerCapture(event.pointerId)) row.releasePointerCapture(event.pointerId);
      onFinish(e, result);
    };
    row.addEventListener("pointermove",move);
    ["pointerup","pointercancel","lostpointercapture"].forEach(type => row.addEventListener(type,end));
  });
}

export function createFilesTree({ list, emptyState, count, toolbar, onOpen, onDelete, onAdd, onClear, appearance = {}, persistOrder = true }) {
  let cleanup = () => {};
  let root;
  let selectionRequestId = 0;
  let order = persistOrder ? loadFileGroupOrder() : [];
  const folded = new Map();
  let scrollTimer;
  let currentLabels = {};
  list.addEventListener("scroll", () => {
    list.classList.add("is-scrolling");
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => list.classList.remove("is-scrolling"), 650);
    root?.dispatchEvent(new Event("treechange"));
  }, { passive: true });
  function buildNodes(entries, groupId) {
    const nodes = [];
    entries.forEach(entry => {
      const parts = (entry.treePath || entry.name).split("/").filter(Boolean);
      let level = nodes;
      let path = groupId;
      for (const part of parts.slice(0, -1)) {
        path += "/" + part;
        let node = level.find(item => item.kind === "folder" && item.name === part);
        if (!node) { node = {kind:"folder", name:part, id:path, children:[]}; level.push(node); }
        level = node.children;
      }
      level.push({kind:"file", name:parts.at(-1) || entry.name, entry});
    });
    return nodes;
  }
  function remember() {
    root?.querySelectorAll("[data-tree-key][aria-expanded]").forEach(node => folded.set(node.dataset.treeKey, node.getAttribute("aria-expanded") === "true"));
    order = [...root.querySelectorAll(":scope > .source-section")].map(node => node.dataset.group);
  }
  function wireSort(heading, section) {
    heading.addEventListener("keydown", event => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const neighbor = event.key === "ArrowUp" ? section.previousElementSibling : section.nextElementSibling;
      if (!neighbor?.classList.contains("source-section")) return;
      root.insertBefore(section, event.key === "ArrowUp" ? neighbor : neighbor.nextSibling);
      heading.focus({preventScroll:true});
      remember();
      if (persistOrder) saveFileGroupOrder(order);
      root.dispatchEvent(new Event("treechange"));
    });
    let target = null, after = false;
    const clear = () => root.querySelectorAll(".drop-before,.drop-after").forEach(node => node.classList.remove("drop-before","drop-after"));
    bindFilesSortGesture(heading, {
      onMove: e => {
        root.dispatchEvent(new Event("treechange"));
        const rect = list.getBoundingClientRect();
        if (e.clientY < rect.top+35) list.scrollTop -= 18;
        if (e.clientY > rect.bottom-35) list.scrollTop += 18;
        clear();
        const others = [...root.querySelectorAll(":scope > .source-section")].filter(node => node !== section);
        target = others.find(node => e.clientY < node.getBoundingClientRect().top+node.getBoundingClientRect().height/2) || others.at(-1);
        after = target && e.clientY >= target.getBoundingClientRect().top+target.getBoundingClientRect().height/2;
        target?.classList.add(after ? "drop-after" : "drop-before");
      },
      onFinish: (e, { dragging }) => {
        if (dragging && target && e.type === "pointerup") root.insertBefore(section, after ? target.nextSibling : target);
        clear(); target = null; after = false;
        remember();
        if (persistOrder && dragging && e.type === "pointerup") saveFileGroupOrder(order);
        root.dispatchEvent(new Event("treechange"));
      }
    });
  }
  function render({groups, selectedKey="", labels={}}) {
    currentLabels = labels;
    if (root) remember();
    cleanup();
    chainLabels.length = 0;
    const scrollTop = list.scrollTop;
    root = document.createElement("div");
    root.className = "app-files-tree variant-c folder-gray-icon panel";
    if (appearance.className) root.classList.add(...appearance.className().split(" ").filter(Boolean));
    for (const [name, value] of Object.entries(appearance.style?.() || {})) root.style.setProperty(name, value);
    list.classList.add("app-files-tree-scroll");
    list.replaceChildren(root);
    const ordered = [...groups].sort((a,b) => {
      const ai=order.indexOf(a.kind),bi=order.indexOf(b.kind);
      return (ai<0?999:ai)-(bi<0?999:bi);
    });
    ordered.forEach(group => {
      const section = document.createElement("section");
      section.className = "source-section";
      section.dataset.group = group.kind;
      const wrap = document.createElement("div");
      wrap.className = "source-heading-wrap";
      const heading = document.createElement("button");
      heading.type = "button"; heading.className = "source-heading";
      heading.dataset.treeKey = group.kind;
      heading.dataset.tooltip = labels.groupInteraction || "";
      heading.innerHTML = FILES_GRIP_SVG + '<span class="source-title"></span><span class="source-count collapse-count"></span>';
      heading.querySelector(".source-title").textContent=group.label;
      heading.querySelector(".source-count").textContent=group.entries.length;
      const body=document.createElement("div"); body.className="source-body";
      renderNodes(buildNodes(group.entries,group.kind),body,"variant-c");
      let clear;
      heading.setTreeExpanded = expanded => {
        const open = group.entries.length > 0 && expanded;
        heading.setAttribute("aria-expanded",String(open)); body.hidden=!open;
        if (clear) clear.hidden=!open;
      };
      heading.setTreeExpanded(folded.get(group.kind) ?? true);
      wireSort(heading,section);
      heading.addEventListener("click",() => {
        if (!group.entries.length) return;
        const expanded=heading.getAttribute("aria-expanded")!=="true";
        heading.setTreeExpanded(expanded);
        toggleChildrenAtFixedPosition(heading,body,expanded);
        root.dispatchEvent(new Event("treechange")); requestAnimationFrame(fitChainLabels);
      });
      wrap.append(heading);
      if (["drafts", "uploaded-files", "uploaded-folders"].includes(group.kind)) {
        clear=document.createElement("button"); clear.type="button"; clear.className="tree-action group-clear";
        const clearLabel=labels.clearGroup(group.kind);
        clear.title=clearLabel; clear.setAttribute("aria-label",clearLabel);
        clear.innerHTML=svg.trash;
        clear.hidden=heading.getAttribute("aria-expanded")!=="true";
        clear.addEventListener("click",()=>onClear?.(group.kind));
        wrap.append(clear);
        const add=document.createElement("button"); add.type="button"; add.className="tree-action draft-add";
        const label=group.kind==="drafts"?labels.newDraft:group.kind==="uploaded-files"?labels.uploadFiles:labels.uploadFolders;
        add.title=label; add.setAttribute("aria-label",label);
        add.innerHTML=appearance.addIcon?.(group.kind) || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
        add.addEventListener("click",()=>{ heading.setTreeExpanded(true); remember(); folded.set(group.kind,true); onAdd?.(group.kind); });
        wrap.append(add);
      }
      section.append(wrap,body); root.append(section);
    });
    const tail=document.createElement("div");tail.className="scroll-tail";root.append(tail);
    root.querySelectorAll('.tree-row[aria-expanded]').forEach(node=>node.setTreeExpanded(folded.get(node.dataset.treeKey) ?? true));
    const selected=[...root.querySelectorAll("[data-file-key]")].find(node=>node.dataset.fileKey===selectedKey);
    if(selected) {
      selected.setAttribute("aria-current","true");
      for(let parent=selected.parentElement;parent&&parent!==root;parent=parent.parentElement) {
        if(parent.classList.contains("tree-children")) parent.previousElementSibling.classList.add("contains-selected");
        if(parent.classList.contains("source-body")) parent.closest(".source-section").querySelector(".source-heading").classList.add("contains-selected");
      }
    }
    const total=groups.reduce((n,g)=>n+g.entries.length,0);
    count.textContent=labels.fileCount?.(total)||String(total);
    emptyState.hidden=total>0;
    list.parentElement.classList.add("has-files-tree");
    let toggle=toolbar.querySelector(".bulk-toggle");
    if (!toggle) { toggle=document.createElement("button");toggle.type="button";toggle.className="tree-action bulk-toggle cross-slide";toolbar.append(toggle); }
    toggle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 5.5 10.4 8.2Q12 9.1 13.6 8.2L18.5 5.5"/><path d="M5.5 18.5 10.4 15.8Q12 14.9 13.6 15.8L18.5 18.5"/></svg>';
    if (appearance.bulkIcon) {
      toggle.className = `tree-action bulk-toggle ${appearance.bulkClass?.() || "cross-slide"}`;
      toggle.innerHTML = appearance.bulkIcon();
    }
    const controls=()=>[...root.querySelectorAll("[aria-expanded]")];
    const update=()=>{const any=controls().some(n=>n.getAttribute("aria-expanded")==="true");toggle.classList.toggle("is-expand",!any);toggle.title=any?labels.collapseAll:labels.expandAll;toggle.setAttribute("aria-label",toggle.title);};
    toggle.onclick=()=>{const expand=!controls().some(n=>n.getAttribute("aria-expanded")==="true");controls().forEach(n=>n.setTreeExpanded(expand));tail.style.height="0px";list.scrollTop=0;root.dispatchEvent(new Event("treechange"));appearance.animateBulk?.(toggle,expand);requestAnimationFrame(fitChainLabels);};
    root.addEventListener("treechange",update); update();
    const disposeLens=attachLens(root);
    const observer=new ResizeObserver(()=>{fitChainLabels();root.dispatchEvent(new Event("treechange"));});
    observer.observe(list);
    cleanup=()=>{disposeLens();observer.disconnect();};
    list.scrollTop=scrollTop;
    requestAnimationFrame(fitChainLabels);
  }
  const svg = {
    trash: FILES_TRASH_SVG,
    file: FILE_ICON_SVG,
    folder: FOLDER_ICON_SVG
  };

  function openFolderIcon(variant) {
    const colors = {
      "variant-c": ["#d7e9dd", "#f3faf4"],
      "variant-d": ["#dbece0", "#f3faf4"],
      "variant-e": ["#dbece0", "#f3faf4"]
    };
    const [back, front] = colors[variant];
    return openFolderIconSvg(back, front);
  }
  function fileIcon(variant, name) {
    if (appearance.fileIcon) return appearance.fileIcon(name);
    if (variant !== "variant-e") return svg.file;
    const extension = name.match(/\.(md|txt|csv|tsv)$/i)?.[1].toLowerCase();
    const type = { md: "MD", txt: "TX", csv: "CS", tsv: "TS" }[extension];
    if (!type) return svg.file;
    return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 18H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6l4 4v4.2"/><path d="M11 2v4h4"/><text x="14.1" y="18.15" text-anchor="middle" font-family="sans-serif" font-size="7" font-weight="700" letter-spacing="-.4" fill="#555b57" stroke="none">${type}</text></svg>`;
  }
  function folderIcon(variant, expanded) {
    if (appearance.folderIcon) return appearance.folderIcon(expanded);
    if (variant === "variant-c") {
      return expanded
        ? openFolderIcon(variant)
        : FILLED_FOLDER_ICON_SVG;
    }
    if (variant === "variant-d" || variant === "variant-e") {
      return expanded ? openFolderIcon(variant) : svg.folder;
    }
    return svg.folder;
  }
  function compact(node) {
    const parts = [node.name];
    let tail = node;
    while (tail.children.length === 1 && tail.children[0].kind === "folder") {
      tail = tail.children[0];
      parts.push(tail.name);
    }
    return { tail, parts };
  }
  function countFiles(nodes) { return nodes.reduce((total, node) => total + (node.kind === "folder" ? countFiles(node.children) : 1), 0); }
  const chainLabels = [];
  function fitChainLabels() {
    chainLabels.forEach(({ label, parts }) => {
      if (!label.getClientRects().length) return;
      const full = parts.join(" / ");
      const candidates = parts.length > 2
        ? [full, `${parts[0]} / … / ${parts.at(-1)}`]
        : [full];
      for (const candidate of candidates) {
        label.textContent = candidate;
        if (label.scrollWidth <= label.clientWidth + 1) return;
      }
    });
  }
  function setChevron(chevron, variant) {
    if (appearance.chevronIcon) { chevron.innerHTML = appearance.chevronIcon(); return; }
    if (variant === "variant-b") {
      chevron.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg>';
    } else {
      chevron.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 6h15L10 14.5Z" fill="currentColor"/></svg>';
    }
  }
  function toggleChildrenAtFixedPosition(control, children, expanded) {
    const panel = list;
    const tail = panel.querySelector(".scroll-tail");
    const previousScrollTop = panel.scrollTop;
    tail.style.height = "0px";
    children.hidden = !expanded;
    const missingScrollRange = Math.max(0, previousScrollTop + panel.clientHeight - panel.scrollHeight);
    tail.style.height = `${Math.ceil(missingScrollRange)}px`;
    panel.scrollTop = previousScrollTop;
  }
  function renderNodes(nodes, parent, variant, prefix = []) {
    nodes.forEach((node) => {
      const chain = node.kind === "folder" ? compact(node) : null;
      const parts = chain ? chain.parts : [node.name];
      const full = [...prefix, ...parts].join(" / ");
      const hoverName = chain ? parts.join(" / ") : node.name;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tree-row";
      row.dataset.kind = node.kind;
      if (node.kind === "file") row.dataset.fileKey = node.entry.key;
      row.dataset.hoverName = hoverName;
      if (node.kind === "file") row.dataset.modified = String(Boolean(node.entry.modified));
      row.setAttribute("aria-label", full);
      row.dataset.treeKey = node.id || node.entry?.key;
      if (node.kind === "folder") row.setAttribute("aria-expanded", "true");
      const chevron = document.createElement("span");
      chevron.className = "chevron";
      if (node.kind === "folder") setChevron(chevron, variant);
      const icon = document.createElement("span");
      icon.className = "tree-icon";
      icon.innerHTML = node.kind === "folder" ? folderIcon(variant, true) : node.entry.modified ? (appearance.modifiedIcon?.() || modifiedFileIcon()) : fileIcon(variant, node.name);
      const label = document.createElement("span");
      label.className = "tree-label";
      if (node.kind === "file") label.classList.add("file-entry-name");
      label.textContent = chain ? parts.join(" / ") : node.name;
      if (chain && parts.length > 1) chainLabels.push({ label, parts });
      row.append(chevron, icon, label);
      if (node.kind === "folder") {
        const count = document.createElement("span");
        count.className = "mini-count collapse-count";
        count.textContent = String(countFiles(chain.tail.children));
        row.append(count);
      }
      if (node.kind === "file" && node.entry.deletable) {
        const shell = document.createElement("div");
        shell.className = "draft-entry";
        const remove = document.createElement("button");
        remove.className = "draft-delete";
        remove.type = "button";
        remove.setAttribute("aria-label", `${currentLabels.deleteFile || "Delete"} ${node.name}`);
        remove.title = `${currentLabels.deleteFile || "Delete"} ${node.name}`;
        remove.innerHTML = svg.trash;
        shell.append(row, remove);
        parent.append(shell);
        remove.addEventListener("click", (event) => {
          if ((event.pointerType === "touch" || event.pointerType === "pen" || matchMedia("(hover: none)").matches) && row.getAttribute("aria-current") !== "true") {
            row.click();
            return;
          }
          onDelete?.(node.entry);
        });
      } else parent.append(row);
      if (node.kind === "folder") {
        const children = document.createElement("div");
        children.className = "tree-children";
        renderNodes(chain.tail.children, children, variant, [...prefix, ...parts]);
        parent.append(children);
        row.addEventListener("click", () => {
          const closed = row.getAttribute("aria-expanded") === "true";
          row.setAttribute("aria-expanded", String(!closed));
          if (variant === "variant-c" || variant === "variant-d" || variant === "variant-e") icon.innerHTML = folderIcon(variant, !closed);
          toggleChildrenAtFixedPosition(row, children, !closed);
          root.dispatchEvent(new Event("treechange"));
          requestAnimationFrame(fitChainLabels);
        });
        row.setTreeExpanded = (expanded) => {
          row.setAttribute("aria-expanded", String(expanded));
          icon.innerHTML = folderIcon(variant, expanded);
          children.hidden = !expanded;
        };
      } else {
        row.setAttribute("aria-current", "false");
        row.addEventListener("click", () => {
          const article = root;
          const requestId = ++selectionRequestId;
          const select = () => {
            if (root !== article || requestId !== selectionRequestId) return;
            article.querySelectorAll('.tree-row[aria-current="true"]').forEach((item) => item.setAttribute("aria-current", "false"));
            article.querySelectorAll(".contains-selected").forEach((item) => item.classList.remove("contains-selected"));
            row.setAttribute("aria-current", "true");
            for (let ancestor = row.parentElement; ancestor && ancestor !== article; ancestor = ancestor.parentElement) {
              if (ancestor.classList.contains("tree-children")) ancestor.previousElementSibling.classList.add("contains-selected");
              if (ancestor.classList.contains("source-body")) ancestor.closest(".source-section").querySelector(".source-heading").classList.add("contains-selected");
            }
            article.dispatchEvent(new Event("fileselected"));
          };
          const opened = onOpen?.(node.entry);
          if (opened && typeof opened.then === "function") {
            opened.then(value => { if (value !== false) select(); }).catch(() => {});
          } else if (opened !== false) select();
        });
      }
    });
  }
  function attachLens(article) {
    const panel = article;
    const lens = document.createElement("div");
    lens.className = "files-hover-lens files-tree-lens";
    lens.classList.add(...article.classList);
    lens.style.cssText = article.style.cssText;
    lens.setAttribute("aria-hidden", "true");
    const track = document.createElement("div");
    track.className = "files-hover-lens-track";
    lens.append(track);
    document.body.append(lens);
    let rows = [];
    let target = null;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    function clearTarget() {
      target?.classList.remove("lens-target");
      target?.style.removeProperty("--lens-strength");
      target = null;
    }
    function hide(immediate = false) {
      clearTarget();
      article.classList.remove("lens-open");
      lens.classList.toggle("is-selected-hidden", immediate);
      lens.classList.add("returning");
      lens.classList.remove("visible");
      lens.style.setProperty("--pull-x", "0px");
    }
    function prepare() {
      track.replaceChildren();
      let offset = 0;
      rows = [...panel.querySelectorAll(".tree-row")].filter((row) => row.getClientRects().length && row.getBoundingClientRect().height);
      if (rows[0]) lens.style.font = getComputedStyle(rows[0]).font;
      rows = rows.map((button) => {
        const name = document.createElement("div");
        name.className = "files-hover-lens-name files-tree-lens-name";
        name.dataset.kind = button.dataset.kind;
        name.dataset.modified = button.dataset.modified;
        if (button.closest(".draft-entry")) name.style.paddingRight = "36px";
        if (button.dataset.kind === "folder") {
          name.style.color = getComputedStyle(button).color;
          name.style.fontWeight = getComputedStyle(button).fontWeight;
        }
        name.style.width = `${button.getBoundingClientRect().width}px`;
        name.innerHTML = button.querySelector(".tree-icon").innerHTML;
        if (appearance.folderIcon && button.dataset.kind === "folder") {
          name.querySelector("svg").style.color = getComputedStyle(button.querySelector(".tree-icon")).color;
        }
        const deleteTarget = button.closest(".draft-entry")?.querySelector(".draft-delete");
        if (deleteTarget) {
          const action = document.createElement("span");
          action.className = "draft-delete lens-delete";
          action.innerHTML = svg.trash;
          action.setAttribute("aria-hidden", "true");
          name.append(action);
        }
        const label = document.createElement("span");
        label.textContent = button.dataset.hoverName;
        if (button.dataset.kind === "folder") label.style.fontStyle = getComputedStyle(button.querySelector(".tree-label")).fontStyle;
        name.append(label);
        track.append(name);
        const height = Math.max(36, label.scrollHeight * 1.1 + 12);
        name.style.height = `${height}px`;
        const entry = { button, name, label, height, center: offset + height / 2 };
        offset += height;
        return entry;
      });
    }
    function move(event) {
      const overDelete = [...panel.querySelectorAll(".source-body")].some((body) => {
        const row = body.querySelector(".draft-entry .tree-row");
        if (!row) return false;
        const rect = row.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        const actionColumnLeft = rect.right - parseFloat(getComputedStyle(row).paddingRight);
        return rect.width && bodyRect.height && event.clientX >= actionColumnLeft
          && event.clientY >= bodyRect.top && event.clientY <= bodyRect.bottom;
      });
      if (overDelete) { hide(); return; }
      const hit = event.target.closest(".tree-row") || event.target.closest(".draft-entry")?.querySelector(".tree-row");
      if (!hit || !panel.contains(hit)) { hide(); return; }
      if (hit.getAttribute("aria-current") === "true") { hide(true); return; }
      if (!rows.length) prepare();
      const group = hit.closest(".source-section");
      const visible = rows.filter((row) => row.button.closest(".source-section") === group).map((row) => ({ ...row, rect: row.button.getBoundingClientRect() }));
      if (!visible.length) { hide(); return; }
      let lower = visible[0], upper = visible.at(-1);
      for (const row of visible) {
        const middle = row.rect.top + row.rect.height / 2;
        if (middle <= event.clientY) lower = row;
        if (middle >= event.clientY) { upper = row; break; }
      }
      const a = lower.rect.top + lower.rect.height / 2;
      const b = upper.rect.top + upper.rect.height / 2;
      const pitch = b - a;
      const fraction = pitch > 0 ? clamp((event.clientY - a) / pitch, 0, 1) : 0;
      const t = pitch > 18 ? clamp((fraction * pitch - 9) / (pitch - 18), 0, 1) : fraction;
      const folderBoundary = lower.button.dataset.kind === "folder" || upper.button.dataset.kind === "folder";
      const folderLock = (row) => row.button.dataset.kind === "folder" ? row.rect.height * .4 : 0;
      const start = a + folderLock(lower);
      const end = b - folderLock(upper);
      const progress = end > start ? clamp((event.clientY - start) / (end - start), 0, 1) : fraction;
      const eased = progress * progress * (3 - 2 * progress);
      const blend = folderBoundary ? eased : t * t * (3 - 2 * t);
      const canBlend = lower.button.getAttribute("aria-current") !== "true"
        && upper.button.getAttribute("aria-current") !== "true";
      const current = visible.find((row) => row.button === hit);
      if (!current) { hide(); return; }
      clearTarget();
      if (hit.dataset.kind === "file") {
        target = hit;
        target.classList.add("lens-target");
        const hitRect = hit.getBoundingClientRect();
        const distance = Math.abs(event.clientY - (hitRect.top + hitRect.height / 2));
        const travel = clamp((distance - 9) / Math.max(1, pitch / 2 - 9), 0, 1);
        const strength = 1 - travel * travel;
        const underlineStrength = `${30 + 35 * strength}%`;
        target.style.setProperty("--lens-strength", underlineStrength);
        lens.style.setProperty("--lens-strength", underlineStrength);
      }
      const height = canBlend ? lower.height + (upper.height - lower.height) * blend : current.height;
      const center = canBlend ? (folderBoundary
        ? lower.center + (upper.center - lower.center) * blend
        : lower.center + pitch * fraction + (upper.center - lower.center - pitch) * blend) : current.center;
      const left = canBlend ? lower.rect.left + (upper.rect.left - lower.rect.left) * blend : current.rect.left;
      const width = canBlend ? lower.rect.width + (upper.rect.width - lower.rect.width) * blend : current.rect.width;
      rows.forEach((row) => {
        const weight = !canBlend ? Number(row.button === hit)
          : lower.button === upper.button ? Number(row.button === lower.button)
          : row.button === lower.button ? 1 - blend : row.button === upper.button ? blend : 0;
        row.name.style.visibility = weight > 0 ? "visible" : "hidden";
        row.name.style.opacity = String(weight);
        row.name.style.marginLeft = `${row.button.getBoundingClientRect().left - left}px`;
        row.label.style.transform = `scale(${1 + .1 * weight})`;
        row.name.classList.toggle("current", row.button === hit && hit.dataset.kind === "file");
      });
      const rowRect = hit.getBoundingClientRect();
      lens.classList.toggle("has-delete", Boolean(hit.closest(".draft-entry")));
      const horizontal = clamp((event.clientX - left - width / 2) / (width / 2), -1, 1);
      const pull = Math.sign(horizontal) * (1 - (1 - Math.abs(horizontal)) ** 2) * 9;
      lens.classList.remove("returning");
      lens.style.setProperty("--pull-x", `${pull}px`);
      lens.style.left = `${left}px`;
      lens.style.width = `${width}px`;
      lens.style.top = `${canBlend ? (folderBoundary ? a + pitch * blend : clamp(event.clientY, a, b)) : rowRect.top + rowRect.height / 2}px`;
      lens.style.height = `${height + 2}px`;
      track.style.transform = `translateY(${height / 2 - center}px)`;
      lens.classList.remove("is-selected-hidden");
      lens.classList.add("visible");
      article.classList.add("lens-open");
    }
    panel.addEventListener("pointermove", (event) => { if (event.pointerType === "mouse") move(event); });
    panel.addEventListener("pointerleave", (event) => { if (!lens.contains(event.relatedTarget)) hide(); });
    panel.addEventListener("scroll", () => { hide(); rows = []; }, { passive: true });
    article.addEventListener("treechange", () => { hide(true); rows = []; });
    article.addEventListener("fileselected", () => hide(true));
    const onResize = () => { hide(); rows = []; };
    window.addEventListener("resize", onResize);
    return () => { lens.remove(); window.removeEventListener("resize", onResize); };
  }

  function reveal(key) {
    const selected = [...root.querySelectorAll("[data-file-key]")].find(node => node.dataset.fileKey === key);
    if (!selected) return;
    for (let parent = selected.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (parent.classList.contains("tree-children")) parent.previousElementSibling.setTreeExpanded(true);
      if (parent.classList.contains("source-body")) parent.closest(".source-section").querySelector(".source-heading").setTreeExpanded(true);
    }
    remember();
    root.dispatchEvent(new Event("treechange"));
    selected.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function expandGroup(kind, keys = []) {
    const section = [...root.querySelectorAll(".source-section")].find(node => node.dataset.group === kind);
    if (!section) return;
    section.querySelector(".source-heading").setTreeExpanded(true);
    section.querySelectorAll("[data-file-key]").forEach(row => {
      if (!keys.includes(row.dataset.fileKey)) return;
      for (let parent = row.parentElement; parent && parent !== section; parent = parent.parentElement) {
        if (parent.classList.contains("tree-children")) parent.previousElementSibling.setTreeExpanded(true);
      }
    });
    remember();
    root.dispatchEvent(new Event("treechange"));
    requestAnimationFrame(fitChainLabels);
  }
  function setModified(key, modified) {
    if (!root) return;
    const row = [...root.querySelectorAll("[data-file-key]")].find(node => node.dataset.fileKey === key);
    if (!row || row.dataset.modified === String(modified)) return;
    row.dataset.modified = String(modified);
    row.querySelector(".tree-icon").innerHTML = modified ? modifiedFileIcon() : svg.file;
    root.dispatchEvent(new Event("treechange"));
  }
  return { render, reveal, expandGroup, setModified };
}
