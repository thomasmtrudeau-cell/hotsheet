'use client';

import { useState } from 'react';
import { DailyPlayerStats, SeasonPlayerStats, LeagueAverages, LEVEL_LABELS, isMLBSystem, Group, RecentForm, Matchup, PremiumMetrics, OopsyHitter, OopsyPitcher } from '@/lib/types';
import { HOME_PARK_PF } from '@/lib/parks';

type OopsySnapshot = { hitter?: OopsyHitter; pitcher?: OopsyPitcher };

// Weekly OOPSY projection line, shown in the expanded area (premium).
function OopsyRow({ o }: { o: OopsySnapshot }) {
  const p = o.pitcher, h = o.hitter;
  return (
    <div className="mt-2 text-[11px] text-indigo-300/90">
      <span className="text-zinc-500 uppercase tracking-wider text-[10px]">OOPSY this week</span>{' '}
      {p ? (
        <span>#{p.rank} SP · {p.era.toFixed(2)} proj ERA{p.day ? ` · ${p.day} vs ${p.opponent}` : ''}</span>
      ) : h ? (
        <span>#{h.rank} · {h.fantasyZ !== undefined ? `${h.fantasyZ.toFixed(2)} fantasy` : ''}{h.wrcPlus !== undefined ? ` · ${h.wrcPlus.toFixed(2)} wRC+` : ''}</span>
      ) : null}
    </div>
  );
}
import GradeBadge from './GradeBadge';
import GroupTag from './GroupTag';
import GameLog from './GameLog';
import LevelBreakdown from './LevelBreakdown';

// Chevron toggle for expanding a card's recent game log (MLB/MiLB only).
function LogToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors cursor-pointer ${
        open ? 'bg-blue-500/15 text-blue-400' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/40'
      }`}
      title="Recent games + last-15 form"
    >
      Games
      <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

// Optional per-card group-assignment controls (omitted in pre-auth states).
interface GroupControl {
  groups: Group[];
  memberOf: string[];
  onAssignGroups: (playerId: number, groupIds: string[]) => void;
}

interface DailyCardProps {
  type: 'daily';
  stats: DailyPlayerStats;
  onUnfollow: (playerId: number) => void;
  leagueAvg?: LeagueAverages;
  groupControl?: GroupControl;
  premium?: PremiumMetrics; // WAR + peak wRC+ / ERA-20TBF (premium only)
  oopsy?: OopsySnapshot;    // weekly OOPSY projection (premium only)
}

interface SeasonCardProps {
  type: 'season';
  stats: SeasonPlayerStats;
  onUnfollow: (playerId: number) => void;
  leagueAvg?: LeagueAverages;
  groupControl?: GroupControl;
  premium?: PremiumMetrics; // WAR + peak wRC+ / ERA-20TBF (premium only)
  oopsy?: OopsySnapshot;    // weekly OOPSY projection (premium only)
}

type PlayerCardProps = DailyCardProps | SeasonCardProps;

// A rehab assignment is a specific MLB roster status ("RA"): an IL player
// (usually from the majors) temporarily playing for a minor-league affiliate.
// This is distinct from a minor-leaguer who is simply on the minor-league IL —
// so we rely on the roster-derived flag, NOT "injured + has a game today".
function isOnRehab(stats: DailyPlayerStats): boolean {
  return Boolean(stats.onRehab);
}

// Subtle level tint on the card border so MLB vs MiLB (vs NPB/KBO) reads at a glance.
function levelBorderClass(sportId: number): string {
  if (sportId === 1) return 'border-blue-500/25 hover:border-blue-500/40';
  if ((sportId >= 11 && sportId <= 14) || sportId === 16) return 'border-amber-500/25 hover:border-amber-500/40';
  if (sportId === 100) return 'border-rose-500/25 hover:border-rose-500/40';
  if (sportId === 101) return 'border-purple-500/25 hover:border-purple-500/40';
  return 'border-zinc-700/50 hover:border-zinc-600/50';
}

function CallUpBadge({ date }: { date: string }) {
  const label = (() => {
    const [, m, d] = date.split('-');
    return m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}` : date;
  })();
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-300"
      title={`Recently called up (${label})`}
    >
      CALL-UP
    </span>
  );
}

