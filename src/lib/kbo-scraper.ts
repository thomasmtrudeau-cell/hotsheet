// KBO Stats Scraper — fetches from koreabaseball.com

const KBO_BASE = 'https://www.koreabaseball.com/Record/Player';

// KBO team abbreviations to English names
const KBO_TEAMS: Record<string, string> = {
  'LG': 'LG Twins',
  'KT': 'KT Wiz',
  '삼성': 'Samsung Lions',
  'SSG': 'SSG Landers',
  '두산': 'Doosan Bears',
  'NC': 'NC Dinos',
  '한화': 'Hanwha Eagles',
  '키움': 'Kiwoom Heroes',
  '롯데': 'Lotte Giants',
  'KIA': 'KIA Tigers',
};

interface KBOBatter {
  name: string;
  nameKr: string;
  team: string;
  teamKr: string;
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

interface KBOPitcher {
  name: string;
  nameKr: string;
  team: string;
  teamKr: string;
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

function parseHTMLTable(html: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let inTd = false;
  let cellContent = '';

  const tagRegex = /<\/?([a-zA-Z]+)[^>]*>/g;
  let lastIndex = 0;
  let match;
  let inDataTable = false;

  while ((match = tagRegex.exec(html)) !== null) {
    const isClose = match[0][1] === '/';
    const tag = match[1].toLowerCase();

    if (!isClose && tag === 'table' && match[0].includes('tData')) {
      inDataTable = true;
    }

    if (inTd) {
      cellContent += html.substring(lastIndex, match.index).replace(/&[a-z]+;/g, '').trim();
    }

    if (!isClose && (tag === 'td' || tag === 'th') && inDataTable) {
      inTd = true;
      cellContent = '';
    } else if (isClose && (tag === 'td' || tag === 'th')) {
      if (inTd) {
        currentRow.push(cellContent.trim());
        inTd = false;
      }
    } else if (isClose && tag === 'tr') {
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
    } else if (isClose && tag === 'table') {
      inDataTable = false;
    }

    lastIndex = match.index + match[0].length;
  }

  return rows;
}

async function fetchKBO(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`KBO fetch failed: ${res.status}`);
  return res.text();
}

// Extract ASP.NET hidden fields from HTML
function extractFormFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  // Match hidden inputs: name="..." value="..."
  const regex = /name="([^"]*)"[^>]*value="([^"]*)"/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    fields[m[1]] = m[2];
  }
  // Also try id-based hidden inputs (ASP.NET sometimes uses id before value)
  const regex2 = /id="(__[^"]*)"[^>]*value="([^"]*)"/g;
  while ((m = regex2.exec(html)) !== null) {
    if (!fields[m[1]]) fields[m[1]] = m[2];
  }
  return fields;
}

// Extract selected value from a select dropdown by name
function extractSelectValue(html: string, name: string): string {
  const selectRegex = new RegExp(`name="${name.replace(/\$/g, '\\$')}"[^>]*>([\\s\\S]*?)</select>`);
  const selectMatch = html.match(selectRegex);
  if (!selectMatch) return '';
  const selected = selectMatch[1].match(/selected[^>]*value="([^"]*)"/);
  if (selected) return selected[1];
  const first = selectMatch[1].match(/value="([^"]*)"/);
  return first?.[1] || '';
}

// Fetch all pages of a KBO stats table using ASP.NET postback
async function fetchAllKBOPages(baseUrl: string): Promise<string[]> {
  // Page 1: simple GET
  const page1Res = await fetch(baseUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!page1Res.ok) throw new Error(`KBO fetch failed: ${page1Res.status}`);

  const cookies = (page1Res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const page1Html = await page1Res.text();
  const pages = [page1Html];

  // Detect how many pages exist (btnNo1, btnNo2, ...)
  const pageButtons = page1Html.match(/ucPager_btnNo(\d+)/g);
  if (!pageButtons) return pages;
  const maxPage = Math.max(...[...new Set(pageButtons)].map(b => parseInt(b.replace('ucPager_btnNo', ''))));
  if (maxPage <= 1) return pages;

  // Fetch remaining pages using postback
  let currentHtml = page1Html;
  for (let pageNum = 2; pageNum <= maxPage; pageNum++) {
    try {
      const fields = extractFormFields(currentHtml);

      // Build form data with all fields
      const params = new URLSearchParams();
      params.set('__EVENTTARGET', `ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ucPager$btnNo${pageNum}`);
      params.set('__EVENTARGUMENT', '');
      for (const key of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION', '__LASTFOCUS']) {
        if (fields[key]) params.set(key, fields[key]);
      }

      // Include all hidden fields and select dropdowns
      for (const [k, v] of Object.entries(fields)) {
        if (!k.startsWith('__') && !params.has(k)) params.set(k, v);
      }

      // Add select dropdown values
      const selectNames = [
        'ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlSeason$ddlSeason',
        'ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlSeries$ddlSeries',
        'ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlTeam$ddlTeam',
        'ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlPos$ddlPos',
        'ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlSituation$ddlSituation',
        'ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlSituationDetail$ddlSituationDetail',
      ];
      for (const name of selectNames) {
        if (!params.has(name)) {
          params.set(name, extractSelectValue(currentHtml, name));
        }
      }

      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookies,
          'Referer': baseUrl,
          'Origin': 'https://www.koreabaseball.com',
        },
        body: params.toString(),
      });

      if (!res.ok) break;
      const html = await res.text();
      if (!html.includes('tData')) break; // Invalid response
      pages.push(html);
      currentHtml = html; // Use this page's state for next postback
    } catch {
      break; // Stop pagination on error
    }
  }

  return pages;
}

