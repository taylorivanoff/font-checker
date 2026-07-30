const FONT_EXT_RE = /\.(woff2?|ttf|otf|eot)(?:\?|#|$)/i;
const URL_IN_CSS_RE = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi;
const FONT_FACE_RE = /@font-face\s*\{([\s\S]*?)\}/gi;

/**
 * Extract font references from HTML + inline/linked CSS text.
 * Handles Fontdue/RSC payloads where names are hashed in the URL.
 */
export function extractFonts(html, pageUrl) {
  const byUrl = new Map();
  const warnings = [];

  addFromFontFaceBlocks(html, pageUrl, byUrl);
  addFromBareFontUrls(html, pageUrl, byUrl);
  addFromFontduePayloads(html, pageUrl, byUrl);

  // Linked stylesheets (resolved later by caller if needed)
  const stylesheets = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
    .map((m) => {
      const href = m[0].match(/href=["']([^"']+)["']/i);
      return href ? resolveUrl(pageUrl, href[1]) : null;
    })
    .filter(Boolean);

  return {
    fonts: [...byUrl.values()],
    stylesheets,
    warnings,
  };
}

export function mergeCssFonts(cssText, cssUrl, fonts) {
  const byUrl = new Map(fonts.map((f) => [primaryUrl(f), f]));
  addFromFontFaceBlocks(cssText, cssUrl, byUrl);
  addFromBareFontUrls(cssText, cssUrl, byUrl);
  return [...byUrl.values()];
}

function primaryUrl(font) {
  const woff2 = font.sources.find((s) => s.format === 'woff2');
  return (woff2 || font.sources[0])?.url;
}

function addFromFontFaceBlocks(text, baseUrl, byUrl) {
  for (const match of text.matchAll(FONT_FACE_RE)) {
    const block = match[1];
    const family = firstMatch(block, /font-family\s*:\s*([^;]+);/i);
    const weight = firstMatch(block, /font-weight\s*:\s*([^;]+);/i);
    const style = firstMatch(block, /font-style\s*:\s*([^;]+);/i);
    const cssFamily = family ? cleanCssName(family) : null;

    const sources = [];
    for (const urlMatch of block.matchAll(URL_IN_CSS_RE)) {
      const raw = urlMatch[2].trim();
      if (!FONT_EXT_RE.test(raw) && !/format\(/i.test(block)) continue;
      const abs = resolveUrl(baseUrl, raw);
      if (!abs || !FONT_EXT_RE.test(abs)) continue;
      const formatDecl = findFormatNear(block, raw);
      sources.push({
        url: abs,
        format: formatDecl || extFormat(abs),
      });
    }

    // Also pick format(woff2) siblings
    for (const src of extractSrcList(block, baseUrl)) {
      if (!sources.some((s) => s.url === src.url)) sources.push(src);
    }

    for (const src of sources) upsert(byUrl, src, {
      cssFamily,
      cssWeight: weight?.trim() || null,
      cssStyle: style?.trim() || null,
      origin: 'css-font-face',
    });
  }
}

function extractSrcList(block, baseUrl) {
  const src = firstMatch(block, /src\s*:\s*([^;]+);/i);
  if (!src) return [];
  const out = [];
  const parts = src.split(/\s*,\s*/);
  for (const part of parts) {
    const u = part.match(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/i);
    if (!u) continue;
    const abs = resolveUrl(baseUrl, u[2].trim());
    if (!abs) continue;
    const fmt = part.match(/format\(\s*['"]?([a-z0-9-]+)/i);
    out.push({ url: abs, format: (fmt?.[1] || extFormat(abs)).toLowerCase() });
  }
  return out;
}

function findFormatNear(block, urlFragment) {
  const idx = block.indexOf(urlFragment);
  if (idx < 0) return null;
  const window = block.slice(idx, idx + urlFragment.length + 40);
  const m = window.match(/format\(\s*['"]?([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function addFromBareFontUrls(text, baseUrl, byUrl) {
  const re = /https?:\/\/[^\s"'<>)\\]+?\.(?:woff2?|ttf|otf|eot)/gi;
  for (const m of text.matchAll(re)) {
    let url = m[0].replace(/\\+$/, '').replace(/\\"/g, '').replace(/&amp;/g, '&');
    // Trim trailing escape artifacts from RSC JSON
    url = url.replace(/\\+$/, '');
    if (!/^https?:\/\//i.test(url)) continue;
    upsert(byUrl, { url, format: extFormat(url) }, { origin: 'url-scan' });
  }

  // Root-relative / hashed Fontdue-style paths inside JSON
  const rel = /["'](\/[^"']+\.(?:woff2?|ttf|otf))["']/gi;
  for (const m of text.matchAll(rel)) {
    const abs = resolveUrl(baseUrl, m[1]);
    if (abs) upsert(byUrl, { url: abs, format: extFormat(abs) }, { origin: 'url-scan' });
  }
}

/**
 * Fontdue / Next RSC: familyName + styleName + webfontSources
 * and cssFamily + name + webfontSources (escaped or plain JSON).
 */
function addFromFontduePayloads(text, baseUrl, byUrl) {
  const patterns = [
    /(?:\\?")familyName(?:\\?")\s*:\s*(?:\\?")([^\\"]+)(?:\\?")\s*,\s*(?:\\?")styleName(?:\\?")\s*:\s*(?:\\?")([^\\"]+)(?:\\?")\s*,\s*(?:\\?")webfontSources(?:\\?")\s*:\s*(\[[^\]]+\])/g,
    /(?:\\?")cssFamily(?:\\?")\s*:\s*(?:\\?")([^\\"]+)(?:\\?")\s*,\s*(?:\\?")name(?:\\?")\s*:\s*(?:\\?")([^\\"]+)(?:\\?")\s*,\s*(?:\\?")webfontSources(?:\\?")\s*:\s*(\[[^\]]+\])/g,
  ];

  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const familyOrCss = unescapeJson(m[1]);
      const styleOrName = unescapeJson(m[2]);
      const sourcesJson = unescapeJson(m[3]);
      const sources = parseWebfontSources(sourcesJson, baseUrl);
      const isCssFamilyShape = re.source.includes('cssFamily');

      const label = buildLabel(familyOrCss, styleOrName);
      const meta = isCssFamilyShape
        ? {
            pageIdentity: {
              cssFamily: familyOrCss,
              styleName: styleOrName,
              label,
            },
            cssFamily: familyOrCss,
            origin: 'fontdue-cssFamily',
          }
        : {
            pageIdentity: {
              familyName: familyOrCss,
              styleName: styleOrName,
              label,
            },
            cssFamily: label,
            origin: 'fontdue-familyName',
          };

      for (const src of sources) upsert(byUrl, src, meta);
    }
  }
}

function parseWebfontSources(jsonLike, baseUrl) {
  const sources = [];
  const re =
    /(?:\\?")format(?:\\?")\s*:\s*(?:\\?")([^\\"]+)(?:\\?")\s*,\s*(?:\\?")url(?:\\?")\s*:\s*(?:\\?")([^\\"]+)(?:\\?")/g;
  for (const m of jsonLike.matchAll(re)) {
    const format = unescapeJson(m[1]).toLowerCase();
    let url = unescapeJson(m[2]);
    url = resolveUrl(baseUrl, url) || url;
    sources.push({ url, format: format || extFormat(url) });
  }
  // url-first order variant
  const re2 =
    /(?:\\?")url(?:\\?")\s*:\s*(?:\\?")([^\\"]+)(?:\\?")\s*,\s*(?:\\?")format(?:\\?")\s*:\s*(?:\\?")([^\\"]+)(?:\\?")/g;
  for (const m of jsonLike.matchAll(re2)) {
    let url = unescapeJson(m[1]);
    url = resolveUrl(baseUrl, url) || url;
    const format = unescapeJson(m[2]).toLowerCase();
    if (!sources.some((s) => s.url === url)) {
      sources.push({ url, format: format || extFormat(url) });
    }
  }
  return sources;
}

function upsert(byUrl, src, meta) {
  if (!src?.url || !isCompleteFontUrl(src.url)) return;
  let font = byUrl.get(src.url);
  // Group by woff2 hash stem so .woff + .woff2 of same file merge
  const stem = fontStem(src.url);
  if (!font) {
    for (const [url, existing] of byUrl) {
      if (fontStem(url) === stem) {
        font = existing;
        break;
      }
    }
  }
  if (!font) {
    font = {
      sources: [],
      cssFamily: null,
      cssWeight: null,
      cssStyle: null,
      pageIdentity: null,
      origins: new Set(),
    };
    byUrl.set(src.url, font);
  }

  if (!font.sources.some((s) => s.url === src.url)) {
    font.sources.push({ url: src.url, format: src.format });
  }
  // Prefer woff2 URL as map key
  if (src.format === 'woff2' && byUrl.get(src.url) !== font) {
    byUrl.set(src.url, font);
  }

  if (meta.cssFamily && !isGenericFamily(meta.cssFamily)) {
    font.cssFamily = meta.cssFamily;
  }
  if (meta.cssWeight) font.cssWeight = meta.cssWeight;
  if (meta.cssStyle) font.cssStyle = meta.cssStyle;
  if (meta.pageIdentity) {
    font.pageIdentity = { ...font.pageIdentity, ...meta.pageIdentity };
  }
  if (meta.origin) font.origins.add(meta.origin);
}

function isCompleteFontUrl(url) {
  try {
    const { pathname } = new URL(url);
    return /\.(woff2?|ttf|otf|eot)$/i.test(pathname);
  } catch {
    return false;
  }
}

function buildLabel(family, style) {
  const f = (family || '').trim();
  const s = (style || '').trim();
  if (!s) return f;
  if (!f) return s;
  if (f.toLowerCase().endsWith(s.toLowerCase())) return f;
  return `${f} ${s}`;
}

function fontStem(url) {
  try {
    const path = new URL(url).pathname;
    return path.replace(/\.(woff2?|ttf|otf|eot)$/i, '');
  } catch {
    return url.replace(/\.(woff2?|ttf|otf|eot)$/i, '');
  }
}

function cleanCssName(value) {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

export function isGenericFamily(name) {
  if (!name) return true;
  const n = name.replace(/^["']|["']$/g, '').trim().toLowerCase();
  return [
    'fallback',
    'inherit',
    'initial',
    'unset',
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-sans-serif',
    'ui-serif',
    'ui-monospace',
    'ui-rounded',
  ].includes(n);
}

function extFormat(url) {
  const m = url.toLowerCase().match(/\.(woff2?|ttf|otf|eot)(?:\?|#|$)/);
  return m ? m[1] : 'unknown';
}

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}

function unescapeJson(s) {
  return s
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function resolveUrl(base, maybeRelative) {
  try {
    if (!maybeRelative) return null;
    let u = maybeRelative.trim().replace(/^['"]|['"]$/g, '');
    if (u.startsWith('data:')) return null;
    // Strip RSC trailing junk
    u = u.replace(/\\+$/, '');
    return new URL(u, base).href;
  } catch {
    return null;
  }
}

export function looksNameScrubbed(nameTable) {
  if (!nameTable) return false;
  const blob = [
    nameTable.fontFamily,
    nameTable.fontSubFamily,
    nameTable.fullName,
    nameTable.postScriptName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    blob.includes('not for desktop') ||
    blob.includes('copyright') ||
    blob.includes('web only') ||
    blob.includes('webfont') ||
    blob.includes('do not') ||
    blob.includes('preview')
  );
}