function PromotedBadge({ date }: { date: string }) {
  const [, m, d] = date.split('-');
  const label = m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}` : date;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300"
      title={`Recently promoted a level (${label})`}
    >
      PROMOTED
    </span>
  );
}

// Premium metric chips (peak WAR + the role-appropriate second metric). Shown
// ONLY to premium accounts with the Premium toggle on — never teased to regular
// users on cards. Pitchers show ERA/20 TBF; everyone else shows peak wRC+.
function PremiumBadges({ metrics, isPitcher }: { metrics: PremiumMetrics; isPitcher: boolean }) {
  const chip = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300';
  return (
    <>
      {metrics.war !== undefined && (
        <span className={chip} title="Peak WAR (ScoutTheStatline)">{metrics.war.toFixed(1)} WAR</span>
      )}
      {!isPitcher && metrics.peakWrcPlus !== undefined && (
        <span className={chip} title="Peak wRC+ (ScoutTheStatline)">{metrics.peakWrcPlus} wRC+</span>
      )}
      {isPitcher && metrics.era20 !== undefined && (
        <span className={chip} title="ERA per 20 TBF/game (ScoutTheStatline)">{metrics.era20.toFixed(2)} ERA/20</span>
      )}
      {!isPitcher && metrics.speed && (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${metrics.speed === 'double-plus' ? 'bg-sky-500/30 text-sky-200' : 'bg-sky-500/20 text-sky-300'}`} title={`${metrics.speed === 'double-plus' ? 'Double-plus' : 'Plus'} projected speed (ScoutTheStatline)`}>
          ⚡ Speed{metrics.speed === 'double-plus' ? '++' : '+'}
        </span>
      )}
      {!isPitcher && metrics.power && (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${metrics.power === 'double-plus' ? 'bg-rose-500/30 text-rose-200' : 'bg-rose-500/20 text-rose-300'}`} title={`${metrics.power === 'double-plus' ? 'Double-plus' : 'Plus'} projected power (ScoutTheStatline)`}>
          💪 Power{metrics.power === 'double-plus' ? '++' : '+'}
        </span>
      )}
      {/* Dual-threat only when it isn't already obvious from both tool tags. */}
      {!isPitcher && metrics.dual && !(metrics.speed && metrics.power) && (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${metrics.dual === 'double-plus' ? 'bg-amber-500/30 text-amber-100' : 'bg-amber-500/20 text-amber-200'}`} title="Combined power + speed (projected HR + SB)">
          ⚡💪 {metrics.dual === 'double-plus' ? '40+' : '30+'}
        </span>
      )}
      {!isPitcher && metrics.def && (
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
            metrics.def === 'double-plus' ? 'bg-green-500/30 text-green-200'
              : metrics.def === 'plus' ? 'bg-green-500/15 text-green-300'
              : metrics.def === 'double-minus' ? 'bg-red-500/30 text-red-200'
              : 'bg-red-500/15 text-red-300'
          }`}
          title={`Projected defense: ${{ 'double-plus': 'well above average', plus: 'above average', minus: 'below average', 'double-minus': 'well below average' }[metrics.def]}`}
        >
          🧤 D{metrics.def === 'double-plus' ? '++' : metrics.def === 'plus' ? '+' : metrics.def === 'double-minus' ? '−−' : '−'}
        </span>
      )}
    </>
  );
}

function TwoStartBadge({ dates }: { dates: string[] }) {
  // "2026-07-06" -> "7/6"
  const fmt = (d: string) => {
    const [, m, day] = d.split('-');
    return `${parseInt(m, 10)}/${parseInt(day, 10)}`;
  };
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300"
      title={`Two starts next week: ${dates.map(fmt).join(' & ')}`}
    >
      2-START NEXT WK
    </span>
  );
}

function homeParkBadge(team: string, sportId: number, isPitcher: boolean): { label: string; cls: string; title: string } | null {
  if (sportId !== 1) return null;
  const pf = HOME_PARK_PF[team];
  if (pf === undefined) return null;
  const fav = isPitcher ? 100 - pf : pf - 100; // >0 = favorable for this player
  if (Math.abs(fav) < 4) return null;           // ~neutral (97–103): hide
  const strong = Math.abs(fav) >= 10;           // Coors-type extreme
  const up = fav > 0;
  const arrows = up ? (strong ? '↑↑' : '↑') : (strong ? '↓↓' : '↓');
  const cls = up
    ? (strong ? 'bg-green-500/30 text-green-200' : 'bg-green-500/15 text-green-300')
    : (strong ? 'bg-red-500/30 text-red-200' : 'bg-red-500/15 text-red-300');
  return {
    label: `Park ${arrows}`,
    cls,
    title: `Home park factor ${pf} — ${up ? 'favors' : 'works against'} this ${isPitcher ? 'pitcher' : 'hitter'}`,
  };
}

function RehabBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
      REHAB
    </span>
  );
}

function ILBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400">
      {label}
    </span>
  );
}

function LevelBadge({ sportId }: { sportId: number }) {
  let colorClass = 'bg-amber-500/20 text-amber-400'; // MiLB default
  if (sportId === 1) colorClass = 'bg-blue-500/20 text-blue-400'; // MLB
  else if (sportId === 100) colorClass = 'bg-red-500/20 text-red-400'; // NPB
  else if (sportId === 101) colorClass = 'bg-purple-500/20 text-purple-400'; // KBO

  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${colorClass}`}>
      {LEVEL_LABELS[sportId] || '?'}
    </span>
  );
}

