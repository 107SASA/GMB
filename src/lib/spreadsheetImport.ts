import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

/**
 * Reads an uploaded .csv / .xlsx into header-keyed rows — shared by the
 * customer CRM import and the super admin CRM import. Bounded (size + rows
 * are checked by the callers / here) and never trusts the browser MIME type.
 */

// SEC-13 / SEC-8 — bound the upload and don't trust the browser MIME type.
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_ROWS = 1000;

/** exceljs cell values can be strings, numbers, Dates, or rich objects
 *  (hyperlink / formula / richText) — flatten every shape to a trimmed string. */
export function cellToString(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text.trim();
    if ('result' in v) return cellToString(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => t?.text ?? '').join('').trim();
    if (typeof v.hyperlink === 'string') return v.hyperlink.trim();
  }
  return String(v).trim();
}

export class ImportError extends Error {}

export async function parseSpreadsheet(file: File): Promise<Record<string, any>[]> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportError('File is larger than 5 MB. Please split it into smaller files.');
  }

  const ext = file.name.split('.').pop()?.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (ext === 'csv') {
    try {
      return parse(buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
    } catch {
      throw new ImportError('Could not parse the file as CSV. Please check the format.');
    }
  }

  if (ext === 'xls') {
    // Legacy Excel 2003 (BIFF) is no longer supported — exceljs reads .xlsx
    // only, and the old `xlsx` package it replaced (Sep 2026) carried an
    // unfixed prototype-pollution / ReDoS advisory.
    throw new ImportError('Legacy .xls files are not supported. Please re-save as .xlsx or export to .csv.');
  }

  if (ext === 'xlsx') {
    // Magic bytes: a real .xlsx is a ZIP container — "PK\x03\x04".
    if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
      throw new ImportError('This does not look like a valid .xlsx file.');
    }
    const wb = new ExcelJS.Workbook();
    try {
      // exceljs accepts Buffer/ArrayBuffer/Uint8Array at runtime; the typing
      // is narrower than @types/node's Buffer generic.
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new ImportError('Could not read the spreadsheet. Please check the file and try again.');
    }
    const sheet = wb.worksheets[0];
    if (!sheet) throw new ImportError('The spreadsheet has no worksheets.');

    // First non-empty row = headers.
    const rows: Record<string, any>[] = [];
    let headers: string[] | null = null;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as any[]) ?? [];
      // exceljs row.values is 1-indexed (values[0] is undefined).
      const cells = values.slice(1).map(cellToString);
      if (!headers) {
        headers = cells.map((h, i) => (h ? h : `column_${i + 1}`));
        return;
      }
      if (cells.every((c) => c === '')) return; // skip fully-empty rows
      const obj: Record<string, any> = {};
      headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
      rows.push(obj);
    });
    return rows;
  }

  throw new ImportError('Unsupported file type. Please upload a .csv or .xlsx file.');
}

