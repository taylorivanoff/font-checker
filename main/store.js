import Store from 'electron-store';

const store = new Store({
  name: 'font-checker',
  defaults: {
    opacity: 1,
    alwaysOnTop: false,
    startMinimised: false,
    outDir: '',
    mode: 'convert',
    timeoutMs: 30000,
    recentUrls: [],
    windowBounds: null
  }
});

// Scaffold initially wrote alwaysOnTop:true; utilities should not float by default.
if (!store.get('_aotDefaultOff')) {
  store.set('alwaysOnTop', false);
  store.set('_aotDefaultOff', true);
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function getSettings() {
  const mode = String(store.get('mode', 'convert') || 'convert');
  return {
    opacity: clamp(store.get('opacity', 0.94), 0.35, 1, 0.94),
    alwaysOnTop: !!store.get('alwaysOnTop', false),
    startMinimised: !!store.get('startMinimised', false),
    outDir: String(store.get('outDir', '') || ''),
    mode: ['discover', 'download', 'convert'].includes(mode) ? mode : 'convert',
    timeoutMs: clamp(store.get('timeoutMs', 30000), 5000, 120000, 30000),
    recentUrls: (store.get('recentUrls', []) || []).filter((u) => typeof u === 'string').slice(0, 12)
  };
}

export function setSettings(partial = {}) {
  if (partial.opacity !== undefined) store.set('opacity', clamp(partial.opacity, 0.35, 1, 0.94));
  if (partial.alwaysOnTop !== undefined) store.set('alwaysOnTop', !!partial.alwaysOnTop);
  if (partial.startMinimised !== undefined) store.set('startMinimised', !!partial.startMinimised);
  if (partial.outDir !== undefined) store.set('outDir', String(partial.outDir || ''));
  if (partial.mode !== undefined) {
    const mode = String(partial.mode || 'convert');
    store.set('mode', ['discover', 'download', 'convert'].includes(mode) ? mode : 'convert');
  }
  if (partial.timeoutMs !== undefined) store.set('timeoutMs', clamp(partial.timeoutMs, 5000, 120000, 30000));
  if (partial.recentUrls !== undefined) {
    store.set(
      'recentUrls',
      (partial.recentUrls || []).filter((u) => typeof u === 'string').slice(0, 12)
    );
  }
  return getSettings();
}

export function pushRecentUrl(url) {
  const clean = String(url || '').trim();
  if (!clean) return getSettings().recentUrls;
  const prev = getSettings().recentUrls.filter((u) => u !== clean);
  const next = [clean, ...prev].slice(0, 12);
  store.set('recentUrls', next);
  return next;
}

export function getWindowBounds() {
  return store.get('windowBounds', null);
}

export function setWindowBounds(bounds) {
  store.set('windowBounds', bounds);
}
