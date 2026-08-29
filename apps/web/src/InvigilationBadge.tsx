import type { InvigilationState } from './useInvigilation.js';

/**
 * A standing indication that the session is being recorded.
 *
 * Present the whole time on purpose: a contestant should never have to remember whether
 * recording is on. It also shows what has not yet reached the organiser, so a network
 * problem is visible to the person best placed to mention it.
 */
export function InvigilationBadge({ invigilation }: { invigilation: InvigilationState }) {
  if (!invigilation.active) return null;
  const { sync } = invigilation;
  const pending = sync?.pending ?? 0;
  const failing = (sync?.failures ?? 0) > 0;

  return (
    <span
      className={`invig ${failing ? 'warn' : ''}`}
      title={
        failing
          ? `Brak polaczenia z serwerem. Zapis jest bezpieczny lokalnie i zostanie wyslany, ` +
            `gdy siec wroci. Ostatni blad: ${sync?.lastError ?? 'nieznany'}`
          : 'Sesja jest nagrywana i wysylana do organizatora'
      }
    >
      <span className="invig-dot" />
      nagrywanie
      {pending > 0 && <span className="invig-pending">{pending} do wyslania</span>}
    </span>
  );
}
