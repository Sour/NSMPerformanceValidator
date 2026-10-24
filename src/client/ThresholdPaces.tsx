import type { ThresholdsResponse } from "../server/app";
import { formatHr, formatPace } from "./format";

/** LT2 Pace at the current LTHR, or why there is none. */
export function ThresholdPaces({ thresholds }: { thresholds: ThresholdsResponse }) {
  if (thresholds.lthr === null) return <p className="rest">No Quality Run names a heart-rate target, so there is no LTHR</p>;
  return (
    <section className="thresholds">
      <div className="threshold">
        <span className="threshold-name">LT2 Pace</span>
        <strong className="threshold-pace">
          {thresholds.lt2Pace === null ? "Not enough data" : formatPace(thresholds.lt2Pace)}
        </strong>
        <span className="range">at LTHR {formatHr(thresholds.lthr)}</span>
      </div>
    </section>
  );
}
