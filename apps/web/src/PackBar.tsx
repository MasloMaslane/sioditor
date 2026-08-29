import type { PackHandle } from './usePack.js';

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The download is not hidden behind a spinner on purpose: a contestant should be able to
 * arm the toolchain deliberately before a round, not discover a 12 MB fetch at the moment
 * the network dies.
 */
export function PackBar({ pack: handle }: { pack: PackHandle }) {
  const { pack, ready, checked, progress, download } = handle;

  if (!checked) {
    return (
      <div className="packbar" data-pack={pack.id}>
        <span>Sprawdzanie {pack.label}...</span>
      </div>
    );
  }

  if (ready) {
    return (
      <div className="packbar ready" data-pack={pack.id}>
        <span>{pack.label} gotowy - dziala bez internetu</span>
      </div>
    );
  }

  if (progress?.state === 'downloading') {
    const percent =
      progress.totalBytes > 0
        ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
        : 0;
    return (
      <div className="packbar" data-pack={pack.id}>
        <span>
          Pobieranie {pack.label}: {percent}% ({formatMb(progress.receivedBytes)} /{' '}
          {formatMb(progress.totalBytes)})
        </span>
        <progress value={percent} max={100} />
      </div>
    );
  }

  const total = pack.files.reduce((sum, file) => sum + file.bytes, 0);
  return (
    <div className="packbar" data-pack={pack.id}>
      <span>
        {pack.label} - {pack.description} ({formatMb(total)})
      </span>
      <button onClick={download}>Pobierz teraz</button>
      {progress?.state === 'failed' && <span className="error">{progress.error}</span>}
    </div>
  );
}
