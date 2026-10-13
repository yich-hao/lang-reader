export const MODIFIED_FILE_PATHS = '<path d="M8 18H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6l4 4v4M11 2v4h4"/><path d="m10 18 1-3 5-5 2 2-5 5-3 1Z"/><path d="m15 11 2 2"/>';
export const FILE_ICON_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M5 2h6l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M11 2v4h4"/></svg>';
export const FOLDER_ICON_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 5a1.5 1.5 0 0 1 1.5-1.5h4l1.7 2H16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16 17.5H4A1.5 1.5 0 0 1 2.5 16Z"/></svg>';
export const FILES_GRIP_SVG = '<svg class="source-grip" viewBox="0 0 14 12" fill="currentColor" aria-hidden="true"><circle cx="5" cy="2" r="1"/><circle cx="9" cy="2" r="1"/><circle cx="5" cy="6" r="1"/><circle cx="9" cy="6" r="1"/><circle cx="5" cy="10" r="1"/><circle cx="9" cy="10" r="1"/></svg>';
export const FILES_TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
export const FILLED_FOLDER_ICON_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5a1.5 1.5 0 0 1 1.5-1.5h4l1.7 2H16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16 17.5H4A1.5 1.5 0 0 1 2.5 16Z" fill="currentColor"/><path d="M4 8h12" fill="none" stroke="#fff" stroke-width="1" opacity=".65"/></svg>';

export function openFolderIconSvg(back = '#d7e9dd', front = '#f3faf4') {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 15V5a1.5 1.5 0 0 1 1.5-1.5h4l1.7 2H16a1.5 1.5 0 0 1 1.5 1.5v8Z" fill="${back}"/><path d="M5.5 8.5h12.4c.6 0 1 .6.8 1.2l-2.2 6.8c-.2.6-.7 1-1.3 1H3.4c-.8 0-1.3-.8-1.1-1.5l2.1-6.7c.2-.5.6-.8 1.1-.8Z" fill="${front}"/></svg>`;
}

export function modifiedFileIcon() {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MODIFIED_FILE_PATHS}</svg>`;
}