export async function getKBOBatters(): Promise<KBOBatter[]> {
  // Fetch all pages of Basic1 and Basic2
  const [pages1, pages2] = await Promise.all([
    fetchAllKBOPages(`${KBO_BASE}/HitterBasic/Basic1.aspx`),
    fetchAllKBOPages(`${KBO_BASE}/HitterBasic/Basic2.aspx`),
  ]);

  // Parse all pages
  const rows1: string[][] = [];
  for (const html of pages1) {
    const pageRows = parseHTMLTable(html);
    // Skip header row (index 0) for pages after the first
    rows1.push(...(rows1.length === 0 ? pageRows : pageRows.slice(1)));
  }

  const rows2: string[][] = [];
  for (const html of pages2) {
    const pageRows = parseHTMLTable(html);
    rows2.push(...(rows2.length === 0 ? pageRows : pageRows.slice(1)));
  }

  // Basic1 header: 순위, 선수명, 팀명, AVG, G, PA, AB, R, H, 2B, 3B, HR, TB, RBI, SAC, SF
  // Basic2 header: 순위, 선수명, 팀명, AVG, BB, IBB, HBP, SO, GDP, SLG, OBP, OPS, ...

  // Build lookup from Basic2 by name+team
  const basic2Map = new Map<string, string[]>();
  for (let i = 1; i < rows2.length; i++) {
    const r = rows2[i];
    if (r.length < 12) continue;
    const key = `${r[1]}-${r[2]}`;
    basic2Map.set(key, r);
  }

  const batters: KBOBatter[] = [];
  for (let i = 1; i < rows1.length; i++) {
    const r = rows1[i];
    if (r.length < 12) continue;

    const nameKr = r[1];
    const teamKr = r[2];
    const key = `${nameKr}-${teamKr}`;
    const r2 = basic2Map.get(key);

    const team = KBO_TEAMS[teamKr] || teamKr;

    batters.push({
      name: nameKr,
      nameKr,
      team,
      teamKr,
      avg: r[3],
      g: parseInt(r[4]) || 0,
      pa: parseInt(r[5]) || 0,
      ab: parseInt(r[6]) || 0,
      h: parseInt(r[8]) || 0,
      doubles: parseInt(r[9]) || 0,
      triples: parseInt(r[10]) || 0,
      hr: parseInt(r[11]) || 0,
      sb: 0, // Not in Basic1, could add from another page
      bb: r2 ? parseInt(r2[4]) || 0 : 0,
      hbp: r2 ? parseInt(r2[6]) || 0 : 0,
      so: r2 ? parseInt(r2[7]) || 0 : 0,
      slg: r2 ? r2[9] : '.000',
      obp: r2 ? r2[10] : '.000',
      ops: r2 ? r2[11] : '.000',
    });
  }

  return batters;
}

