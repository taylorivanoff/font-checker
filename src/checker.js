import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchText, fetchBinary, sniffFontFormat } from './fetch.js';
import { extractFonts, mergeCssFonts, isGenericFamily } from './extract.js';
import {
  convertToOtf,
  readNameTable,
  safeFilename,
  identityFromFont,
} from './convert.js';
import { stitchNextFlight } from './next-flight.js';

export async function checkSite(pageUrl, options = {}) {
  const {
    download = false,
    convert = false,
    outDir = 'font-output',
    timeoutMs = 30_000,
  } = options;

  const warnings = [];
  const page = await fetchText(pageUrl, { timeoutMs });
  const finalPageUrl = page.url || pageUrl;

  const flight = stitchNextFlight(page.text);
  if (flight.stitched) {
    warnings.push(`stitched ${flight.chunkCount} Next.js flight chunks (split URLs)`);
  }

  let { fonts, stylesheets, warnings: extractWarnings } = extractFonts(
    flight.html,
    finalPageUrl
  );
  warnings.push(...extractWarnings);

  // Pull linked stylesheets (limited concurrency)
  for (const sheet of stylesheets.slice(0, 25)) {
    try {
      const css = await fetchText(sheet, { referer: finalPageUrl, timeoutMs });
      fonts = mergeCssFonts(css.text, css.url || sheet, fonts);
    } catch (err) {
      warnings.push(`stylesheet ${sheet}: ${err.message}`);
    }
  }

  // Normalize serializable shape
  fonts = fonts.map((f) => ({
    ...f,
    origins: [...(f.origins || [])],
    sources: preferWoff2First(f.sources),
  }));

  // Deduplicate fonts that share the same page identity label + same stem set
  fonts = dedupeFonts(fonts);

  if (download || convert) {
    await fs.mkdir(outDir, { recursive: true });
  }

  for (const font of fonts) {
    const label =
      font.pageIdentity?.label ||
      (!isGenericFamily(font.cssFamily) && font.cssFamily) ||
      null;

    for (const src of font.sources) {
      if (!download && !convert) continue;
      // Only download preferred format unless it's the only one
      if (font.sources.some((s) => s.format === 'woff2') && src.format !== 'woff2') {
        continue;
      }

      try {
        const res = await fetchBinary(src.url, { pageUrl: finalPageUrl, timeoutMs });
        const sniffed = sniffFontFormat(res.buffer);
        if (!res.ok) {
          src.error = `HTTP ${res.status}`;
          continue;
        }
        if (sniffed === 'html' || !sniffed) {
          src.error = `not a font (sniffed=${sniffed || 'unknown'}; likely hotlink gate)`;
          warnings.push(`Blocked or non-font response for ${src.url}`);
          continue;
        }

        const fileLabel = label || path.basename(new URL(src.url).pathname);
        const rawName = safeFilename(fileLabel, sniffed === 'woff2' ? 'woff2' : sniffed);
        const rawPath = path.join(outDir, rawName);
        await fs.writeFile(rawPath, res.buffer);
        src.downloadedPath = rawPath;
        src.sniffedFormat = sniffed;

        let sfntBuf = null;
        if (sniffed === 'woff2' || sniffed === 'woff') {
          if (convert) {
            const otfName = safeFilename(fileLabel, 'otf');
            const otfPath = path.join(outDir, otfName);
            const identity = identityFromFont(font, fileLabel);
            const converted = await convertToOtf(res.buffer, otfPath, identity);
            src.convertedPath = converted.outPath;
            src.renamed = converted.renamed;
            sfntBuf = converted.sfnt;
          } else {
            // Still inspect name table via in-memory unwrap
            try {
              const { decompress } = await import('wawoff2');
              sfntBuf =
                sniffed === 'woff2'
                  ? Buffer.from(await decompress(res.buffer))
                  : res.buffer;
            } catch {
              /* ignore */
            }
          }
        } else {
          sfntBuf = res.buffer;
        }

        if (sfntBuf) {
          const meta = readNameTable(sfntBuf);
          font.nameTable = meta.nameTable;
          font.nameScrubbed = meta.nameScrubbed;
          font.glyphCount = meta.glyphCount;
          font.cmapCount = meta.cmapCount;
        }
      } catch (err) {
        src.error = err.message;
        warnings.push(`${src.url}: ${err.message}`);
      }
    }
  }

  // If not downloading, still report discovery-only results cleanly
  return {
    url: finalPageUrl,
    fonts: fonts.map(serializeFont),
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

function preferWoff2First(sources) {
  return [...sources].sort((a, b) => {
    if (a.format === 'woff2' && b.format !== 'woff2') return -1;
    if (b.format === 'woff2' && a.format !== 'woff2') return 1;
    return 0;
  });
}

function dedupeFonts(fonts) {
  const out = [];
  const seen = new Set();
  for (const font of fonts) {
    const key =
      font.pageIdentity?.label ||
      font.sources
        .map((s) => {
          try {
            return new URL(s.url).pathname.replace(/\.(woff2?|ttf|otf)$/i, '');
          } catch {
            return s.url;
          }
        })
        .sort()
        .join('|');
    if (seen.has(key)) {
      const existing = out.find((f) => {
        const k =
          f.pageIdentity?.label ||
          f.sources
            .map((s) => {
              try {
                return new URL(s.url).pathname.replace(/\.(woff2?|ttf|otf)$/i, '');
              } catch {
                return s.url;
              }
            })
            .sort()
            .join('|');
        return k === key;
      });
      if (existing) {
        for (const s of font.sources) {
          if (!existing.sources.some((e) => e.url === s.url)) existing.sources.push(s);
        }
        existing.pageIdentity = existing.pageIdentity || font.pageIdentity;
        existing.cssFamily = existing.cssFamily || font.cssFamily;
      }
      continue;
    }
    seen.add(key);
    out.push(font);
  }
  return out;
}

function serializeFont(font) {
  return {
    pageIdentity: font.pageIdentity || null,
    cssFamily: font.cssFamily || null,
    cssWeight: font.cssWeight || null,
    cssStyle: font.cssStyle || null,
    nameTable: font.nameTable || null,
    nameScrubbed: !!font.nameScrubbed,
    glyphCount: font.glyphCount ?? null,
    cmapCount: font.cmapCount ?? null,
    origins: font.origins || [],
    sources: font.sources.map((s) => ({
      url: s.url,
      format: s.format,
      sniffedFormat: s.sniffedFormat || null,
      downloadedPath: s.downloadedPath || null,
      convertedPath: s.convertedPath || null,
      renamed: !!s.renamed,
      error: s.error || null,
    })),
  };
}
