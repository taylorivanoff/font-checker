#!/usr/bin/env node
/**
 * JSON stdin/stdout host for Font Checker desktop scans.
 * Request: { "op": "checkSite", "url", "download?", "convert?", "outDir?", "timeoutMs?" }
 * Response: one JSON object on stdout.
 */
import { checkSite } from '../src/checker.js';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function respond(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const raw = await readStdin();
if (!raw) {
  respond({ ok: false, error: 'Empty stdin request.' });
  process.exit(1);
}

let req;
try {
  req = JSON.parse(raw);
} catch {
  respond({ ok: false, error: 'Invalid JSON request.' });
  process.exit(1);
}

const op = String(req.op || 'checkSite');
if (op !== 'checkSite' && op !== 'scan') {
  respond({ ok: false, error: `Unknown op: ${op}` });
  process.exit(1);
}

const url = String(req.url || '').trim();
if (!url) {
  respond({ ok: false, error: 'Enter a page URL.' });
  process.exit(1);
}

try {
  const result = await checkSite(url, {
    download: !!req.download,
    convert: !!req.convert,
    outDir: req.outDir || 'font-output',
    timeoutMs: Number(req.timeoutMs) || 30_000,
  });
  respond({
    ok: true,
    url: result.url,
    checkedAt: result.checkedAt,
    warnings: result.warnings || [],
    fonts: result.fonts || [],
  });
} catch (err) {
  respond({ ok: false, error: err?.message || String(err) });
  process.exit(1);
}
