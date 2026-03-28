export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="text-4xl mb-4">&#9918;</div>
      <h2 className="text-lg font-semibold text-zinc-300 mb-2">No players on your Hot Sheet</h2>
      <p className="text-sm text-zinc-500 text-center max-w-md">
        Search for MLB and MiLB players above to start tracking their stats.
        Your followed players are saved locally in your browser.
      </p>
    </div>
  );
}
