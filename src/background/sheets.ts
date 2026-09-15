import type { SheetsData } from '../core/messages.ts';
import { deleteSheet, getProblems, getSheets, saveSheet } from '../core/storage.ts';
import {
  BUILT_IN_SHEETS,
  buildSheet,
  nextFromSheet,
  sheetEntryUrl,
  sheetProgress,
  type Sheet,
  type SheetProgress,
} from '../core/sheets.ts';

/**
 * Sheets, with their progress worked out against what is actually solved.
 *
 * The built-in list is prepended rather than stored, so a correction to it
 * reaches everybody on the next build instead of only people who had not
 * imported it yet.
 */
async function build(): Promise<SheetsData> {
  const [imported, problems] = await Promise.all([getSheets(), getProblems()]);
  const sheets: Sheet[] = [...BUILT_IN_SHEETS, ...imported];
  const progress = sheets.map((sheet) => sheetProgress(sheet, problems));

  return { sheets, progress, next: nextAcross(progress) };
}

/**
 * A few problems worth doing next, from whichever sheet is closest to done.
 *
 * One sheet at a time on purpose. Three suggestions drawn from three different
 * sheets is a list of things you are behind on; three from one sheet is an
 * afternoon's work, and finishing something is what keeps a sheet being used.
 * A sheet already finished is skipped rather than congratulated here — the
 * progress bar does that.
 */
function nextAcross(progress: SheetProgress[]): SheetsData['next'] {
  const live = progress
    .filter((sheet) => sheet.total > 0 && sheet.solved < sheet.total)
    .sort((a, b) => b.percent - a.percent);

  const leader = live[0];
  if (!leader) return [];

  return nextFromSheet(leader, 3).map((entry) => ({
    ...entry,
    sheet: leader.name,
    url: sheetEntryUrl(entry),
  }));
}

export async function getSheetsData(): Promise<SheetsData> {
  return build();
}

export async function importSheet(
  name: string,
  text: string,
): Promise<SheetsData & { added: string; read: number; skipped: number; duplicates: number }> {
  const { sheet, result } = buildSheet(name, text);
  if (result.entries.length === 0) {
    throw new Error(
      result.skipped > 0
        ? `Nothing in that looked like a problem — ${result.skipped} line(s) could not be read.`
        : 'That was empty.',
    );
  }

  await saveSheet(sheet);
  return {
    ...(await build()),
    added: sheet.id,
    read: result.entries.length,
    skipped: result.skipped,
    duplicates: result.duplicates,
  };
}

export async function removeSheet(id: string): Promise<SheetsData> {
  await deleteSheet(id);
  return build();
}
