import type { StorageState } from './useStorage.js';

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;

/**
 * What is cached, what it costs, and whether the browser will keep it.
 *
 * The point of this panel is that a contestant can arm the tool deliberately before a
 * round, rather than discovering a hundred-megabyte download at the moment the network
 * goes away. It is also the only place that says whether storage is actually persistent -
 * without that, a cached toolchain can be evicted under disk pressure with no warning.
 */
export function StoragePanel({ storage, onClose }: { storage: StorageState; onClose: () => void }) {
  const { estimate, packs } = storage;
  const missing = packs.filter((p) => !p.ready);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Pamiec i pakiety</h2>
          <button onClick={onClose} title="Zamknij">
            ×
          </button>
        </header>

        <p className="modal-lead">
          Pakiety pobierasz raz. Potem wszystko dziala bez internetu - warto zrobic to przed
          zawodami, a nie w chwili, gdy siec przestanie dzialac.
        </p>

        <ul className="pack-list">
          {packs.map(({ pack, ready, progress }) => {
            const total = pack.files.reduce((sum, file) => sum + file.bytes, 0);
            const downloading = progress?.state === 'downloading';
            const percent =
              downloading && progress.totalBytes > 0
                ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
                : 0;

            return (
              <li key={pack.id}>
                <div className="pack-row">
                  <span className="pack-name">{pack.label}</span>
                  <span className="pack-size">{mb(total)}</span>
                  {ready ? (
                    <>
                      <span className="chip good">gotowy</span>
                      <button onClick={() => storage.remove(pack.id)}>Usun</button>
                    </>
                  ) : downloading ? (
                    <span className="pack-progress">{percent}%</span>
                  ) : (
                    <button onClick={() => storage.download(pack.id)} disabled={storage.busy}>
                      Pobierz
                    </button>
                  )}
                </div>
                <p className="pack-desc">{pack.description}</p>
                {downloading && <progress value={percent} max={100} />}
                {progress?.state === 'failed' && <p className="error">{progress.error}</p>}
              </li>
            );
          })}
        </ul>

        {missing.length > 0 && (
          <button className="primary wide" onClick={storage.downloadAll} disabled={storage.busy}>
            Pobierz wszystko ({missing.length})
          </button>
        )}

        <label className="auto-download">
          <input
            type="checkbox"
            data-field="auto-download"
            checked={storage.autoDownload}
            onChange={(event) => storage.setAutoDownload(event.target.checked)}
          />
          <span>
            Pobieraj wszystko automatycznie. Wylacz, jesli jestes na wolnym lub platnym polaczeniu -
            komplet to okolo 150 MB.
          </span>
        </label>

        <dl className="storage-facts">
          <dt>Zajete</dt>
          <dd>
            {estimate ? mb(estimate.usedBytes) : '...'}
            {estimate && estimate.quotaBytes > 0 && ` z ${mb(estimate.quotaBytes)}`}
          </dd>

          <dt>Trwale</dt>
          <dd>
            {estimate?.persisted ? (
              'tak - przegladarka nie usunie danych'
            ) : (
              <>
                nie - przegladarka moze usunac dane przy braku miejsca{' '}
                <button onClick={storage.requestPersist}>Popros o trwalosc</button>
              </>
            )}
          </dd>
        </dl>
      </section>
    </div>
  );
}
