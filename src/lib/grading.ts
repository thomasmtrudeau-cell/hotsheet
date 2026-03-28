import { DailyPlayerStats, Grade } from './types';

interface RawBattingLine {
  hits: number;
  atBats: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  stolenBases: number;
  doubles: number;
  triples: number;
  hitByPitch: number;
}

interface RawPitchingLine {
  inningsPitched: number; // numeric, e.g. 6.0
  earnedRuns: number;
  strikeouts: number;
  walksAllowed: number;
  hitsAllowed: number;
  saves: number;
  wins: number;
  losses: number;
}

// wOBA weights (approximate MLB averages)
const WOBA_WEIGHTS = {
  bb: 0.69,
  hbp: 0.72,
  single: 0.88,
  double: 1.27,
  triple: 1.62,
  hr: 2.10,
};

function calcWOBA(b: RawBattingLine): number {
  const singles = b.hits - b.doubles - b.triples - b.homeRuns;
  const numerator =
    WOBA_WEIGHTS.bb * b.walks +
    WOBA_WEIGHTS.hbp * b.hitByPitch +
    WOBA_WEIGHTS.single * singles +
    WOBA_WEIGHTS.double * b.doubles +
    WOBA_WEIGHTS.triple * b.triples +
    WOBA_WEIGHTS.hr * b.homeRuns;
  const denominator = b.atBats + b.walks + b.hitByPitch;
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export function gradeHitter(b: RawBattingLine): { grade: Grade; reason: string } {
  const pa = b.atBats + b.walks + b.hitByPitch;
  if (pa === 0) return { grade: 'routine', reason: 'Did not bat' };

  const woba = calcWOBA(b);

  // Milestone: cycle, multi-HR
  if (b.homeRuns >= 2) return { grade: 'milestone', reason: `${b.homeRuns} home runs` };
  if (b.hits >= 4 && b.doubles >= 1 && b.triples >= 1 && b.homeRuns >= 1) {
    return { grade: 'milestone', reason: 'Hit for the cycle' };
  }

  // Standout: wOBA >= 0.650 with 3+ PA, or HR + multi-hit
  if (woba >= 0.65 && pa >= 3) {
    const parts: string[] = [];
    if (b.homeRuns >= 1) parts.push(`${b.homeRuns} HR`);
    if (b.hits >= 3) parts.push(`${b.hits} hits`);
    if (b.stolenBases >= 2) parts.push(`${b.stolenBases} SB`);
    return { grade: 'standout', reason: parts.length > 0 ? parts.join(', ') : `${b.hits}-for-${b.atBats}, elite wOBA` };
  }
  if (b.homeRuns >= 1 && b.hits >= 2) {
    return { grade: 'standout', reason: `HR + ${b.hits} hits` };
  }

  // Good: wOBA >= 0.350 or reached base well
  if (woba >= 0.35 && pa >= 3) {
    return { grade: 'good', reason: `${b.hits}-for-${b.atBats}, solid day` };
  }
  if (b.hits >= 2) return { grade: 'good', reason: `${b.hits} hits` };
  if (b.stolenBases >= 2) return { grade: 'good', reason: `${b.stolenBases} stolen bases` };

  // Off day: 0-for-4+ or 3+ strikeouts
  if (b.hits === 0 && b.atBats >= 4 && b.walks === 0) {
    return { grade: 'off_day', reason: `0-for-${b.atBats}` };
  }
  if (b.strikeouts >= 3) return { grade: 'off_day', reason: `${b.strikeouts} strikeouts` };

  return { grade: 'routine', reason: `${b.hits}-for-${b.atBats}` };
}

function parseIP(ip: string | number): number {
  if (typeof ip === 'number') return ip;
  const parts = ip.split('.');
  const whole = parseInt(parts[0]) || 0;
  const thirds = parseInt(parts[1]) || 0;
  return whole + thirds / 3;
}

export function gradePitcher(p: RawPitchingLine): { grade: Grade; reason: string } {
  const ip = p.inningsPitched;
  if (ip === 0) return { grade: 'routine', reason: 'Did not pitch' };

  const isQualityStart = ip >= 6 && p.earnedRuns <= 3;
  const netK = p.strikeouts - p.walksAllowed;

  // Milestone: no-hitter, CGSO potential
  if (ip >= 9 && p.hitsAllowed === 0) return { grade: 'milestone', reason: 'No-hitter' };
  if (ip >= 9 && p.earnedRuns === 0) return { grade: 'milestone', reason: 'Shutout' };

  // Standout: QS + command OR dominant K-BB with low ER
  if (isQualityStart && netK >= 5) {
    return { grade: 'standout', reason: `QS: ${ip} IP, ${p.strikeouts} K, ${p.earnedRuns} ER` };
  }
  if (ip >= 5 && p.earnedRuns <= 1 && p.strikeouts >= 7) {
    return { grade: 'standout', reason: `Dominant: ${p.strikeouts} K, ${p.earnedRuns} ER in ${ip} IP` };
  }
  if (isQualityStart) {
    return { grade: 'standout', reason: `Quality start: ${ip} IP, ${p.earnedRuns} ER` };
  }

  // Good: 3+ net K, clean outing, decent length
  if (ip >= 5 && p.earnedRuns <= 2) {
    return { grade: 'good', reason: `${ip} IP, ${p.earnedRuns} ER` };
  }
  if (ip >= 1 && p.earnedRuns === 0) {
    return { grade: 'good', reason: `Clean outing: ${ip} IP, 0 ER` };
  }
  if (p.saves >= 1) return { grade: 'good', reason: 'Save' };

  // Off day: 5+ ER or more walks than Ks
  if (p.earnedRuns >= 5) return { grade: 'off_day', reason: `${p.earnedRuns} earned runs allowed` };
  if (p.walksAllowed > p.strikeouts && p.walksAllowed >= 3) {
    return { grade: 'off_day', reason: `Control issues: ${p.walksAllowed} BB, ${p.strikeouts} K` };
  }

  return { grade: 'routine', reason: `${ip} IP, ${p.earnedRuns} ER, ${p.strikeouts} K` };
}

export function formatBattingLine(stats: Partial<DailyPlayerStats>): string {
  const parts: string[] = [];
  if (stats.atBats !== undefined) {
    parts.push(`${stats.hits ?? 0}-for-${stats.atBats}`);
  }
  if (stats.homeRuns && stats.homeRuns > 0) parts.push(`${stats.homeRuns} HR`);
  if (stats.doubles && stats.doubles > 0) parts.push(`${stats.doubles} 2B`);
  if (stats.triples && stats.triples > 0) parts.push(`${stats.triples} 3B`);
  if (stats.walks && stats.walks > 0) parts.push(`${stats.walks} BB`);
  if (stats.strikeouts && stats.strikeouts > 0) parts.push(`${stats.strikeouts} K`);
  if (stats.stolenBases && stats.stolenBases > 0) parts.push(`${stats.stolenBases} SB`);
  if (stats.hitByPitch && stats.hitByPitch > 0) parts.push(`${stats.hitByPitch} HBP`);
  return parts.join(', ') || 'No at-bats';
}

export function formatPitchingLine(stats: Partial<DailyPlayerStats>): string {
  const parts: string[] = [];
  if (stats.inningsPitched) parts.push(`${stats.inningsPitched} IP`);
  if (stats.earnedRuns !== undefined) parts.push(`${stats.earnedRuns} ER`);
  if (stats.pitchingStrikeouts !== undefined) parts.push(`${stats.pitchingStrikeouts} K`);
  if (stats.walksAllowed !== undefined) parts.push(`${stats.walksAllowed} BB`);
  if (stats.hitsAllowed !== undefined) parts.push(`${stats.hitsAllowed} H`);
  if (stats.wins && stats.wins > 0) parts.push('W');
  if (stats.losses && stats.losses > 0) parts.push('L');
  if (stats.saves && stats.saves > 0) parts.push('SV');
  return parts.join(', ') || 'No pitching stats';
}

export { parseIP };
