import { Grade, GRADE_MAP } from '@/lib/types';

interface GradeBadgeProps {
  grade: Grade;
  reason?: string;
}

export default function GradeBadge({ grade, reason }: GradeBadgeProps) {
  const config = GRADE_MAP[grade];
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
        style={{ backgroundColor: config.bgColor, color: config.color }}
      >
        <span>{config.emoji}</span>
        <span>{config.label}</span>
      </span>
      {reason && (
        <span className="text-[11px] text-zinc-500 truncate max-w-[180px]">{reason}</span>
      )}
    </div>
  );
}
