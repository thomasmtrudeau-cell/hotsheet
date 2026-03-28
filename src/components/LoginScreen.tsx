'use client';

import { useState } from 'react';

const ALLOWED_USERS = ['tom', 'kent', 'nolan'];

interface LoginScreenProps {
  onLogin: (username: string) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const lower = name.trim().toLowerCase();
    if (!lower) return;
    if (!ALLOWED_USERS.includes(lower)) {
      setError('Name not recognized');
      return;
    }
    onLogin(lower);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-xs">
        <h1 className="text-2xl font-bold text-zinc-100 mb-1 text-center">Hot Sheet</h1>
        <p className="text-sm text-zinc-500 mb-8 text-center">Enter your name to get started</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            placeholder="Your first name"
            autoFocus
            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-center text-lg"
          />
          {error && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}
          <button
            type="submit"
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors cursor-pointer"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