function GameStatusDot({ status }: { status: DailyPlayerStats['gameStatus'] }) {
  const colors: Record<string, string> = {
    Live: 'bg-green-500 animate-pulse',
    Final: 'bg-zinc-500',
    Scheduled: 'bg-blue-500',
    'No Game': 'bg-zinc-700',
    Postponed: 'bg-yellow-500',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || 'bg-zinc-700'}`} />;
}

function LineupBadge({ status, startingPosition, battingOrder }: {
  status: 'starting' | 'not_starting' | 'probable_pitcher' | 'tbd';
  startingPosition?: string;
  battingOrder?: number;
}) {
  if (status === 'starting' || status === 'probable_pitcher') {
    let label = status === 'probable_pitcher' ? 'SP' : 'STARTING';
    if (status === 'starting' && startingPosition && battingOrder) {
      label = `${startingPosition} / ${battingOrder}`;
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400">
        {label}
      </span>
    );
  }
  if (status === 'tbd') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-700/50 text-zinc-400">
        LINEUP TBD
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-600/30 text-zinc-500">
      NOT STARTING
    </span>
  );
}

function TeamLine({ team, sportId, parentOrgAbbrev }: { team: string; sportId: number; parentOrgAbbrev?: string }) {
  if (sportId === 1 || !parentOrgAbbrev) return <>{team}</>;
  return <>{team} <span className="text-zinc-600">({parentOrgAbbrev})</span></>;
}

function stripParen(name: string): string {
  const i = name.indexOf(' (');
  return i >= 0 ? name.slice(0, i) : name;
}

function XSearchLink({ playerName }: { playerName: string }) {
  const url = `https://x.com/search?q=%22${encodeURIComponent(playerName)}%22&f=live`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zinc-600 hover:text-zinc-400 transition-colors p-1"
      title="Search on X"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </a>
  );
}

