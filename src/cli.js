#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { checkSite } from './checker.js';
import { parseArgs } from './args.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const result = await checkSite(args.url, {
    download: args.download,
    convert: args.convert,
    outDir: args.out,
    timeoutMs: args.timeout,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
}

function printHelp() {
  console.log(`Usage: node src/cli.js <url> [options]

Detect fonts referenced by a page (HTML @font-face, linked CSS, and
embedded webfont metadata). Optionally download and unwrap woff2 → .otf (sfnt).

Options:
  --download          Download discovered font files
  --convert           Unwrap woff2/woff to .otf (implies --download)
  --out <dir>         Output directory (default: ./font-output)
  --json              Print machine-readable JSON
  --timeout <ms>      Fetch timeout (default: 30000)
  -h, --help          Show help
`);
}

function printHuman(result) {
  console.log(`\nPage: ${result.url}`);
  console.log(`Fonts found: ${result.fonts.length}\n`);

  for (const font of result.fonts) {
    const title =
      font.pageIdentity?.label ||
      font.nameTable?.fullName ||
      font.nameTable?.fontFamily ||
      font.cssFamily ||
      '(unknown)';
    console.log(`• ${title}`);
    if (font.pageIdentity?.label) {
      console.log(`    page:  ${font.pageIdentity.label}`);
    }
    if (font.cssFamily && font.cssFamily !== title) {
      console.log(`    css:   ${font.cssFamily}`);
    }
    if (font.nameTable) {
      const family =
        font.nameTable.preferredFamily || font.nameTable.fontFamily || '?';
      const sub =
        font.nameTable.preferredSubFamily || font.nameTable.fontSubFamily || '?';
      console.log(`    file:  ${family} / ${sub}`);
      if (font.nameTable.postScriptName) {
        console.log(`    ps:    ${font.nameTable.postScriptName}`);
      }
      if (font.nameScrubbed) {
        console.log('    note:  name table still looks scrubbed');
      }
    }
    for (const src of font.sources) {
      const mark = src.downloadedPath ? '✓' : ' ';
      console.log(`    [${mark}] ${src.format.padEnd(5)} ${src.url}`);
      if (src.error) console.log(`        error: ${src.error}`);
      if (src.convertedPath) console.log(`        otf:   ${src.convertedPath}`);
    }
    console.log('');
  }

  if (result.warnings.length) {
    console.log('Warnings:');
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
  });
}
