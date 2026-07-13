// MLB home-park run factors (100 = neutral). Public data — used for the card
// home-park badge and the Trade Checker's park adjustment.
export const HOME_PARK_PF: Record<string, number> = {
  'Colorado Rockies': 112, 'Boston Red Sox': 106, 'Cincinnati Reds': 105,
  'Philadelphia Phillies': 103, 'Arizona Diamondbacks': 103, 'New York Yankees': 103,
  'Chicago Cubs': 102, 'Baltimore Orioles': 101, 'Atlanta Braves': 101,
  'Washington Nationals': 101, 'Milwaukee Brewers': 101, 'Toronto Blue Jays': 101,
  'Houston Astros': 101, 'Chicago White Sox': 101, 'Texas Rangers': 100,
  'Los Angeles Angels': 100, 'Los Angeles Dodgers': 99, 'Minnesota Twins': 99,
  'Cleveland Guardians': 98, 'Kansas City Royals': 98, 'St. Louis Cardinals': 97,
  'Pittsburgh Pirates': 97, 'Detroit Tigers': 97, 'Miami Marlins': 96,
  'New York Mets': 96, 'San Diego Padres': 95, 'San Francisco Giants': 94,
  'Seattle Mariners': 93,
};

// A modest value multiplier from the home park. wRC+ is already park-adjusted,
// so this is a light touch reflecting real-life counting-stat/roto output —
// inverted for pitchers (a pitcher-friendly park helps them).
export function homeParkMultiplier(team: string, isPitcher: boolean): number {
  const pf = HOME_PARK_PF[team];
  if (pf === undefined) return 1;
  const fav = isPitcher ? 100 - pf : pf - 100; // >0 favorable for this player
  if (fav >= 10) return 1.08;
  if (fav >= 4) return 1.04;
  if (fav <= -10) return 0.92;
  if (fav <= -4) return 0.96;
  return 1;
}