function FGSearchLink({ playerName }: { playerName: string }) {
  const url = `https://www.fangraphs.com/search?q=${encodeURIComponent(stripParen(playerName))}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zinc-600 hover:text-emerald-400 transition-colors px-1 py-1 text-[10px] font-bold tracking-wider"
      title="Search on FanGraphs"
    >
      FG
    </a>
  );
}

function LeagueContext({ leagueAvg, isPitcher }: { leagueAvg: LeagueAverages; isPitcher: boolean }) {
  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/30 flex items-center gap-3 text-[10px] text-zinc-600">
      <span className="font-semibold text-zinc-500">{leagueAvg.level} avg</span>
      <span>Age {leagueAvg.avgAge}</span>
      {isPitcher ? (
        <span>ERA {leagueAvg.lgERA}</span>
      ) : (
        <>
          <span>OPS {leagueAvg.lgOPS}</span>
        </>
      )}
    </div>
  );
}

// Rolling last-15-day line; green when hot, red when cold, numbers stay primary.
function RecentFormRow({ form }: { form: RecentForm }) {
  if (!form.gamesPlayed) return null;
  const color = form.trend === 'hot' ? 'text-emerald-400' : form.trend === 'cold' ? 'text-red-400' : 'text-zinc-300';
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[11px]" title={`Last 15 days (${form.gamesPlayed} G)${form.isPitcher ? '' : ' · wRC+ estimated'}`}>
      <span className="text-zinc-500 font-medium">L15</span>
      <span className={`font-mono ${color}`}>{form.line}</span>
      {form.trend === 'hot' && <span aria-label="hot">🔥</span>}
      {form.trend === 'cold' && <span aria-label="cold">🧊</span>}
    </div>
  );
}

const TIER_META: Record<NonNullable<Matchup['ratingTier']>, { emoji: string; label: string; cls: string }> = {
  strong: { emoji: '🔥', label: 'Strong matchup', cls: 'text-emerald-400' },
  plus: { emoji: '🟢', label: 'Plus matchup', cls: 'text-emerald-300' },
  neutral: { emoji: '⚪', label: 'Neutral matchup', cls: 'text-zinc-400' },
  tough: { emoji: '🔴', label: 'Tough matchup', cls: 'text-red-400' },
};

// Matchup: a weighted tier (pitcher quality × platoon × park) you click to
// reveal the specifics. Falls back to a park-only line when there's no starter.
function MatchupRow({ m }: { m: Matchup }) {
  const [open, setOpen] = useState(false);
  const hand = m.oppStarterHand ? `${m.oppStarterHand}HP ` : '';
  const qualityEra = m.oppStarterCareerEra ?? m.oppStarterEra;
  const platoonText = m.platoon === 'edge' ? 'platoon edge' : m.platoon === 'disadv' ? 'tough platoon' : 'even platoon';

  // No rating (park-only / no announced starter) → the simple line.
  if (!m.ratingTier) {
    return (
      <div className="mb-2 text-[11px] text-zinc-500">
        {m.oppStarterName && <span>vs {hand}<span className="text-zinc-300">{m.oppStarterName}</span></span>}
        {m.parkFactor !== undefined && <span>{m.oppStarterName ? ' · ' : ''}Park {m.parkFactor}</span>}
      </div>
    );
  }

  const t = TIER_META[m.ratingTier];
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 text-[11px] font-medium ${t.cls} cursor-pointer hover:opacity-80`}
        title="Weighted by opposing-pitcher quality (career), handedness, and park — click for details"
      >
        <span>{t.emoji}</span>
        <span>{t.label}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
          <div className="flex flex-wrap gap-x-1.5">
            <span className="text-zinc-400">Why:</span>
            {m.oppStarterName && <span>vs {hand}<span className="text-zinc-300">{m.oppStarterName}</span></span>}
            {qualityEra !== undefined && <span>· {qualityEra.toFixed(2)} ERA{m.oppStarterCareerEra !== undefined ? ' (career)' : ''}</span>}
            {m.parkFactor !== undefined && <span>· Park {m.parkFactor}</span>}
            <span>· {platoonText}</span>
          </div>
          <div className="text-zinc-600">
            <span className="text-zinc-500">How:</span> platoon &amp; pitcher quality (weighted equally) + park.
          </div>
        </div>
      )}
    </div>
  );
}

// Starter's matchup today (opposing offense + park), click to reveal the why.
function PitcherMatchupRow({ m }: { m: NonNullable<DailyPlayerStats['pitcherMatchup']> }) {
  const [open, setOpen] = useState(false);
  const t = TIER_META[m.ratingTier];
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 text-[11px] font-medium ${t.cls} cursor-pointer hover:opacity-80`}
        title="Weighted by the opposing lineup's offense and the ballpark — click for details"
      >
        <span>{t.emoji}</span>
        <span>{t.label}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
          <div className="flex flex-wrap gap-x-1.5">
            <span className="text-zinc-400">Why:</span>
            <span>vs <span className="text-zinc-300">{m.oppTeam}</span> offense</span>
            {m.oppRpg !== undefined && <span>· {m.oppRpg.toFixed(1)} R/G</span>}
            {m.parkFactor !== undefined && <span>· Park {m.parkFactor}</span>}
          </div>
          <div className="text-zinc-600"><span className="text-zinc-500">How:</span> opposing team offense + park (team-level).</div>
        </div>
      )}
    </div>
  );
}

// Pitcher's next announced start (MLB + MiLB), when scheduled.
function NextStartRow({ next }: { next: { date: string; opponent: string } }) {
  const [, m, d] = next.date.split('-');
  const label = m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}` : next.date;
  return (
    <div className="flex items-center gap-1.5 mb-2 text-[11px] text-indigo-300/90">
      <span className="text-zinc-500">Next start</span>
      <span className="font-medium">{label}</span>
      <span className="text-zinc-500">{next.opponent}</span>
    </div>
  );
}

