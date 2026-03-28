'use client';

import { DailyPlayerStats, SeasonPlayerStats, LEVEL_LABELS } from '@/lib/types';
import GradeBadge from './GradeBadge';

interface DailyCardProps {
  type: 'daily';
  stats: DailyPlayerStats;
  onUnfollow: (playerId: number) => void;
}

interface SeasonCardProps {
  type: 'season';
  stats: SeasonPlayerStats;
  onUnfollow: (playerId: number) => void;
}

type PlayerCardProps = DailyCardProps | SeasonCardProps;

function LevelBadge({ sportId }: { sportId: number }) {
  const isMlb = sportId === 1;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
      isMlb ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'
    }`}>
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

function TeamLine({ team, sportId, parentOrg }: { team: string; sportId: number; parentOrg?: string }) {
  if (sportId === 1 || !parentOrg) return <>{team}</>;
  return <>{team} <span className="text-zinc-600">({parentOrg})</span></>;
}

function DailyCard({ stats, onUnfollow }: { stats: DailyPlayerStats; onUnfollow: (id: number) => void }) {
  return (
    <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 hover:border-zinc-600/50 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{stats.playerName}</h3>
            <LevelBadge sportId={stats.sportId} />
          </div>
          <div className="text-xs text-zinc-500">
            {stats.position} &middot; <TeamLine team={stats.team} sportId={stats.sportId} parentOrg={stats.parentOrg} />
          </div>
        </div>
        <button
          onClick={() => onUnfollow(stats.playerId)}
          className="text-zinc-600 hover:text-red-400 transition-colors p-1 cursor-pointer"
          title="Unfollow"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Game context */}
      <div className="flex items-center gap-2 mb-2">
        <GameStatusDot status={stats.gameStatus} />
        <span className="text-xs text-zinc-400">
          {stats.gameStatus === 'No Game' ? 'No game' : stats.gameContext}
        </span>
        {stats.gameTime && stats.gameStatus === 'Scheduled' && (
          <span className="text-xs text-zinc-500">{stats.gameTime}</span>
        )}
      </div>

      {/* Stat line */}
      {stats.statLine && stats.gameStatus !== 'Scheduled' && stats.gameStatus !== 'No Game' && (
        <div className="mb-2 px-3 py-2 bg-zinc-900/50 rounded-lg">
          <div className="text-sm font-mono text-zinc-200">{stats.statLine}</div>
        </div>
      )}

      {/* Grade */}
      <GradeBadge grade={stats.performanceGrade} reason={stats.gradeReason} />
    </div>
  );
}

function SeasonCard({ stats, onUnfollow }: { stats: SeasonPlayerStats; onUnfollow: (id: number) => void }) {
  return (
    <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 hover:border-zinc-600/50 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{stats.playerName}</h3>
            <LevelBadge sportId={stats.sportId} />
          </div>
          <div className="text-xs text-zinc-500">
            {stats.position} &middot; <TeamLine team={stats.team} sportId={stats.sportId} parentOrg={stats.parentOrg} /> &middot; {stats.gamesPlayed} G
          </div>
        </div>
        <button
          onClick={() => onUnfollow(stats.playerId)}
          className="text-zinc-600 hover:text-red-400 transition-colors p-1 cursor-pointer"
          title="Unfollow"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
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
            <StatCell label="OPS" value={stats.ops || '—'} highlight={parseFloat(stats.ops || '0') >= 0.9} />
            <StatCell label="wRC+" value={stats.wrcPlus !== undefined ? Math.round(stats.wrcPlus).toString() : '—'} highlight={(stats.wrcPlus || 0) >= 130} />
            <StatCell label="HR" value={stats.homeRuns?.toString() || '—'} />
            <StatCell label="SB" value={stats.stolenBases?.toString() || '—'} />
            <StatCell label="BB" value={stats.walks?.toString() || '—'} />
            <StatCell label="K" value={stats.strikeouts?.toString() || '—'} />
          </div>
        )}
      </div>
    </div>
  );
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
    return <DailyCard stats={props.stats} onUnfollow={props.onUnfollow} />;
  }
  return <SeasonCard stats={props.stats} onUnfollow={props.onUnfollow} />;
}
