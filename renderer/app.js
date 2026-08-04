(() => {
  const api = window.fontChecker;
  if (!api) return;

  const fieldUrl = document.getElementById('field-url');
  const fieldMode = document.getElementById('field-mode');
  const recentList = document.getElementById('recent-urls');
  const resultsEl = document.getElementById('results');
  const resultsLabel = document.getElementById('results-label');
  const detailEl = document.getElementById('detail');
  const warningsEl = document.getElementById('warnings');
  const outLabel = document.getElementById('out-label');
  const toast = document.getElementById('toast');
  const settingsOverlay = document.getElementById('settings-overlay');

  const btnScan = document.getElementById('btn-scan');
  const btnPickOut = document.getElementById('btn-pick-out');
  const btnOpenOut = document.getElementById('btn-open-out');
  const btnReveal = document.getElementById('btn-reveal');
  const btnSettings = document.getElementById('btn-settings');
  const settingsClose = document.getElementById('settings-close');
  const settingAot = document.getElementById('setting-aot');
  const settingMinimised = document.getElementById('setting-minimised');
  const settingTimeout = document.getElementById('setting-timeout');
  const settingOpacity = document.getElementById('setting-opacity');
  const settingOpacityOut = document.getElementById('setting-opacity-out');
  const settingsMeta = document.getElementById('settings-meta');

  let settings = {
    opacity: 0.94,
    alwaysOnTop: true,
    startMinimised: false,
    outDir: '',
    mode: 'convert',
    timeoutMs: 30000,
    recentUrls: []
  };
  let fonts = [];
  let selectedIndex = -1;
  let lastOutDir = null;
  let scanning = false;
  let toastTimer = null;

  function opacityToPercent(opacity) {
    return Math.round((1 - Math.min(1, Math.max(0.35, Number(opacity) || 0.94))) * 100);
  }

  function percentToOpacity(percent) {
    return Math.min(1, Math.max(0.35, 1 - (Number(percent) || 0) / 100));
  }

  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle('error', !!isError);
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 2800);
  }

  function fontLabel(font) {
    return font.pageIdentity?.label
      || font.cssFamily
      || font.sources?.[0]?.url?.replace(/^.*\//, '')
      || 'Unknown font';
  }

  function firstFile(font) {
    for (const src of font.sources || []) {
      if (src.convertedPath) return src.convertedPath;
      if (src.downloadedPath) return src.downloadedPath;
    }
    return null;
  }

  function updateOutLabel() {
    outLabel.textContent = settings.outDir
      ? settings.outDir
      : 'Documents/Font Checker (default)';
  }

  function renderRecent() {
    recentList.innerHTML = '';
    for (const url of settings.recentUrls || []) {
      const opt = document.createElement('option');
      opt.value = url;
      recentList.appendChild(opt);
    }
  }

  function renderWarnings(list) {
    warningsEl.textContent = (list || []).join('\n');
  }

  function renderDetail() {
    const font = fonts[selectedIndex];
    btnReveal.disabled = !(font && firstFile(font));
    if (!font) {
      detailEl.textContent = 'Scan a page to discover fonts, including Fontdue / Next.js patterns.';
      return;
    }

    const lines = [
      fontLabel(font),
      '',
      `CSS family: ${font.cssFamily || '-'}`,
      `Weight / style: ${font.cssWeight ?? '-'} / ${font.cssStyle ?? '-'}`,
      `Origins: ${(font.origins || []).join(', ') || '-'}`,
      `Scrubbed name table: ${font.nameScrubbed ? 'yes' : 'no'}`,
      font.glyphCount != null ? `Glyphs: ${font.glyphCount}` : null,
      font.cmapCount != null ? `Cmap: ${font.cmapCount}` : null,
      '',
      'Name table:',
      font.nameTable ? JSON.stringify(font.nameTable, null, 2) : '-',
      '',
      'Sources:'
    ].filter((line) => line != null);

    for (const src of font.sources || []) {
      lines.push(`- ${src.format || '?'} ${src.url}`);
      if (src.downloadedPath) lines.push(`  downloaded: ${src.downloadedPath}`);
      if (src.convertedPath) lines.push(`  converted: ${src.convertedPath}`);
      if (src.error) lines.push(`  error: ${src.error}`);
    }

    detailEl.textContent = lines.join('\n');
  }

  function renderResults() {
    resultsLabel.textContent = fonts.length ? `Fonts (${fonts.length})` : 'Fonts';
    btnOpenOut.disabled = !lastOutDir;

    if (!fonts.length) {
      resultsEl.innerHTML = '<div class="list-empty">No fonts yet.<br>Enter a URL and scan.</div>';
      renderDetail();
      return;
    }

    resultsEl.innerHTML = '';
    fonts.forEach((font, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `row${index === selectedIndex ? ' active' : ''}`;
      const file = firstFile(font);
      const meta = [
        font.cssFamily,
        font.cssWeight,
        font.cssStyle,
        font.nameScrubbed ? 'scrubbed' : null,
        file ? 'saved' : null
      ].filter(Boolean).join(' · ');
      row.innerHTML = `
        <div class="row-body">
          <div class="row-title"></div>
          <div class="row-meta"></div>
        </div>
        <span class="badge"></span>
      `;
      row.querySelector('.row-title').textContent = fontLabel(font);
      row.querySelector('.row-meta').textContent = meta || (font.sources?.[0]?.url || '');
      const badge = row.querySelector('.badge');
      if (font.sources?.some((s) => s.error)) {
        badge.textContent = 'error';
        badge.classList.add('err');
      } else if (file) {
        badge.textContent = 'saved';
        badge.classList.add('ok');
      } else {
        badge.textContent = (font.origins || [])[0] || 'found';
      }
      row.addEventListener('click', () => {
        selectedIndex = index;
        renderResults();
      });
      resultsEl.appendChild(row);
    });
    renderDetail();
  }

  function applySettings(next) {
    settings = { ...settings, ...next };
    settingAot.checked = !!settings.alwaysOnTop;
    settingMinimised.checked = !!settings.startMinimised;
    settingTimeout.value = String(settings.timeoutMs || 30000);
    settingOpacity.value = String(opacityToPercent(settings.opacity));
    settingOpacityOut.textContent = `${settingOpacity.value}%`;
    fieldMode.value = settings.mode || 'convert';
    updateOutLabel();
    renderRecent();
  }

  function setScanning(value) {
    scanning = value;
    btnScan.disabled = scanning;
    fieldUrl.disabled = scanning;
    fieldMode.disabled = scanning;
    btnScan.textContent = scanning ? 'Scanning…' : 'Scan';
  }

  async function runScan() {
    const url = fieldUrl.value.trim();
    if (!url) {
      showToast('Enter a page URL', true);
      return;
    }
    setScanning(true);
    detailEl.textContent = 'Scanning…';
    const result = await api.scan({
      url,
      mode: fieldMode.value,
      outDir: settings.outDir || undefined,
      timeoutMs: Number(settingTimeout.value) || settings.timeoutMs
    });
    setScanning(false);

    if (!result.ok) {
      showToast(result.error || 'Scan failed', true);
      detailEl.textContent = result.error || 'Scan failed.';
      return;
    }

    fonts = result.fonts || [];
    selectedIndex = fonts.length ? 0 : -1;
    lastOutDir = result.outDir || null;
    renderWarnings(result.warnings);
    renderResults();
    showToast(`Found ${fonts.length} font${fonts.length === 1 ? '' : 's'}`);
  }

  btnScan.addEventListener('click', () => runScan());
  fieldUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runScan();
  });
  fieldMode.addEventListener('change', async () => {
    applySettings(await api.setSettings({ mode: fieldMode.value }));
  });
  btnPickOut.addEventListener('click', async () => {
    const folder = await api.pickFolder('Choose output folder');
    if (!folder) return;
    applySettings(await api.setSettings({ outDir: folder }));
    showToast('Output folder updated');
  });
  btnOpenOut.addEventListener('click', () => {
    if (lastOutDir) api.openPath(lastOutDir);
  });
  btnReveal.addEventListener('click', () => {
    const font = fonts[selectedIndex];
    const file = font && firstFile(font);
    if (file) api.showItemInFolder(file);
  });
  btnSettings.addEventListener('click', () => settingsOverlay.classList.remove('hidden'));
  settingsClose.addEventListener('click', () => settingsOverlay.classList.add('hidden'));
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
  });

  settingAot.addEventListener('change', async () => {
    applySettings(await api.setSettings({ alwaysOnTop: settingAot.checked }));
  });
  settingMinimised.addEventListener('change', async () => {
    applySettings(await api.setSettings({ startMinimised: settingMinimised.checked }));
  });
  settingTimeout.addEventListener('change', async () => {
    applySettings(await api.setSettings({ timeoutMs: Number(settingTimeout.value) }));
  });
  settingOpacity.addEventListener('input', () => {
    settingOpacityOut.textContent = `${settingOpacity.value}%`;
  });
  settingOpacity.addEventListener('change', async () => {
    applySettings(await api.setSettings({ opacity: percentToOpacity(settingOpacity.value) }));
  });

  api.onSettingsChanged((next) => applySettings(next));

  api.getState().then((state) => {
    document.body.classList.add(`platform-${state.platform}`);
    if (state.dark) document.body.classList.add('dark');
    applySettings(state.settings || {});
    settingsMeta.textContent = `Font Checker v${state.version}`;
    renderResults();
  });
})();