function DailyCard({ stats, onUnfollow, groupControl, premium, oopsy }: { stats: DailyPlayerStats; onUnfollow: (id: number) => void; groupControl?: GroupControl; premium?: PremiumMetrics; oopsy?: OopsySnapshot }) {
  const [logOpen, setLogOpen] = useState(false);
  const canLog = isMLBSystem(stats.sportId);
  const onRehab = isOnRehab(stats);
  const isInjured = Boolean(stats.injury) && !onRehab;
  const notPlaying = stats.gameStatus === 'No Game' || stats.gameStatus === 'Postponed';
  // IL keeps the red border; otherwise tint by level. Dim players not in a game.
  const borderClass = isInjured ? 'border-red-500/60 hover:border-red-500/80' : levelBorderClass(stats.sportId);
  return (
    <div
      className={`bg-zinc-800/60 border ${borderClass} rounded-xl p-4 transition-colors ${notPlaying && !isInjured ? 'opacity-60' : ''}`}
      title={stats.injury?.note}
    >
      {/* Header */}
      <div className="mb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap flex-1">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{stats.playerName}</h3>
            {/* MLB is implied by the section header; badge only the notable levels. */}
            {stats.sportId !== 1 && <LevelBadge sportId={stats.sportId} />}
            {stats.injury && <ILBadge label={stats.injury.label} />}
            {onRehab && <RehabBadge />}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
          {canLog && <LogToggle open={logOpen} onClick={() => setLogOpen((o) => !o)} />}
          {groupControl && (
            <GroupTag
              playerId={stats.playerId}
              groups={groupControl.groups}
              memberOf={groupControl.memberOf}
              onChange={groupControl.onAssignGroups}
            />
          )}
          <FGSearchLink playerName={stats.playerName} />
          <XSearchLink playerName={stats.playerName} />
          <button
            onClick={() => onUnfollow(stats.playerId)}
            className="ml-1 pl-1.5 border-l border-zinc-700/60 text-zinc-600 hover:text-red-400 transition-colors p-1 cursor-pointer"
            title="Unfollow"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          </div>
        </div>
        {/* Full-width signal row: flows left-to-right across the whole card. */}
        {(() => {
          const park = homeParkBadge(stats.team, stats.sportId, stats.position === 'P');
          const hasRow = (stats.twoStartDates && stats.twoStartDates.length >= 2) || stats.calledUpDate || stats.promotedDate || stats.catcherFlex || park || premium;
          if (!hasRow) return null;
          return (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {stats.twoStartDates && stats.twoStartDates.length >= 2 && <TwoStartBadge dates={stats.twoStartDates} />}
              {stats.calledUpDate && <CallUpBadge date={stats.calledUpDate} />}
              {stats.promotedDate && !stats.calledUpDate && <PromotedBadge date={stats.promotedDate} />}
              {stats.catcherFlex && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-500/20 text-teal-300" title={`Catcher who also plays ${stats.catcherFlex}`}>
                  C+{stats.catcherFlex}
                </span>
              )}
              {park && (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${park.cls}`} title={park.title}>
                  {park.label}
                </span>
              )}
              {premium && <PremiumBadges metrics={premium} isPitcher={stats.position === 'P'} />}
            </div>
          );
        })()}
        <div className="text-xs text-zinc-500 mt-1">
          {stats.positionsPlayed || stats.position} &middot; <TeamLine team={stats.team} sportId={stats.sportId} parentOrgAbbrev={stats.parentOrgAbbrev} />
        </div>
      </div>

      {/* Game context */}
      <div className="flex items-center gap-2 mb-2">
        <GameStatusDot status={stats.gameStatus} />
        {stats.gameStatus === 'No Game' ? (
          <span className="text-xs text-zinc-400">No game</span>
        ) : stats.gamePk ? (
          <a
            href={`https://www.mlb.com/gameday/${stats.gamePk}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-zinc-400 hover:text-blue-400 hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {stats.gameContext}
          </a>
        ) : (
          <span className="text-xs text-zinc-400">{stats.gameContext}</span>
        )}
        {/* Time is shown once, in the grade row ("Game at …") for scheduled games. */}
      </div>

      {/* Matchup — a PRE-game projection only, and moot once he's confirmed OUT
          of the lineup. Hidden once the game starts or he's not starting. */}
      {stats.matchup && stats.gameStatus === 'Scheduled' && stats.lineupStatus !== 'not_starting' && (
        <MatchupRow m={stats.matchup} />
      )}

      {/* Starter's matchup today (pitchers, when they're the probable starter). */}
      {stats.pitcherMatchup && stats.gameStatus === 'Scheduled' && (
        <PitcherMatchupRow m={stats.pitcherMatchup} />
      )}

      {/* Next announced start (pitchers) */}
      {stats.nextStart && <NextStartRow next={stats.nextStart} />}

      {/* Stat line */}
      {stats.statLine && stats.gameStatus !== 'Scheduled' && stats.gameStatus !== 'No Game' && (
        <div className="mb-2 px-3 py-2 bg-zinc-900/50 rounded-lg">
          <div className="text-sm font-mono text-zinc-200">{stats.statLine}</div>
        </div>
      )}

      {/* Status row. Scheduled games show a compact time + lineup (no redundant
          "Scheduled" pill); played games show the performance grade. */}
      {stats.gameStatus === 'Scheduled' ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          {stats.gameTime && <span>🕒 {stats.gameTime}</span>}
          {isMLBSystem(stats.sportId) && (
            <LineupBadge
              status={stats.lineupStatus ?? 'tbd'}
              startingPosition={stats.startingPosition}
              battingOrder={stats.battingOrder}
            />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <GradeBadge grade={stats.performanceGrade} reason={stats.gradeReason} />
        </div>
      )}

      {/* Recent form + game log — revealed together via the chevron (keeps the
          default card lean; expand to see the L15 line + last 15 games). */}
      {logOpen && canLog && (
        <>
          {oopsy && (oopsy.hitter || oopsy.pitcher) && <OopsyRow o={oopsy} />}
          {stats.recentForm && <RecentFormRow form={stats.recentForm} />}
          <GameLog playerId={stats.playerId} sportId={stats.sportId} isPitcher={stats.position === 'P'} teamId={stats.teamId} />
        </>
      )}
    </div>
  );
}

function SeasonCard({ stats, onUnfollow, leagueAvg, groupControl, premium }: { stats: SeasonPlayerStats; onUnfollow: (id: number) => void; leagueAvg?: LeagueAverages; groupControl?: GroupControl; premium?: PremiumMetrics }) {
  const [logOpen, setLogOpen] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);
  const canLog = isMLBSystem(stats.sportId);
  const multiLevel = (stats.levelLines?.length ?? 0) > 1;
  // Prefer real wRC+ (MLB), then estimated wRC+ (MiLB), then legacy OPS+ (NPB/KBO).
  const plus = stats.wrcPlus ?? stats.wrcPlusEst ?? stats.opsPlus;
  const plusIsEst = stats.wrcPlus === undefined && stats.wrcPlusEst !== undefined;
  const adjustedPlusLabel = stats.wrcPlus !== undefined ? 'wRC+'
    : plusIsEst ? 'wRC+*'
    : stats.opsPlus !== undefined ? 'OPS+' : 'wRC+';
  const borderClass = stats.injury
    ? 'border-red-500/60 hover:border-red-500/80'
    : levelBorderClass(stats.sportId);

  return (
    <div className={`bg-zinc-800/60 border ${borderClass} rounded-xl p-4 transition-colors`} title={stats.injury?.note}>
      {/* Header */}
      <div className="mb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap flex-1">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{stats.playerName}</h3>
            {stats.sportId !== 1 && <LevelBadge sportId={stats.sportId} />}
            {stats.injury && <ILBadge label={stats.injury.label} />}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
          {canLog && <LogToggle open={logOpen} onClick={() => setLogOpen((o) => !o)} />}
          {groupControl && (
            <GroupTag
              playerId={stats.playerId}
              groups={groupControl.groups}
              memberOf={groupControl.memberOf}
              onChange={groupControl.onAssignGroups}
            />
          )}
          <FGSearchLink playerName={stats.playerName} />
          <XSearchLink playerName={stats.playerName} />
          <button
            onClick={() => onUnfollow(stats.playerId)}
            className="ml-1 pl-1.5 border-l border-zinc-700/60 text-zinc-600 hover:text-red-400 transition-colors p-1 cursor-pointer"
            title="Unfollow"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          </div>
        </div>
        {premium && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <PremiumBadges metrics={premium} isPitcher={stats.isPitcher} />
          </div>
        )}
        <div className="text-xs text-zinc-500 mt-1">
          {stats.position} &middot; <TeamLine team={stats.team} sportId={stats.sportId} parentOrgAbbrev={stats.parentOrgAbbrev} /> &middot; {stats.gamesPlayed} G
          {multiLevel && (
            <>
              {' '}&middot;{' '}
              <button
                onClick={() => setLevelOpen((o) => !o)}
                className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
              >
                {stats.levelLines!.length} levels {levelOpen ? '▴' : '▾'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Season stats */}
      <div className="px-3 py-2 bg-zinc-900/50 rounded-lg">
        {stats.isPitcher ? (
          <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
            <StatCell label="ERA" value={stats.era || '—'} />
            <StatCell label="WHIP" value={stats.whip || '—'} />
            <StatCell label="IP" value={stats.inningsPitched || '—'} />
            <StatCell label="K" value={stats.pitchingStrikeouts?.toString() || '—'} />
            <StatCell label="BB" value={stats.walksAllowed?.toString() || '—'} />
            <StatCell label="W-L" value={`${stats.wins || 0}-${stats.losses || 0}`} />
            <StatCell label="SV" value={stats.saves?.toString() || '—'} />
            <StatCell label="K/9" value={stats.kPer9 || '—'} />
            <StatCell label="BB/9" value={stats.bbPer9 || '—'} />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
            <StatCell label="AVG" value={stats.avg || '—'} highlight={parseFloat(stats.avg || '0') >= 0.3} />
            <StatCell label="OBP" value={stats.obp || '—'} />
            <StatCell label="SLG" value={stats.slg || '—'} />
            <StatCell label="ISO" value={isoValue(stats.avg, stats.slg)} highlight={isoFloat(stats.avg, stats.slg) >= 0.2} />
            <StatCell label="OPS" value={stats.ops || '—'} highlight={parseFloat(stats.ops || '0') >= 0.9} />
            <StatCell label="wOBA" value={stats.woba || '—'} highlight={parseFloat(stats.woba || '0') >= 0.36} />
            <StatCell label={adjustedPlusLabel} value={plus !== undefined ? Math.round(plus).toString() : '—'} highlight={(plus || 0) >= 130} />
            <StatCell label="HR" value={stats.homeRuns?.toString() || '—'} />
            <StatCell label="SB" value={stats.stolenBases?.toString() || '—'} />
            <StatCell label="BB" value={stats.walks?.toString() || '—'} />
            <StatCell label="K" value={stats.strikeouts?.toString() || '—'} />
            <StatCell label="PA" value={stats.plateAppearances?.toString() || '—'} />
          </div>
        )}
        {leagueAvg && (
          <LeagueContext leagueAvg={leagueAvg} isPitcher={stats.isPitcher} />
        )}
        {plusIsEst && (
          <div className="mt-1.5 text-[9px] text-zinc-600">* wRC+ estimated (no minor-league park factor)</div>
        )}
      </div>

      {levelOpen && multiLevel && <LevelBreakdown lines={stats.levelLines!} />}

      {logOpen && canLog && (
        <GameLog playerId={stats.playerId} sportId={stats.sportId} isPitcher={stats.isPitcher} />
      )}
    </div>
  );
}

function isoFloat(avg?: string, slg?: string): number {
  const a = parseFloat(avg || '');
  const s = parseFloat(slg || '');
  if (!isFinite(a) || !isFinite(s)) return 0;
  return s - a;
}

function isoValue(avg?: string, slg?: string): string {
  const a = parseFloat(avg || '');
  const s = parseFloat(slg || '');
  if (!isFinite(a) || !isFinite(s)) return '—';
  const iso = s - a;
  return iso.toFixed(3).replace(/^0/, '');
}

function StatCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-mono ${highlight ? 'text-green-400 font-semibold' : 'text-zinc-200'}`}>
        {value}
      </span>
    </div>
  );
}

export default function PlayerCard(props: PlayerCardProps) {
  if (props.type === 'daily') {
    return <DailyCard stats={props.stats} onUnfollow={props.onUnfollow} groupControl={props.groupControl} premium={props.premium} oopsy={props.oopsy} />;
  }
  return <SeasonCard stats={props.stats} onUnfollow={props.onUnfollow} leagueAvg={props.leagueAvg} groupControl={props.groupControl} premium={props.premium} />;
}
