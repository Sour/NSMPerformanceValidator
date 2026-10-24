import { secondsPerMile } from "../domain/pace";
import type { ThresholdsResponse } from "../server/app";
import { formatHr, formatPace } from "./format";
import { ThresholdChart } from "./ThresholdChart";

/** LT1 Pace and LT2 Pace at the current LT1 HR and LTHR, or why there are none, and their weekly trend. */
export function ThresholdPaces({ thresholds }: { thresholds: ThresholdsResponse }) {
  if (thresholds.lthr === null) return <p className="rest">No Quality Run names a heart-rate target, so there is no LTHR</p>;
  return (
    <section>
      <div className="thresholds">
        <Threshold name="LT1 Pace" pace={thresholds.lt1Pace}>
          {thresholds.lt1Hr !== null &&
            (thresholds.lt1HrAssumed
              ? `at assumed LT1 HR ${formatHr(thresholds.lt1Hr)} (${Math.round((thresholds.lt1Hr / thresholds.lthr) * 100)}% of LTHR; set LT1_HR to use your own)`
              : `at LT1 HR ${formatHr(thresholds.lt1Hr)}`)}
        </Threshold>
        <Threshold name="LT2 Pace" pace={thresholds.lt2Pace}>
          at LTHR {formatHr(thresholds.lthr)}
          {thresholds.icuThresholdPace !== null && (
            <>
              <br />
              intervals.icu {formatPace(thresholds.icuThresholdPace)}
              {thresholds.lt2Pace !== null && ` · ${comparison(thresholds.icuThresholdPace, thresholds.lt2Pace)}`}
            </>
          )}
        </Threshold>
      </div>
      <ThresholdChart weeks={thresholds.weeks} icuThresholdPace={thresholds.icuThresholdPace} />
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

/** How the intervals.icu Threshold Pace compares with LT2 Pace, e.g. "8 s slower" per mile. */
function comparison(icuThresholdPace: number, lt2Pace: number): string {
  const seconds = Math.round(secondsPerMile(icuThresholdPace) - secondsPerMile(lt2Pace));
  if (seconds === 0) return "same";
  return `${Math.abs(seconds)} s ${seconds > 0 ? "slower" : "faster"}`;
}
