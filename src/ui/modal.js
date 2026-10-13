export function createModal({ overlay, content, closeButton, initialFocus = closeButton,
  document = overlay.ownerDocument, onOpen = () => {}, onClose = () => {} }) {
  let previousFocus, inactive = [], bound = false;
  const isOpen = () => !overlay.hidden;

  function setOpen(open) {
    if (open === isOpen()) return;
    if (open) {
      previousFocus = document.activeElement;
      inactive = [...document.body.children].filter(node => node !== overlay && !node.contains(overlay))
        .map(node => [node, node.inert]);
      inactive.forEach(([node]) => { node.inert = true; });
      overlay.hidden = false;
      content.setAttribute("open", "");
      onOpen();
      initialFocus.focus({ preventScroll: true });
    } else {
      overlay.hidden = true;
      content.removeAttribute("open");
      inactive.forEach(([node, inert]) => { node.inert = inert; });
      inactive = [];
      onClose();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    }
  }

  function handleKey(event) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (event.key !== "Tab") return;
    const controls = [...content.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')]
      .filter(node => !node.closest("[hidden]") && node.getClientRects().length);
    const first = controls[0], last = controls.at(-1), active = document.activeElement;
    if (!first) { event.preventDefault(); content.focus(); return; }
    if (!controls.includes(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
  }

  function bindEvents() {
    if (bound) return;
    bound = true;
    closeButton.addEventListener("click", () => setOpen(false));
    overlay.addEventListener("click", event => {
      if (event.target === overlay) setOpen(false);
    });
    document.addEventListener("keydown", event => { if (isOpen()) handleKey(event); }, true);
    overlay.addEventListener("keydown", event => event.stopPropagation());
  }
  return { isOpen, setOpen, bindEvents };
}