export async function getKBOPitchers(): Promise<KBOPitcher[]> {
  const pages = await fetchAllKBOPages(`${KBO_BASE}/PitcherBasic/Basic1.aspx`);

  const rows: string[][] = [];
  for (const html of pages) {
    const pageRows = parseHTMLTable(html);
    rows.push(...(rows.length === 0 ? pageRows : pageRows.slice(1)));
  }

  // Header: 순위, 선수명, 팀명, ERA, G, W, L, SV, HLD, WPCT, IP, H, HR, BB, HBP, SO, R, ER, WHIP
  const pitchers: KBOPitcher[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 19) continue;

    const nameKr = r[1];
    const teamKr = r[2];
    const team = KBO_TEAMS[teamKr] || teamKr;

    // IP might be "1 2/3" format — convert to decimal
    let ipStr = r[10];
    if (ipStr.includes('/')) {
      const parts = ipStr.split(' ');
      const whole = parseInt(parts[0]) || 0;
      const frac = parts[1] === '1/3' ? 0.1 : parts[1] === '2/3' ? 0.2 : 0;
      ipStr = (whole + frac).toFixed(1);
    }

    pitchers.push({
      name: nameKr,
      nameKr,
      team,
      teamKr,
      era: r[3],
      g: parseInt(r[4]) || 0,
      w: parseInt(r[5]) || 0,
      l: parseInt(r[6]) || 0,
      sv: parseInt(r[7]) || 0,
      hld: parseInt(r[8]) || 0,
      ip: ipStr,
      h: parseInt(r[11]) || 0,
      hr: parseInt(r[12]) || 0,
      bb: parseInt(r[13]) || 0,
      hbp: parseInt(r[14]) || 0,
      so: parseInt(r[15]) || 0,
      er: parseInt(r[17]) || 0,
      whip: r[18],
    });
  }

  return pitchers;
}

// Compute KBO league averages (OBP, SLG, OPS) from the qualified batter list.
// Used as a denominator for an OPS+ approximation: 100*(OBP/lgOBP + SLG/lgSLG - 1).
export function kboLeagueAverages(batters: KBOBatter[]): { lgOBP: number; lgSLG: number; lgOPS: number } | null {
  if (batters.length === 0) return null;
  let totOBP = 0, totSLG = 0, n = 0;
  for (const b of batters) {
    const obp = parseFloat(b.obp);
    const slg = parseFloat(b.slg);
    if (isFinite(obp) && isFinite(slg) && obp > 0 && slg > 0) {
      totOBP += obp;
      totSLG += slg;
      n++;
    }
  }
  if (n === 0) return null;
  const lgOBP = totOBP / n;
  const lgSLG = totSLG / n;
  return { lgOBP, lgSLG, lgOPS: lgOBP + lgSLG };
}

// --- Per-player lookup (covers non-qualified batters like Ahn Hyun-min) ---

const playerIdCache = new Map<string, number | null>();

async function searchKBOPlayerId(nameKr: string, teamKr?: string): Promise<number | null> {
  const cacheKey = `${nameKr}|${teamKr || ''}`;
  if (playerIdCache.has(cacheKey)) return playerIdCache.get(cacheKey)!;

  try {
    const initRes = await fetch('https://www.koreabaseball.com/Player/Search.aspx', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const initHtml = await initRes.text();
    const cookies = (initRes.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    const fields = extractFormFields(initHtml);

    const params = new URLSearchParams();
    params.set('__EVENTTARGET', '');
    params.set('__EVENTARGUMENT', '');
    for (const k of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
      if (fields[k]) params.set(k, fields[k]);
    }
    params.set('ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlTeam', teamKr === 'SSG' ? 'SK' : (teamKr || ''));
    params.set('ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlPosition', '');
    params.set('ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$txtSearchPlayerName', nameKr);
    params.set('ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$btnSearch', '검색');

    const res = await fetch('https://www.koreabaseball.com/Player/Search.aspx', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'Referer': 'https://www.koreabaseball.com/Player/Search.aspx',
      },
      body: params.toString(),
    });
    const html = await res.text();
    const match = html.match(/playerId=(\d+)/);
    const id = match ? parseInt(match[1], 10) : null;
    if (!id) {
      console.warn(`[kbo] no playerId in search response for ${nameKr} team=${teamKr || ''}; htmlLen=${html.length}`);
    }
    playerIdCache.set(cacheKey, id);
    return id;
  } catch (err) {
    console.warn(`[kbo] searchKBOPlayerId threw for ${nameKr} team=${teamKr || ''}:`, err);
    playerIdCache.set(cacheKey, null);
    return null;
  }
}

