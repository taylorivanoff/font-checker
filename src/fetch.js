const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export function browserHeaders(pageUrl, { forFont = false } = {}) {
  const origin = new URL(pageUrl).origin;
  const headers = {
    'User-Agent': CHROME_UA,
    Accept: forFont
      ? 'font/woff2,font/woff,*/*;q=0.8'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  if (forFont) {
    headers.Referer = pageUrl;
    headers.Origin = origin;
    headers['Sec-Fetch-Dest'] = 'font';
    headers['Sec-Fetch-Mode'] = 'cors';
    headers['Sec-Fetch-Site'] = 'cross-site';
  } else {
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = 'none';
  }

  return headers;
}

export async function fetchText(url, { referer, timeoutMs = 30_000 } = {}) {
  const headers = browserHeaders(referer || url, { forFont: false });
  if (referer) headers.Referer = referer;

  const res = await fetchWithTimeout(url, { headers, redirect: 'follow' }, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return {
    url: res.url,
    contentType: res.headers.get('content-type') || '',
    text: await res.text(),
  };
}

export async function fetchBinary(url, { pageUrl, timeoutMs = 30_000 } = {}) {
  const headers = browserHeaders(pageUrl, { forFont: true });
  const res = await fetchWithTimeout(url, { headers, redirect: 'follow' }, timeoutMs);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    ok: res.ok,
    status: res.status,
    finalUrl: res.url,
    contentType: res.headers.get('content-type') || '',
    buffer: buf,
  };
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export function sniffFontFormat(buffer) {
  if (!buffer || buffer.length < 4) return null;
  const tag = buffer.subarray(0, 4).toString('ascii');
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'ttcf') return 'ttc';
  if (buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00) {
    return 'ttf';
  }
  if (tag.startsWith('<!') || tag.startsWith('<ht') || tag.startsWith('<HT')) return 'html';
  return null;
}
