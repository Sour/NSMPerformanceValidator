import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef, useState } from "react";
import { formatDuration, secondsPerMile } from "../domain/pace";
import type { RepLengthCard, RepLengthRun } from "../domain/repProgress";
import { formatDate } from "./format";

echarts.use([LineChart, ScatterChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

/** One card per Rep Length: the latest Rep GAP, its change, and Rep GAP and Rep HR over time. */
export function RepCards({ cards }: { cards: RepLengthCard[] }) {
  if (cards.length === 0) return <p className="rest">No Quality Runs in the plan yet</p>;
  return (
    <div className="rep-cards">
      {cards.map((card) => (
        <RepCard key={card.repLength} card={card} />
      ))}
    </div>
  );
}

function RepCard({ card }: { card: RepLengthCard }) {
  const { latest, previous } = card;
  return (
    <section className="rep-card">
      <h3>{formatDuration(card.repLength)} Reps</h3>
      {latest?.repGap ? (
        <>
          <p className="headline">
            {formatDuration(secondsPerMile(latest.repGap))} <span className="unit">/mi Rep GAP</span>
          </p>
          <p className="change">
            {formatDate(latest.date)}
            {latest.repHr !== null && ` · ${Math.round(latest.repHr)} bpm`}
            {previous?.repGap && ` · ${paceChange(latest.repGap, previous.repGap)} than ${formatDate(previous.date)}`}
          </p>
        </>
      ) : (
        <p className="rest">No Complete Quality Run yet</p>
      )}
      {card.runs.length > 0 && (
        <>
          <RepChart runs={card.runs} />
          <RunTable runs={card.runs} />
        </>
      )}
    </section>
  );
}

/** How a Rep GAP compares with an earlier one, e.g. "4s faster". */
function paceChange(latestGap: number, previousGap: number): string {
  const seconds = Math.round(secondsPerMile(latestGap) - secondsPerMile(previousGap));
  if (seconds === 0) return "same pace";
  const size = Math.abs(seconds) < 60 ? `${Math.abs(seconds)}s` : formatDuration(Math.abs(seconds));
  return `${size} ${seconds < 0 ? "faster" : "slower"}`;
}

/** Rep GAP above Rep HR on a shared date axis; only Complete runs are joined into a trend line. */
function RepChart({ runs }: { runs: RepLengthRun[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = usePrefersDark();

  useEffect(() => {
    const el = ref.current!;
    const chart = echarts.init(el, null, { renderer: "svg" });
    chart.setOption(chartOption(runs, chartColors()));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [runs, dark]);

  return <div ref={ref} className="rep-chart" />;
}

interface ChartColors {
  gap: string;
  hr: string;
  text: string;
  muted: string;
  grid: string;
  surface: string;
}

function chartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    gap: v("--series-1"),
    hr: v("--series-2"),
    text: v("--text"),
    muted: v("--muted"),
    grid: v("--border"),
    surface: v("--surface"),
  };
}

const DAY_MS = 86_400_000;
const time = (s: RepLengthRun) => Date.parse(`${s.date}T00:00:00`);

function chartOption(runs: RepLengthRun[], c: ChartColors): echarts.EChartsCoreOption {
  const complete = runs.filter((s) => s.complete);
  const incomplete = runs.filter((s) => !s.complete);
  const byTime = new Map(runs.map((s) => [time(s), s]));
  const gapPoint = (s: RepLengthRun) => [time(s), secondsPerMile(s.repGap!)];
  const hrPoint = (s: RepLengthRun) => [time(s), s.repHr];
  const axisLabel = { color: c.muted, fontSize: 11 };
  const splitLine = { lineStyle: { color: c.grid } };
  const filled = { symbol: "circle", symbolSize: 9, itemStyle: { borderColor: c.surface, borderWidth: 1 } };
  const hollow = (color: string) => ({
    symbol: "circle",
    symbolSize: 9,
    itemStyle: { color: c.surface, borderColor: color, borderWidth: 2 },
  });
  const axisName = { color: c.muted, fontSize: 11, align: "left" as const, padding: [0, 0, 0, -40] };
  const times = runs.map(time);

  return {
    animation: false,
    textStyle: { fontFamily: "system-ui, sans-serif" },
    legend: { top: 0, right: 0, data: ["Complete", "Incomplete"], textStyle: { color: c.muted }, itemWidth: 14 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: c.muted } },
      backgroundColor: c.surface,
      borderColor: c.grid,
      textStyle: { color: c.text },
      formatter: (params: { axisValue: number }[]) => runTooltip(byTime.get(params[0]!.axisValue)),
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: 48, right: 16, top: 48, height: 130 },
      { left: 48, right: 16, top: 216, bottom: 28 },
    ],
    xAxis: [0, 1].map((gridIndex) => ({
      type: "time",
      gridIndex,
      min: Math.min(...times) - DAY_MS,
      max: Math.max(...times) + DAY_MS,
      minInterval: DAY_MS,
      axisLabel: {
        ...axisLabel,
        show: gridIndex === 1,
        hideOverlap: true,
        formatter: (v: number) => formatDate(new Date(v).toLocaleDateString("en-CA")),
      },
      axisLine: { lineStyle: { color: c.grid } },
      axisTick: { show: false },
      splitLine: { show: false },
    })),
    yAxis: [
      {
        gridIndex: 0,
        type: "value",
        name: "Rep GAP /mi",
        nameLocation: "start",
        nameTextStyle: axisName,
        inverse: true,
        scale: true,
        minInterval: 1,
        axisLabel: { ...axisLabel, formatter: (v: number) => formatDuration(v) },
        splitLine,
        splitNumber: 3,
      },
      {
        gridIndex: 1,
        type: "value",
        name: "Rep HR bpm",
        nameTextStyle: axisName,
        scale: true,
        minInterval: 1,
        axisLabel,
        splitLine,
        splitNumber: 2,
      },
    ],
    series: [
      {
        name: "Complete",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: complete.filter((s) => s.repGap !== null).map(gapPoint),
        color: c.gap,
        lineStyle: { width: 2 },
        ...filled,
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: c.muted, type: "dashed" },
          label: { color: c.muted, fontSize: 11, formatter: "{b}", position: "start" },
          data: incomplete
            .filter((s) => s.repGap === null)
            .map((s) => ({ xAxis: time(s), name: `${s.repsRun}/${s.format.reps} Reps` })),
        },
      },
      {
        name: "Incomplete",
        type: "scatter",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: incomplete.filter((s) => s.repGap !== null).map(gapPoint),
        color: c.gap,
        ...hollow(c.gap),
      },
      {
        name: "Complete",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: complete.filter((s) => s.repHr !== null).map(hrPoint),
        color: c.hr,
        lineStyle: { width: 2 },
        ...filled,
      },
      {
        name: "Incomplete",
        type: "scatter",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: incomplete.filter((s) => s.repHr !== null).map(hrPoint),
        color: c.hr,
        ...hollow(c.hr),
      },
    ],
  };
}

