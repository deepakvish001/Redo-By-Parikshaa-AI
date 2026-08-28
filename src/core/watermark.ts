/**
 * Which submissions on a history page are new.
 *
 * Codeforces' `/problemset/status?my=on` and AtCoder's `/submissions/me` list
 * every submission you have ever made. The adapters walked all of them and
 * treated each accepted row they had not seen *in this browser session* as a
 * fresh solve — so opening that page once committed a year of history to the
 * repository in one go.
 *
 * The fix is a high-water mark per judge: the id of the newest submission the
 * extension has already accounted for. Both judges hand out ids in increasing
 * order, so "newer than the mark" is exactly "happened since we last looked".
 */

/**
 * Orders two submission ids.
 *
 * Numeric when both sides are integers, which is the real case for every judge
 * here. The length-first fallback keeps the ordering sane for anything that is
 * not — a plain string compare would put "9" after "10".
 */
export function compareIds(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isSafeInteger(left) && Number.isSafeInteger(right)) return left - right;
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function newestId(ids: string[]): string | undefined {
  return ids.length === 0 ? undefined : ids.reduce((max, id) => (compareIds(id, max) > 0 ? id : max));
}

export interface Claim {
  /** Ids to act on now — commit, journal, count as an attempt. */
  actionable: string[];
  /** The mark to store once these have been handled. */
  next?: string;
  /**
   * True when this judge had no mark yet and its history was adopted rather
   * than pushed. The caller says so once, because silence would read as the
   * extension not working.
   */
  adopted: boolean;
}

/**
 * Decides what to act on.
 *
 * `watched` carries ids the page saw still being judged. Those are unambiguous
 * — you are looking at a verdict arriving — so they are acted on whatever the
 * mark says. That is what makes the very first submission after installing
 * work, rather than being swallowed by the same adoption that protects the
 * repository from the other four hundred rows on the page.
 */
export function claimSubmissions(
  stored: string | undefined,
  ids: string[],
  watched: ReadonlySet<string> = new Set(),
): Claim {
  const seen = [...new Set(ids)];
  const highest = newestId(stored === undefined ? seen : [...seen, stored]);

  if (stored === undefined) {
    return {
      actionable: seen.filter((id) => watched.has(id)).sort(compareIds),
      next: highest,
      adopted: seen.length > 0,
    };
  }

  return {
    actionable: seen
      .filter((id) => watched.has(id) || compareIds(id, stored) > 0)
      // Oldest first, so a batch of solves is committed in the order it happened.
      .sort(compareIds),
    next: highest,
    adopted: false,
  };
}
