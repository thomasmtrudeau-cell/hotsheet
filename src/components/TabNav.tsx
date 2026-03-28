'use client';

import { ViewTab } from '@/lib/types';

interface TabNavProps {
  activeTab: ViewTab;
  onChange: (tab: ViewTab) => void;
}

const tabs: { value: ViewTab; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'season', label: 'Season' },
];

export default function TabNav({ activeTab, onChange }: TabNavProps) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-zinc-700 w-fit">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
            activeTab === tab.value
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