function runTooltip(s: RepLengthRun | undefined): string {
  if (!s) return "";
  const lines = [
    `<strong>${formatDate(s.date)}</strong> · ${escapeHtml(s.plannedWorkoutName)}`,
    `${s.complete ? "Complete" : "Incomplete"} · ${s.repsRun}/${s.format.reps} Reps`,
  ];
  if (s.repGap !== null) lines.push(`Rep GAP ${formatDuration(secondsPerMile(s.repGap))} /mi`);
  if (s.repHr !== null) lines.push(`Rep HR ${Math.round(s.repHr)} bpm`);
  return lines.join("<br>");
}

function RunTable({ runs }: { runs: RepLengthRun[] }) {
  return (
    <details className="runs">
      <summary>Quality Runs</summary>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Format</th>
            <th>Reps</th>
            <th>Rep GAP</th>
            <th>Rep HR</th>
          </tr>
        </thead>
        <tbody>
          {[...runs].reverse().map((s) => (
            <tr key={s.activityId} className={s.complete ? undefined : "incomplete"}>
              <td>{formatDate(s.date)}</td>
              <td>
                {s.format.reps} × {formatDuration(s.format.repLength)}
              </td>
              <td>
                {s.repsRun}/{s.format.reps} {s.complete ? "Complete" : "Incomplete"}
              </td>
              <td>{s.repGap === null ? "–" : `${formatDuration(secondsPerMile(s.repGap))} /mi`}</td>
              <td>{s.repHr === null ? "–" : `${Math.round(s.repHr)} bpm`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function usePrefersDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const onChange = () => setDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return dark;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
