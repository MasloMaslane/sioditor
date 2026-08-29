import type { Problem } from '@sioditor/storage';

const MB = 1048576;

/**
 * Per-problem run limits.
 *
 * Editable because OI tasks state their own, and the defaults here cannot know them. They
 * stop a runaway program and give a feel for whether a solution is in the right complexity
 * class - they are deliberately not a verdict, since these timings are a browser on the
 * contestant's laptop rather than the judge's hardware.
 */
export function ProblemSettings({
  problem,
  onChange,
}: {
  problem: Problem;
  onChange: (patch: Partial<Problem>) => void;
}) {
  return (
    <div className="limits">
      <label>
        <span>limit czasu</span>
        <input
          type="number"
          min={100}
          max={60000}
          step={100}
          value={problem.timeLimitMs}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value > 0) onChange({ timeLimitMs: value });
          }}
        />
        <span className="unit">ms</span>
      </label>

      <label>
        <span>limit pamieci</span>
        <input
          type="number"
          min={16}
          max={2048}
          step={16}
          value={Math.round(problem.memoryLimitBytes / MB)}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value > 0) onChange({ memoryLimitBytes: value * MB });
          }}
        />
        <span className="unit">MB</span>
      </label>
    </div>
  );
}
