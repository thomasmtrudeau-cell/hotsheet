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

export type { KBOBatter, KBOPitcher };
