import fs from 'node:fs/promises';
import path from 'node:path';
import { decompress as decompressWoff2 } from 'wawoff2';
import { Font } from 'fonteditor-core';
import { sniffFontFormat } from './fetch.js';
import { looksNameScrubbed } from './extract.js';

/**
 * Unwrap woff2/woff to sfnt, rename name table from page identity, write .otf.
 */
export async function convertToOtf(inputBuffer, outPath, identity = null) {
  const kind = sniffFontFormat(inputBuffer);
  let sfnt;

  if (kind === 'woff2') {
    sfnt = Buffer.from(await decompressWoff2(inputBuffer));
  } else if (kind === 'woff') {
    const font = Font.create(inputBuffer, { type: 'woff', hinting: true });
    sfnt = Buffer.from(font.write({ type: 'ttf', toBuffer: true }));
  } else if (kind === 'ttf' || kind === 'otf') {
    sfnt = inputBuffer;
  } else {
    throw new Error(`Cannot convert; sniffed format=${kind || 'unknown'}`);
  }

  if (identity) {
    sfnt = renameFontSfnt(sfnt, identity);
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, sfnt);
  return { outPath, sfnt, sourceFormat: kind, renamed: Boolean(identity) };
}

/**
 * Rewrite OpenType name IDs so the OS font picker shows the real family/style.
 */
export function renameFontSfnt(sfntBuffer, identity) {
  const names = buildInstallNames(identity);
  if (!names) return sfntBuffer;

  const font = Font.create(sfntBuffer, { type: 'ttf', hinting: true });
  font.data.name = {
    ...font.data.name,
    fontFamily: names.fontFamily,
    fontSubFamily: names.fontSubFamily,
    fullName: names.fullName,
    postScriptName: names.postScriptName,
    uniqueSubFamily: names.uniqueSubFamily,
    preferredFamily: names.preferredFamily,
    preferredSubFamily: names.preferredSubFamily,
  };

  // Keep OS/2 usWeightClass / fsSelection roughly in sync with style when possible
  if (font.data['OS/2']) {
    const os2 = font.data['OS/2'];
    if (names.weightClass) os2.usWeightClass = names.weightClass;
    // bit 0 = italic, bit 5 = bold
    let fs = os2.fsSelection ?? 0;
    if (names.isItalic) fs |= 1;
    else fs &= ~1;
    if (names.isBold) fs |= 32;
    else fs &= ~32;
    // bit 6 = regular
    if (!names.isItalic && !names.isBold && names.fontSubFamily === 'Regular') fs |= 64;
    else fs &= ~64;
    os2.fsSelection = fs;
  }

  if (font.data.head) {
    let mac = font.data.head.macStyle ?? 0;
    if (names.isBold) mac |= 1;
    else mac &= ~1;
    if (names.isItalic) mac |= 2;
    else mac &= ~2;
    font.data.head.macStyle = mac;
  }

  return Buffer.from(font.write({ type: 'ttf', toBuffer: true }));
}

/**
 * Build Windows-friendly name table fields from page identity.
 * Non-RIBBI styles use "Family StyleWord(s)" + Regular/Italic so they install as separate faces.
 */
export function buildInstallNames(identity) {
  const family =
    identity.familyName ||
    identity.cssFamily ||
    identity.preferredFamily ||
    null;
  let style = (identity.styleName || identity.preferredSubFamily || '').trim();

  if (!family && identity.label) {
    return buildInstallNames(splitLabel(identity.label));
  }
  if (!family) return null;

  // Drop duplicate style suffix already present in family ("Innovator Grotesk VF" + "VF")
  if (style && family.toLowerCase().endsWith(` ${style.toLowerCase()}`)) {
    style = '';
  }
  if (!style) style = 'Regular';

  const styleNorm = normalizeStyle(style);
  const { winFamily, winSubFamily, preferredFamily, preferredSubFamily } =
    toWindowsNames(family.trim(), styleNorm);

  const fullName =
    preferredSubFamily === 'Regular'
      ? preferredFamily
      : `${preferredFamily} ${preferredSubFamily}`;

  const postScriptName = toPostScriptName(preferredFamily, preferredSubFamily);
  const weightClass = guessWeightClass(preferredSubFamily);
  const isItalic = /\b(italic|oblique)\b/i.test(preferredSubFamily);
  const isBold = /\bbold\b/i.test(preferredSubFamily) && weightClass >= 700;

  return {
    fontFamily: winFamily,
    fontSubFamily: winSubFamily,
    preferredFamily,
    preferredSubFamily,
    fullName,
    postScriptName,
    uniqueSubFamily: postScriptName,
    weightClass,
    isItalic,
    isBold,
  };
}

