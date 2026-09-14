/**
 * Whether a hostname belongs to a site.
 *
 * `hostname.endsWith('leetcode.com')` is the obvious way to write this and it
 * is wrong: `notleetcode.com` ends with `leetcode.com`, and so does
 * `myleetcode.com`. A domain owns itself and its subdomains, and nothing else —
 * the dot is what makes `codeforces.com` cover `m2.codeforces.com` without
 * covering `fakecodeforces.com`.
 *
 * The manifest's own host matches are the real barrier, so nothing was reaching
 * a lookalike domain; this is about the checks being true on their own terms,
 * because the day one of them is used for something other than "should the card
 * draw here" is the day it matters.
 */
export function isHost(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  const suffix = domain.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
}

/** True when the hostname belongs to any of the given domains. */
export function isAnyHost(hostname: string, domains: readonly string[]): boolean {
  return domains.some((domain) => isHost(hostname, domain));
}
