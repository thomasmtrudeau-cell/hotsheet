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

// Extract team abbreviation embedded in name like "Taira, Kaima(L)" -> { name: "Taira, Kaima", teamAbbr: "(L)" }
function extractEmbeddedTeam(nameField: string): { name: string; teamAbbr: string } | null {
  const match = nameField.match(/^(.+?)(\([A-Z]+\))$/);
  if (!match) return null;
  return { name: match[1].trim(), teamAbbr: match[2] };
}

function parseBattingRows(rows: string[][], league: string): NPBBatter[] {
  // Detect format: 2026+ has team embedded in name (24 cols), 2025 has separate Team column (25 cols in data)
  // Find first data row (skip header rows that contain "Rk" or "Player" or "AVG" as column headers)
  let dataStart = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (rows[i][0] && /^\d+$/.test(rows[i][0])) { dataStart = i; break; }
  }
  if (dataStart === 0 && rows.length > 1) dataStart = 1;

  const batters: NPBBatter[] = [];
  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 20) continue;
    if (!/^\d+$/.test(r[0])) continue; // Skip non-data rows

    // Detect if team is embedded in name or in separate column
    const embedded = extractEmbeddedTeam(r[1]);
    let name: string, team: string, o: number; // o = column offset
    if (embedded) {
      // 2026 format: [Rk, Name(Team), AVG, G, PA, AB, R, H, 2B, 3B, HR, TB, RBI, SB, CS, SH, SF, BB, IBB, HP, SO, GDP, SLG, OBP]
      name = embedded.name;
      team = NPB_TEAMS[embedded.teamAbbr] || embedded.teamAbbr;
      o = 2; // AVG starts at index 2
    } else {
      // 2025 format: [Rk, Name, Team, AVG, G, PA, AB, R, H, ...]
      name = r[1];
      team = NPB_TEAMS[r[2]] || r[2];
      o = 3; // AVG starts at index 3
    }

    const avg = r[o];
    const g = parseInt(r[o + 1]) || 0;
    const pa = parseInt(r[o + 2]) || 0;
    const ab = parseInt(r[o + 3]) || 0;
    const h = parseInt(r[o + 5]) || 0;
    const doubles = parseInt(r[o + 6]) || 0;
    const triples = parseInt(r[o + 7]) || 0;
    const hr = parseInt(r[o + 8]) || 0;
    const sb = parseInt(r[o + 11]) || 0;
    const bb = parseInt(r[o + 15]) || 0;
    const hbp = parseInt(r[o + 17]) || 0;
    const so = parseInt(r[o + 18]) || 0;
    const slg = r[o + 20] || '.000';
    const obp = r[o + 21] || '.000';
    const opsVal = (parseFloat(slg) + parseFloat(obp)).toFixed(3).replace(/^0\./, '.');

    batters.push({
      name, team, league, avg, g, pa, ab, h, doubles, triples, hr,
      sb, bb, hbp, so, slg, obp, ops: opsVal,
    });
  }
  return batters;
}

function parsePitchingRows(rows: string[][], league: string): NPBPitcher[] {
  // Find first data row
  let dataStart = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (rows[i][0] && /^\d+$/.test(rows[i][0])) { dataStart = i; break; }
  }
  if (dataStart === 0 && rows.length > 1) dataStart = 1;

  const pitchers: NPBPitcher[] = [];
  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 20) continue;
    if (!/^\d+$/.test(r[0])) continue;

    const embedded = extractEmbeddedTeam(r[1]);
    let name: string, team: string, o: number;
    if (embedded) {
      // 2026 format: [Rk, Name(Team), ERA, G, W, L, SV, HLD, HP, CG, SHO, NWG, PCT, BF, IP, H, HR, BB, IBB, HB, SO, WP, BK, R, ER]
      name = embedded.name;
      team = NPB_TEAMS[embedded.teamAbbr] || embedded.teamAbbr;
      o = 2; // ERA at index 2
    } else {
      // 2025 format: [Rk, Name, Team, ERA, G, W, L, SV, HLD, CG, SHO, PCT, BF, IP, (empty), H, HR, BB, IBB, HB, SO, WP, BK, R, ER]
      name = r[1];
      team = NPB_TEAMS[r[2]] || r[2];
      o = 3; // ERA at index 3
    }

    const era = r[o];
    const g = parseInt(r[o + 1]) || 0;
    const w = parseInt(r[o + 2]) || 0;
    const l = parseInt(r[o + 3]) || 0;
    const sv = parseInt(r[o + 4]) || 0;
    const hld = parseInt(r[o + 5]) || 0;

    // IP column position differs: 2026 has extra cols (HP, NWG) but no empty col after IP
    // 2026: ERA+12 = IP at o+12, H at o+13
    // 2025: ERA+10 = IP at o+10, (empty) at o+11, H at o+12
    let ip: string, h: number, hr: number, bb: number, hbp: number, so: number, er: number;
    if (embedded) {
      // 2026: [ERA, G, W, L, SV, HLD, HP, CG, SHO, NWG, PCT, BF, IP, H, HR, BB, IBB, HB, SO, WP, BK, R, ER]
      ip = r[o + 12];
      h = parseInt(r[o + 13]) || 0;
      hr = parseInt(r[o + 14]) || 0;
      bb = parseInt(r[o + 15]) || 0;
      hbp = parseInt(r[o + 17]) || 0;
      so = parseInt(r[o + 18]) || 0;
      er = parseInt(r[o + 22]) || 0;
    } else {
      // 2025: [ERA, G, W, L, SV, HLD, CG, SHO, PCT, BF, IP, (empty), H, HR, BB, IBB, HB, SO, WP, BK, R, ER]
      ip = r[o + 10];
      h = parseInt(r[o + 12]) || 0;
      hr = parseInt(r[o + 13]) || 0;
      bb = parseInt(r[o + 14]) || 0;
      hbp = parseInt(r[o + 16]) || 0;
      so = parseInt(r[o + 17]) || 0;
      er = parseInt(r[o + 21]) || 0;
    }

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
