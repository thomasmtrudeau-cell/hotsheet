import { SearchResult, LEVEL_LABELS } from './types';
import { getTeamLookup } from './mlb-api';

// Full-roster fuzzy search index. The MLB people/search endpoint needs a
// near-exact name; this instead pulls EVERY rostered player at each level
// once, then matches typo-tolerantly (prefixes + edit distance) in memory.

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const INDEX_SPORT_IDS = [1, 11, 12, 13, 14, 16]; // 16 = Rookie/Complex (ACL, FCL, DSL)
const INDEX_TTL = 12 * 60 * 60 * 1000;

interface IndexedPlayer {
  result: SearchResult;
  tokens: string[]; // normalized name parts, e.g. ["ronald", "acuna", "jr"]
  joined: string;   // tokens concatenated, for run-together queries ("delacruz")
}

let indexCache: { players: IndexedPlayer[]; expires: number } | null = null;
let indexPromise: Promise<IndexedPlayer[]> | null = null;

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[.'’-]/g, '')     // O'Neil -> oneil, De La Cruz keeps spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// Bounded Damerau-Levenshtein: returns distance, or maxDist+1 once it can't
// stay within maxDist (early exit keeps the index scan fast).
export function editDistance(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const prev2: number[] = new Array(b.length + 1);
  let prev: number[] = new Array(b.length + 1);
  let curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      // transposition (Damerau)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        curr[j] = Math.min(curr[j], prev2[j - 2] + 1);
      }
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function typoBudget(len: number): number {
  if (len <= 2) return 0;
  if (len <= 5) return 1;
  return 2;
}

interface ApiPerson {
  id: number;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  useName?: string;
  nameSuffix?: string;
  primaryPosition?: { abbreviation?: string };
  currentTeam?: { id?: number; name?: string };
  active?: boolean;
}

async function buildIndex(): Promise<IndexedPlayer[]> {
  const season = new Date().getFullYear();
  const fields =
    'people,id,fullName,firstName,lastName,useName,nameSuffix,primaryPosition,abbreviation,currentTeam,name,active';
  const [teamMap, ...levels] = await Promise.all([
    getTeamLookup(),
    ...INDEX_SPORT_IDS.map((sportId) =>
      fetch(`${MLB_API}/sports/${sportId}/players?season=${season}&fields=${fields}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
        .then((r) => (r.ok ? r.json() : { people: [] }))
        .then((d: { people?: ApiPerson[] }) => ({ sportId, people: d.people ?? [] }))
        .catch(() => ({ sportId, people: [] as ApiPerson[] }))
    ),
  ]);

  const seen = new Set<number>();
  const players: IndexedPlayer[] = [];
  // MLB first so a player listed at two levels indexes at the higher one.
  for (const { sportId, people } of levels) {
    for (const p of people) {
      if (!p.id || seen.has(p.id) || p.active === false) continue;
      const teamId = p.currentTeam?.id;
      if (!teamId) continue;
      seen.add(p.id);
      const teamInfo = teamMap.get(teamId);
      const displayFirst = p.useName || p.firstName || '';
      const displayName = p.fullName || `${displayFirst} ${p.lastName ?? ''}`.trim();
      const tokens = Array.from(
        new Set(
          normalizeName(
            `${p.firstName ?? ''} ${p.useName ?? ''} ${p.lastName ?? ''} ${p.nameSuffix ?? ''}`
          )
            .split(' ')
            .filter(Boolean)
        )
      );
      if (tokens.length === 0) continue;
      players.push({
        tokens,
        joined: tokens.join(''),
        result: {
          id: p.id,
          fullName: displayName,
          primaryPosition: p.primaryPosition?.abbreviation || 'Unknown',
          currentTeam: { id: teamId, name: p.currentTeam?.name || teamInfo?.teamName || '' },
          sportId,
          level: LEVEL_LABELS[sportId] || 'Unknown',
          parentOrg: teamInfo?.parentOrgName,
          parentOrgAbbrev: teamInfo?.parentOrgAbbrev,
        },
      });
    }
  }
  return players;
}

async function getIndex(): Promise<IndexedPlayer[]> {
  const now = Date.now();
  if (indexCache && indexCache.expires > now) return indexCache.players;
  // Coalesce concurrent builds (the fetch takes a few seconds cold).
  if (!indexPromise) {
    indexPromise = buildIndex()
      .then((players) => {
        if (players.length > 0) indexCache = { players, expires: Date.now() + INDEX_TTL };
        return players;
      })
      .finally(() => {
        indexPromise = null;
      });
  }
  return indexPromise;
}

// Score one query token against a player. 0 = no match.
function tokenScore(qt: string, player: IndexedPlayer): number {
  let best = 0;
  const budget = typoBudget(qt.length);
  for (let i = 0; i < player.tokens.length; i++) {
    const nt = player.tokens[i];
    // Last-name-ish tokens (anything after the first) get a small boost —
    // "acuna" should rank Ronald Acuña above someone first-named Acuna.
    const posBoost = i > 0 ? 0.25 : 0;
    let s = 0;
    if (nt === qt) s = 3;
    else if (nt.startsWith(qt)) s = 2.2 + Math.min(qt.length / nt.length, 0.7);
    else if (budget > 0) {
      const d = editDistance(qt, nt, budget);
      if (d <= budget) s = 2 - d * 0.6;
      else if (qt.length >= 5) {
        // typo'd prefix of a longer name ("verlan" -> "verlander")
        const prefix = nt.slice(0, qt.length);
        const pd = editDistance(qt, prefix, budget);
        if (pd <= budget) s = 1.6 - pd * 0.5;
      }
    }
    if (s > 0) s += posBoost;
    if (s > best) best = s;
  }
  // Run-together queries: "delacruz" matches joined "ellydelacruz".
  if (best === 0 && qt.length >= 5 && player.joined.includes(qt)) best = 2;
  return best;
}

export async function fuzzySearchPlayers(query: string, limit = 20): Promise<SearchResult[]> {
  const qTokens = normalizeName(query).split(' ').filter(Boolean);
  if (qTokens.length === 0) return [];
  const index = await getIndex();

  const scored: Array<{ score: number; p: IndexedPlayer }> = [];
  for (const p of index) {
    let total = 0;
    let matchedAll = true;
    for (const qt of qTokens) {
      const s = tokenScore(qt, p);
      if (s === 0) {
        matchedAll = false;
        break;
      }
      total += s;
    }
    if (matchedAll) scored.push({ score: total, p });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Ties: majors first, then alphabetical for stability.
    if (a.p.result.sportId !== b.p.result.sportId) return a.p.result.sportId - b.p.result.sportId;
    return a.p.result.fullName.localeCompare(b.p.result.fullName);
  });

  return scored.slice(0, limit).map((s) => s.p.result);
}