function splitLabel(label) {
  const s = label.trim();
  const styleWords =
    /^(.*?)(?:\s+)((?:Thin|Hairline|Extra(?:\s|-)?Light|Ultra(?:\s|-)?Light|Light|Regular|Normal|Book|Roman|Medium|Semi(?:\s|-)?Bold|Demi(?:\s|-)?Bold|Bold|Extra(?:\s|-)?Bold|Ultra(?:\s|-)?Bold|Black|Heavy|VF|Variable)(?:\s+Italic)?)$/i;
  const m = s.match(styleWords);
  if (m) return { familyName: m[1].trim(), styleName: m[2].trim() };
  return { familyName: s, styleName: 'Regular' };
}

function normalizeStyle(style) {
  return style
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/extralight/i, 'Extra Light')
    .replace(/ultralight/i, 'Ultra Light')
    .replace(/semibold/i, 'Semi Bold')
    .replace(/demibold/i, 'Demi Bold')
    .replace(/extrabold/i, 'Extra Bold')
    .replace(/ultrabold/i, 'Ultra Bold')
    .trim();
}

function toWindowsNames(family, style) {
  const preferredFamily = family;
  const preferredSubFamily = style;

  // RIBBI can use classic name ID 1/2 grouping
  const ribbi = ['Regular', 'Italic', 'Bold', 'Bold Italic'];
  if (ribbi.includes(style)) {
    return {
      winFamily: family,
      winSubFamily: style,
      preferredFamily,
      preferredSubFamily,
    };
  }

  const italic = /\b(italic|oblique)\b/i.test(style);
  const styleSansItalic = style
    .replace(/\s*\b(italic|oblique)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    winFamily: styleSansItalic ? `${family} ${styleSansItalic}` : family,
    winSubFamily: italic ? 'Italic' : 'Regular',
    preferredFamily,
    preferredSubFamily,
  };
}

function toPostScriptName(family, style) {
  const fam = family.replace(/[^A-Za-z0-9]/g, '');
  const sty =
    style === 'Regular'
      ? 'Regular'
      : style.replace(/[^A-Za-z0-9]+/g, '');
  let ps = `${fam}-${sty}`;
  if (ps.length > 63) ps = ps.slice(0, 63);
  return ps || 'Font-Regular';
}

function guessWeightClass(style) {
  const s = style.toLowerCase();
  if (/\b(thin|hairline)\b/.test(s)) return 100;
  if (/\b(extra\s*light|ultra\s*light)\b/.test(s)) return 200;
  if (/\blight\b/.test(s)) return 300;
  if (/\b(medium)\b/.test(s)) return 500;
  if (/\b(semi\s*bold|demi\s*bold)\b/.test(s)) return 600;
  if (/\b(extra\s*bold|ultra\s*bold)\b/.test(s)) return 800;
  if (/\b(black|heavy)\b/.test(s)) return 900;
  if (/\bbold\b/.test(s)) return 700;
  return 400;
}

export function readNameTable(sfntBuffer) {
  try {
    let font;
    try {
      font = Font.create(sfntBuffer, { type: 'ttf', hinting: true });
    } catch {
      font = Font.create(sfntBuffer, { type: 'otf', hinting: true });
    }
    const n = font.data.name || {};
    const nameTable = {
      fontFamily: n.fontFamily || null,
      fontSubFamily: n.fontSubFamily || null,
      fullName: n.fullName || null,
      postScriptName: n.postScriptName || null,
      preferredFamily: n.preferredFamily || null,
      preferredSubFamily: n.preferredSubFamily || null,
      version: n.version || null,
      copyright: n.copyright || null,
    };
    const glyphCount = Array.isArray(font.data.glyf) ? font.data.glyf.length : null;
    const cmapCount = font.data.cmap ? Object.keys(font.data.cmap).length : null;
    return {
      nameTable,
      nameScrubbed: looksNameScrubbed(nameTable),
      glyphCount,
      cmapCount,
    };
  } catch (err) {
    return {
      nameTable: null,
      nameScrubbed: false,
      glyphCount: null,
      cmapCount: null,
      sniffError: err.message,
    };
  }
}

export function safeFilename(label, format) {
  const base = (label || 'font')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'font';
  return `${base}.${format}`;
}

export function identityFromFont(font, fileLabel) {
  const p = font.pageIdentity || {};
  return {
    familyName: p.familyName || null,
    cssFamily: p.cssFamily || font.cssFamily || null,
    styleName: p.styleName || null,
    label: p.label || fileLabel || null,
  };
}
