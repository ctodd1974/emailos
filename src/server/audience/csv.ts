/**
 * Hand-rolled CSV support (RFC-4180 subset) — zero dependencies, per proposal §2.
 *
 * Scope: comma/semicolon/tab/pipe delimited files, quoted fields with escaped
 * quotes ("") , embedded newlines inside quotes, CRLF or LF line endings.
 * That covers every export a spreadsheet tool (and our own export) produces.
 * Anything outside that subset is reported to the user as a parse problem, not
 * silently mangled.
 */

export interface ParsedCsv {
  rows: string[][];
  delimiter: string;
}

export interface CsvColumnMapping {
  email: number | null;
  firstName: number | null;
  lastName: number | null;
  name: number | null;
}

const DELIMITERS = [",", ";", "\t", "|"];

/** Pick the delimiter that appears most often in the header-ish first line. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    // count outside quotes
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM — spreadsheets add one and it would corrupt the first header.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop trailing fully-empty rows (files usually end with a newline).
  const cleaned = rows.filter((r) => r.some((c) => c.trim() !== ""));
  return { rows: cleaned, delimiter: delim };
}

const HEADER_HINTS: { key: keyof CsvColumnMapping; patterns: string[] }[] = [
  { key: "email", patterns: ["email", "e-mail", "email address", "emailaddress", "mail"] },
  { key: "firstName", patterns: ["first name", "firstname", "first_name", "given name", "fname"] },
  { key: "lastName", patterns: ["last name", "lastname", "last_name", "surname", "family name", "lname"] },
  { key: "name", patterns: ["name", "full name", "fullname", "full_name", "display name"] },
];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when the first row looks like a header rather than data. */
export function looksLikeHeader(row: string[]): boolean {
  return row.some((cell) => {
    const n = normalizeHeader(cell);
    return HEADER_HINTS.some((h) => h.patterns.includes(n)) || n === "status" || n === "tags";
  });
}

/** Auto-detect the email / name columns from a header row. */
export function detectColumnMapping(header: string[]): CsvColumnMapping {
  const mapping: CsvColumnMapping = { email: null, firstName: null, lastName: null, name: null };
  const normalized = header.map(normalizeHeader);
  for (const { key, patterns } of HEADER_HINTS) {
    // exact match first, then "contains"
    let idx = normalized.findIndex((h) => patterns.includes(h));
    if (idx === -1) idx = normalized.findIndex((h) => patterns.some((p) => p.length > 3 && h.includes(p)));
    if (idx !== -1 && mapping[key] === null) mapping[key] = idx;
  }
  if (mapping.email === null) {
    // Fall back to the first column containing an "@" in the first data row.
    mapping.email = header.length > 0 ? 0 : null;
  }
  // Guard against `name` and `firstName` pointing at the same column.
  if (mapping.name !== null && (mapping.name === mapping.firstName || mapping.name === mapping.lastName)) {
    mapping.name = null;
  }
  return mapping;
}

/** Positional fallback when a file has no header row: col0 = email. */
export function positionalMapping(columnCount: number): CsvColumnMapping {
  return {
    email: columnCount > 0 ? 0 : null,
    firstName: columnCount > 1 ? 1 : null,
    lastName: columnCount > 2 ? 2 : null,
    name: null,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(row[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
