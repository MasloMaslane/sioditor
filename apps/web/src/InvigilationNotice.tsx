import type { SupervisedSession } from './useInvigilation.js';

/**
 * Shown before anything is recorded.
 *
 * This is a transparency notice, not a consent form, and the distinction is deliberate.
 * GDPR consent has to be freely given, and it is not freely given when refusing means not
 * competing - so the lawful basis for an official round is the contest regulations, and
 * what this screen owes the contestant is a complete and readable account of what is
 * captured. Every signal listed here is one the recorder actually emits; if that list
 * changes, this changes with it.
 */
export function InvigilationNotice({
  session,
  onAcknowledge,
}: {
  session: SupervisedSession;
  onAcknowledge: () => void;
}) {
  return (
    <div className="notice-backdrop">
      <section className="notice">
        <h1>Zawody pod nadzorem</h1>
        <p className="notice-session">
          Sesja <code>{session.sessionId}</code>, uczestnik <code>{session.participantId}</code>
        </p>

        <p>
          Ten edytor zapisuje przebieg Twojej pracy i wysyla go organizatorowi. Zapis sluzy do
          wyjasniania watpliwosci - oglada go czlowiek, nic nie jest oceniane automatycznie.
        </p>

        <h2>Co jest zapisywane</h2>
        <ul>
          <li>
            <strong>Kazda zmiana w kodzie</strong> - pozycja, dlugosc i czas. Pozwala to odtworzyc,
            jak powstawalo rozwiazanie.
          </li>
          <li>
            <strong>Wklejenia i przeciagniecia tekstu</strong> - dlugosc, skrot kryptograficzny i
            to, czy taki tekst juz wystepowal w Twojej pracy. Tresc zapisujemy tylko dla wklejen
            dluzszych niz 120 znakow.
          </li>
          <li>
            <strong>Przelaczanie sie miedzy oknami</strong> - moment utraty i odzyskania skupienia
            przez karte przegladarki oraz wejscie i wyjscie z pelnego ekranu.
          </li>
          <li>
            <strong>Liczba otwartych kart tego edytora.</strong>
          </li>
          <li>
            <strong>Uruchomienia programu</strong> - zadanie, jezyk i wynik.
          </li>
        </ul>

        <h2>Czego nie zapisujemy</h2>
        <ul>
          <li>Zawartosci innych kart, okien i programow - przegladarka na to nie pozwala.</li>
          <li>Obrazu ekranu, kamery ani mikrofonu.</li>
          <li>Tresci schowka poza wklejeniami do tego edytora.</li>
          <li>Czegokolwiek poza sesja, do ktorej dolaczyles tym linkiem.</li>
        </ul>

        <p className="notice-small">
          Zapis jest wysylany na biezaco, a gdy siec nie dziala - przechowywany lokalnie i wysylany
          pozniej. Podstawa prawna, okres przechowywania i osoby majace dostep sa okreslone w
          regulaminie zawodow.
        </p>

        <button className="primary wide" onClick={onAcknowledge}>
          Przeczytalem i rozpoczynam
        </button>
      </section>
    </div>
  );
}
