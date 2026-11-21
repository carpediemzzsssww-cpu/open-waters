const paths = {
  atlas: '<path d="m3 6 6-2.5 6 2.5 6-2.5v14L15 20l-6-2.5L3 20z"/><path d="M9 3.5v14M15 6v14"/>',
  helm: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.7"/><path d="M12 2.5v7.8m0 3.4v7.8m-8.2-14 6.7 3.7m3 1.6 6.7 3.7m-16.4 0 6.7-3.7m3-1.6 6.7-3.7"/>',
  dusk: '<path d="M7 15a5 5 0 0 1 10 0M2 16h20M5 20h14M12 4v2M4.1 8l1.6 1.6M20 8l-1.6 1.6"/>',
  board: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  close: '<path d="m6.5 6.5 11 11m0-11-11 11"/>',
  play: '<path d="m8 5 10 7-10 7z"/>',
  pause: '<path d="M8.5 5v14m7-14v14"/>',
  replay: '<path d="M4 5v5h5"/><path d="M4.3 10a8 8 0 1 1 1.2 7.5"/>',
};

export function icon(name: keyof typeof paths) {
  return `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}