// Parse the season-stats tables from a KBO player profile page.
// The profile renders two adjacent <table class="tbl tt"> blocks for the current season.
function parseProfileBatterStats(html: string): Partial<KBOBatter> | null {
  const tables = [...html.matchAll(/<table[^>]*tbl tt[^>]*>([\s\S]*?)<\/table>/g)];
  if (tables.length < 2) return null;

  const extractRow = (tableHtml: string): string[] | null => {
    const tbody = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!tbody) return null;
    const rowMatch = tbody[1].match(/<tr>([\s\S]*?)<\/tr>/);
    if (!rowMatch) return null;
    return [...rowMatch[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1].trim());
  };

  const row1 = extractRow(tables[0][1]);
  const row2 = extractRow(tables[1][1]);
  if (!row1 || !row2) return null;

  // Table 1: 팀명, AVG, G, PA, AB, R, H, 2B, 3B, HR, TB, RBI, SB, CS, SAC, SF
  // Table 2: BB, IBB, HBP, SO, GDP, SLG, OBP, E, SB%, MH, OPS, RISP, PH-BA
  const teamKr = row1[0];
  return {
    nameKr: '',
    teamKr,
    team: KBO_TEAMS[teamKr] || teamKr,
    avg: row1[1],
    g: parseInt(row1[2]) || 0,
    pa: parseInt(row1[3]) || 0,
    ab: parseInt(row1[4]) || 0,
    h: parseInt(row1[6]) || 0,
    doubles: parseInt(row1[7]) || 0,
    triples: parseInt(row1[8]) || 0,
    hr: parseInt(row1[9]) || 0,
    sb: parseInt(row1[12]) || 0,
    bb: parseInt(row2[0]) || 0,
    hbp: parseInt(row2[2]) || 0,
    so: parseInt(row2[3]) || 0,
    slg: row2[5],
    obp: row2[6],
    ops: row2[10],
  };
}

function parseProfilePitcherStats(html: string): Partial<KBOPitcher> | null {
  const tables = [...html.matchAll(/<table[^>]*tbl tt[^>]*>([\s\S]*?)<\/table>/g)];
  if (tables.length < 2) return null;
  const extractRow = (tableHtml: string): string[] | null => {
    const tbody = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!tbody) return null;
    const rowMatch = tbody[1].match(/<tr>([\s\S]*?)<\/tr>/);
    if (!rowMatch) return null;
    return [...rowMatch[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1].trim());
  };
  const row1 = extractRow(tables[0][1]);
  const row2 = extractRow(tables[1][1]);
  if (!row1 || !row2) return null;
  // Table 1 pitcher: 팀명, ERA, G, W, L, SV, HLD, WPCT, IP, H, HR, BB, HBP, SO, R, ER
  // Table 2 pitcher: WHIP, ...
  const teamKr = row1[0];
  let ipStr = row1[8] || '0';
  if (ipStr.includes('/')) {
    const parts = ipStr.split(' ');
    const whole = parseInt(parts[0]) || 0;
    const frac = parts[1] === '1/3' ? 0.1 : parts[1] === '2/3' ? 0.2 : 0;
    ipStr = (whole + frac).toFixed(1);
  }
  return {
    nameKr: '',
    teamKr,
    team: KBO_TEAMS[teamKr] || teamKr,
    era: row1[1],
    g: parseInt(row1[2]) || 0,
    w: parseInt(row1[3]) || 0,
    l: parseInt(row1[4]) || 0,
    sv: parseInt(row1[5]) || 0,
    hld: parseInt(row1[6]) || 0,
    ip: ipStr,
    h: parseInt(row1[9]) || 0,
    hr: parseInt(row1[10]) || 0,
    bb: parseInt(row1[11]) || 0,
    hbp: parseInt(row1[12]) || 0,
    so: parseInt(row1[13]) || 0,
    er: parseInt(row1[15]) || 0,
    whip: row2[0] || '',
  };
}

export async function getKBOPlayerSeason(nameKr: string, isPitcher: boolean, teamKr?: string): Promise<KBOBatter | KBOPitcher | null> {
  const playerId = await searchKBOPlayerId(nameKr, teamKr);
  if (!playerId) return null;

  const url = isPitcher
    ? `https://www.koreabaseball.com/Record/Player/PitcherDetail/Basic.aspx?playerId=${playerId}`
    : `https://www.koreabaseball.com/Record/Player/HitterDetail/Basic.aspx?playerId=${playerId}`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
      console.warn(`[kbo] detail fetch ${res.status} for ${nameKr} id=${playerId}`);
      return null;
    }
    const html = await res.text();
    if (isPitcher) {
      const parsed = parseProfilePitcherStats(html);
      if (!parsed) {
        console.warn(`[kbo] pitcher detail parse failed for ${nameKr} id=${playerId}; htmlLen=${html.length}`);
        return null;
      }
      return { ...parsed, name: nameKr, nameKr } as KBOPitcher;
    }
    const parsed = parseProfileBatterStats(html);
    if (!parsed) {
      console.warn(`[kbo] batter detail parse failed for ${nameKr} id=${playerId}; htmlLen=${html.length}`);
      return null;
    }
    return { ...parsed, name: nameKr, nameKr } as KBOBatter;
  } catch (err) {
    console.warn(`[kbo] getKBOPlayerSeason threw for ${nameKr} id=${playerId}:`, err);
    return null;
  }
}

export type { KBOBatter, KBOPitcher };
