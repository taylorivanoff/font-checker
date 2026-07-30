export function stitchNextFlight(html) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[1,\s*"((?:\\.|[^"\\])*)"\]\)/g;
  for (const m of html.matchAll(re)) {
    chunks.push(unescapeFlightString(m[1]));
  }

  if (!chunks.length) {
    return { html, flightText: '', stitched: false };
  }

  const flightText = chunks.join('');
  const augmented = `${html}\n<!-- stitched-next-flight -->\n${flightText}`;
  return { html: augmented, flightText, stitched: true, chunkCount: chunks.length };
}

function unescapeFlightString(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
