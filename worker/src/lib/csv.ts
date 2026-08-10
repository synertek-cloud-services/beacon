// Minimal RFC 4180 CSV writer -- no dependency needed for this (Cloudflare
// Workers has no filesystem/Node APIs, so this stays plain-string-building
// rather than reaching for a library built around streams/buffers). Only
// used for Reports' CSV export today; if a second consumer shows up, this
// is already factored out for reuse rather than duplicated.
function escapeCsvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  // CRLF is CSV's own documented line ending (RFC 4180) -- Excel in
  // particular is fussier about this than a bare \n.
  return lines.join('\r\n') + '\r\n';
}
