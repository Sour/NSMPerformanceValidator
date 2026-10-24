import type { ThresholdsResponse } from "../server/app";
import { formatHr, formatPace } from "./format";

/** LT1 Pace and LT2 Pace at the current LT1 HR and LTHR, or why there are none. */
export function ThresholdPaces({ thresholds }: { thresholds: ThresholdsResponse }) {
  if (thresholds.lthr === null) return <p className="rest">No Quality Run names a heart-rate target, so there is no LTHR</p>;
  return (
    <section className="thresholds">
      <Threshold name="LT1 Pace" pace={thresholds.lt1Pace}>
        {thresholds.lt1Hr !== null &&
          (thresholds.lt1HrAssumed
            ? `at assumed LT1 HR ${formatHr(thresholds.lt1Hr)} (88% of LTHR; set LT1_HR to use your own)`
            : `at LT1 HR ${formatHr(thresholds.lt1Hr)}`)}
      </Threshold>
      <Threshold name="LT2 Pace" pace={thresholds.lt2Pace}>
        at LTHR {formatHr(thresholds.lthr)}
      </Threshold>
    </section>
  );
}

function Threshold({ name, pace, children }: { name: string; pace: number | null; children: React.ReactNode }) {
  return (
    <div className="threshold">
      <span className="threshold-name">{name}</span>
      <strong className="threshold-pace">{pace === null ? "Not enough data" : formatPace(pace)}</strong>
      <span className="range">{children}</span>
    </div>
  );
}
