// NPB Stats Scraper — fetches from npb.jp English stats pages

const NPB_BASE = 'https://npb.jp/bis/eng';

interface NPBBatter {
  name: string;
  team: string;
  league: string; // "CL" or "PL"
  avg: string;
  g: number;
  pa: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  sb: number;
  bb: number;
  hbp: number;
  so: number;
  slg: string;
  obp: string;
  ops: string;
}

interface NPBPitcher {
  name: string;
  team: string;
  league: string;
  era: string;
  g: number;
  w: number;
  l: number;
  sv: number;
  hld: number;
  ip: string;
  h: number;
  hr: number;
  bb: number;
  hbp: number;
  so: number;
  er: number;
  whip: string;
}

// NPB team abbreviations to full names
const NPB_TEAMS: Record<string, string> = {
  '(C)': 'Hiroshima Carp',
  '(G)': 'Yomiuri Giants',
  '(D)': 'Chunichi Dragons',
  '(DB)': 'DeNA BayStars',
  '(T)': 'Hanshin Tigers',
  '(S)': 'Yakult Swallows',
  '(H)': 'SoftBank Hawks',
  '(F)': 'Nippon-Ham Fighters',
  '(B)': 'ORIX Buffaloes',
  '(E)': 'Rakuten Eagles',
  '(L)': 'Seibu Lions',
  '(M)': 'Lotte Marines',
};

function parseHTMLTable(html: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let inTd = false;
  let cellContent = '';
  let depth = 0;

  // Simple state machine parser
  const tagRegex = /<\/?([a-zA-Z]+)[^>]*>/g;
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const isClose = match[0][1] === '/';
    const tag = match[1].toLowerCase();

    if (inTd) {
      // Capture text between tags
      cellContent += html.substring(lastIndex, match.index).replace(/&[a-z]+;/g, '').trim();
    }

    if (!isClose && (tag === 'td' || tag === 'th')) {
      inTd = true;
      cellContent = '';
      depth++;
    } else if (isClose && (tag === 'td' || tag === 'th')) {
      inTd = false;
      currentRow.push(cellContent.trim());
      depth--;
    } else if (isClose && tag === 'tr') {
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
    }

    lastIndex = match.index + match[0].length;
  }

  return rows;
}

function parseBattingRows(rows: string[][], league: string): NPBBatter[] {
  // Row format: [Rk, Name, Team, AVG, G, PA, AB, R, H, 2B, 3B, HR, TB, RBI, SB, CS, SH, SF, BB, IBB, HP, SO, GDP, SLG, OBP]
  // Header is rows[1], data starts at rows[2]
  const batters: NPBBatter[] = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 25) continue;

    const name = r[1];
    const team = NPB_TEAMS[r[2]] || r[2];
    const avg = r[3];
    const g = parseInt(r[4]) || 0;
    const pa = parseInt(r[5]) || 0;
    const ab = parseInt(r[6]) || 0;
    const h = parseInt(r[8]) || 0;
    const doubles = parseInt(r[9]) || 0;
    const triples = parseInt(r[10]) || 0;
    const hr = parseInt(r[11]) || 0;
    const sb = parseInt(r[14]) || 0;
    const bb = parseInt(r[18]) || 0;
    const hbp = parseInt(r[20]) || 0;
    const so = parseInt(r[21]) || 0;
    const slg = r[23];
    const obp = r[24];
    const opsVal = (parseFloat(slg) + parseFloat(obp)).toFixed(3);

    batters.push({
      name, team, league, avg, g, pa, ab, h, doubles, triples, hr,
      sb, bb, hbp, so, slg, obp, ops: opsVal,
    });
  }
  return batters;
}

function parsePitchingRows(rows: string[][], league: string): NPBPitcher[] {
  // Row format: [Rk, Name, Team, ERA, G, W, L, SV, HLD, CG, SHO, PCT, BF, IP, (empty), H, HR, BB, IBB, HB, SO, WP, BK, R, ER]
  const pitchers: NPBPitcher[] = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 25) continue;

    const name = r[1];
    const team = NPB_TEAMS[r[2]] || r[2];
    const era = r[3];
    const g = parseInt(r[4]) || 0;
    const w = parseInt(r[5]) || 0;
    const l = parseInt(r[6]) || 0;
    const sv = parseInt(r[7]) || 0;
    const hld = parseInt(r[8]) || 0;
    const ip = r[13];
    const h = parseInt(r[15]) || 0;
    const hr = parseInt(r[16]) || 0;
    const bb = parseInt(r[17]) || 0;
    const hbp = parseInt(r[19]) || 0;
    const so = parseInt(r[20]) || 0;
    const er = parseInt(r[24]) || 0;

    // Calculate WHIP
    const ipNum = parseFloat(ip) || 0;
    const whip = ipNum > 0 ? ((bb + h) / ipNum).toFixed(2) : '0.00';

    pitchers.push({
      name, team, league, era, g, w, l, sv, hld, ip, h, hr, bb, hbp, so, er, whip,
    });
  }
  return pitchers;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HotSheet/1.0)' },
  });
  if (!res.ok) throw new Error(`NPB fetch failed: ${res.status} ${url}`);
  return res.text();
}

export async function getNPBBatters(season: number = new Date().getFullYear()): Promise<NPBBatter[]> {
  const [clHtml, plHtml] = await Promise.all([
    fetchPage(`${NPB_BASE}/${season}/stats/bat_c.html`),
    fetchPage(`${NPB_BASE}/${season}/stats/bat_p.html`),
  ]);

  const clRows = parseHTMLTable(clHtml);
  const plRows = parseHTMLTable(plHtml);

  return [
    ...parseBattingRows(clRows, 'CL'),
    ...parseBattingRows(plRows, 'PL'),
  ];
}

export async function getNPBPitchers(season: number = new Date().getFullYear()): Promise<NPBPitcher[]> {
  const [clHtml, plHtml] = await Promise.all([
    fetchPage(`${NPB_BASE}/${season}/stats/pit_c.html`),
    fetchPage(`${NPB_BASE}/${season}/stats/pit_p.html`),
  ]);

  const clRows = parseHTMLTable(clHtml);
  const plRows = parseHTMLTable(plHtml);

  return [
    ...parsePitchingRows(clRows, 'CL'),
    ...parsePitchingRows(plRows, 'PL'),
  ];
}

export type { NPBBatter, NPBPitcher };
