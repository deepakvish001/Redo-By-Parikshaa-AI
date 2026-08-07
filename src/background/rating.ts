import { codeforcesRank, predictFor, type Participant, type RatingDelta } from '../core/rating.ts';

/**
 * Rating, fetched from the judges' own APIs.
 *
 * Codeforces publishes everything needed to run its rating system yourself, so
 * the prediction here is the real algorithm on real standings rather than a
 * guess. LeetCode publishes a rating but not the field, which is why only one
 * of the two can be predicted — see `leetcodeRating` for what is possible.
 */

const CF_API = 'https://codeforces.com/api';

/** Codeforces asks for no more than one request every two seconds. */
const CF_GAP_MS = 2100;
/** Handles per `user.info` call. The documented ceiling is ten thousand. */
const CHUNK = 5000;
let lastCall = 0;

async function codeforces<T>(method: string, params: Record<string, string>): Promise<T> {
  const wait = Math.max(0, lastCall + CF_GAP_MS - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();

  // POST because a contest's worth of handles does not fit in a URL.
  const response = await fetch(`${CF_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  if (!response.ok) {
    throw new Error(`Codeforces returned ${response.status} for ${method}.`);
  }

  const json = (await response.json()) as { status: string; result?: T; comment?: string };
  if (json.status !== 'OK' || json.result === undefined) {
    throw new Error(json.comment ?? `Codeforces refused the ${method} request.`);
  }
  return json.result;
}

export interface CodeforcesProfile {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank: string;
  colour: string;
  /** Most recent rated contest, as Codeforces itself recorded it. */
  last?: { contestId: number; name: string; rank: number; oldRating: number; newRating: number };
}

interface CfUser {
  handle: string;
  rating?: number;
  maxRating?: number;
}

interface CfRatingChange {
  contestId: number;
  contestName: string;
  rank: number;
  oldRating: number;
  newRating: number;
}

export async function codeforcesProfile(handle: string): Promise<CodeforcesProfile> {
  const [user] = await codeforces<CfUser[]>('user.info', { handles: handle });
  if (!user) throw new Error(`Codeforces has no user called "${handle}".`);

  let last: CodeforcesProfile['last'];
  try {
    const history = await codeforces<CfRatingChange[]>('user.rating', { handle });
    const recent = history[history.length - 1];
    if (recent) {
      last = {
        contestId: recent.contestId,
        name: recent.contestName,
        rank: recent.rank,
        oldRating: recent.oldRating,
        newRating: recent.newRating,
      };
    }
  } catch {
    // An account that has never competed has no rating history; that is not an
    // error, it just means there is nothing to show yet.
  }

  const band = codeforcesRank(user.rating ?? 0);
  return {
    handle: user.handle,
    rating: user.rating,
    maxRating: user.maxRating,
    rank: user.rating === undefined ? 'Unrated' : band.title,
    colour: band.colour,
    last,
  };
}

interface CfStandingsRow {
  party: { members: Array<{ handle: string }>; participantType: string };
  rank: number;
  points: number;
  penalty: number;
}

interface CfContest {
  id: number;
  name: string;
  phase: string;
}

/**
 * The most recent contest this handle competed in whose rating has not landed.
 *
 * "Not landed" is decided by comparing against the rating history rather than
 * by the contest's phase: a contest sits in `FINISHED` for hours before its
 * ratings are applied, and that gap is exactly the window a prediction is for.
 */
async function pendingContest(
  handle: string,
  ratedContestIds: Set<number>,
): Promise<CfContest | undefined> {
  const contests = await codeforces<CfContest[]>('contest.list', { gym: 'false' });

  // Newest first; anything still accepting submissions has no standings worth
  // predicting from.
  for (const contest of contests.slice(0, 25)) {
    if (contest.phase === 'BEFORE' || contest.phase === 'CODING') continue;
    if (ratedContestIds.has(contest.id)) continue;

    const standings = await codeforces<{ rows: CfStandingsRow[] }>('contest.standings', {
      contestId: String(contest.id),
      handles: handle,
      showUnofficial: 'false',
    });
    if (standings.rows.length > 0) return contest;
  }

  return undefined;
}

export interface Prediction {
  contestId: number;
  contestName: string;
  participants: number;
  prediction: RatingDelta;
}

/**
 * Runs Codeforces' own rating system over a finished-but-unrated contest.
 *
 * The expensive part is that the algorithm needs every participant's current
 * rating, which means one standings call plus a handful of bulk `user.info`
 * calls — several seconds, spaced out to respect the API's rate limit. That is
 * why this is behind an explicit button rather than something that runs on a
 * timer.
 */
export async function predictCodeforces(handle: string): Promise<Prediction | undefined> {
  let rated = new Set<number>();
  try {
    const history = await codeforces<CfRatingChange[]>('user.rating', { handle });
    rated = new Set(history.map((change) => change.contestId));
  } catch {
    /* never competed — every contest is a candidate */
  }

  const contest = await pendingContest(handle, rated);
  if (!contest) return undefined;

  const standings = await codeforces<{ rows: CfStandingsRow[] }>('contest.standings', {
    contestId: String(contest.id),
    showUnofficial: 'false',
  });

  // Team and virtual entries do not affect anyone's rating.
  const rows = standings.rows.filter(
    (row) => row.party.participantType === 'CONTESTANT' && row.party.members.length === 1,
  );
  const handles = rows.map((row) => row.party.members[0]!.handle);

  const ratings = new Map<string, number>();
  // The API accepts up to ten thousand handles at once and asks for one request
  // every two seconds, so the chunk size is what decides how long this takes: a
  // thirty-thousand-entrant round is six calls at this size and seventy-five at
  // 400, which is the difference between fifteen seconds and three minutes.
  for (let i = 0; i < handles.length; i += CHUNK) {
    const chunk = handles.slice(i, i + CHUNK);
    const users = await codeforces<CfUser[]>('user.info', { handles: chunk.join(';') });
    for (const user of users) ratings.set(user.handle.toLowerCase(), user.rating ?? 0);
  }

  const participants: Participant[] = rows.map((row) => ({
    handle: row.party.members[0]!.handle,
    rank: row.rank,
    points: row.points * 1_000_000 - row.penalty,
    // A participant with no rating has never been rated; Codeforces seeds them
    // from zero, and so does this.
    rating: ratings.get(row.party.members[0]!.handle.toLowerCase()) ?? 0,
  }));

  const prediction = predictFor(participants, handle);
  if (!prediction) return undefined;

  return {
    contestId: contest.id,
    contestName: contest.name,
    participants: participants.length,
    prediction,
  };
}

/* --------------------------------------------------------------- leetcode */

export interface LeetCodeProfile {
  username: string;
  rating?: number;
  attended: number;
  globalRanking?: number;
  topPercentage?: number;
  /** The most recent contest, and whether its rating has been applied yet. */
  last?: { title: string; rating: number; ranking: number; trend: string; rated: boolean };
}

const LC_QUERY = `query ranking($username: String!) {
  userContestRanking(username: $username) {
    attendedContestsCount
    rating
    globalRanking
    topPercentage
  }
  userContestRankingHistory(username: $username) {
    attended
    rating
    ranking
    trendDirection
    contest { title startTime }
  }
}`;

interface LcHistoryEntry {
  attended: boolean;
  rating: number;
  ranking: number;
  trendDirection: string;
  contest: { title: string; startTime: number };
}

export async function leetcodeProfile(username: string): Promise<LeetCodeProfile> {
  const response = await fetch('https://leetcode.com/graphql/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: LC_QUERY, variables: { username } }),
  });
  if (!response.ok) throw new Error(`LeetCode returned ${response.status}.`);

  const json = (await response.json()) as {
    data?: {
      userContestRanking?: {
        attendedContestsCount: number;
        rating: number;
        globalRanking: number;
        topPercentage: number;
      } | null;
      userContestRankingHistory?: LcHistoryEntry[] | null;
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? 'LeetCode refused.');

  const ranking = json.data?.userContestRanking;
  const history = (json.data?.userContestRankingHistory ?? []).filter((entry) => entry.attended);
  const recent = history[history.length - 1];
  const previous = history[history.length - 2];

  return {
    username,
    rating: ranking?.rating,
    attended: ranking?.attendedContestsCount ?? history.length,
    globalRanking: ranking?.globalRanking,
    topPercentage: ranking?.topPercentage,
    last: recent
      ? {
          title: recent.contest.title,
          rating: recent.rating,
          ranking: recent.ranking,
          trend: recent.trendDirection,
          // LeetCode publishes the entry as soon as the contest ends but only
          // moves the rating a day or so later, so an unchanged rating on the
          // newest entry means it is still pending.
          rated: previous === undefined || recent.rating !== previous.rating,
        }
      : undefined,
  };
}
