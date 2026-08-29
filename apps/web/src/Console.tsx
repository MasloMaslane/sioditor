export interface ConsoleLine {
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

export function Console({ lines, status }: { lines: readonly ConsoleLine[]; status: string }) {
  return (
    <div className="panel console">
      <span className="panel-title">Wyjscie</span>
      <pre>
        {lines.map((line, index) => (
          <span key={index} className={line.stream}>
            {line.text}
          </span>
        ))}
      </pre>
      {status && <span className="status">{status}</span>}
    </div>
  );
}
