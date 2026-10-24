import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef, useState } from "react";
import { formatDuration, secondsPerMile } from "../domain/pace";
import type { RepLengthCard, RepLengthRun } from "../domain/repProgress";
import { formatDate, formatText } from "./format";
import { RunDrawer } from "./RunDrawer";
import { usePrefersDark } from "./usePrefersDark";

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
  const [showEfficiency, setShowEfficiency] = useState(false);
  const [selected, setSelected] = useState<RepLengthRun | null>(null);
  return (
    <section className="rep-card">
      <header>
        <h3>{formatDuration(card.repLength)} Reps</h3>
        {card.runs.length > 0 && (
          <label className="toggle">
            <input type="checkbox" checked={showEfficiency} onChange={(e) => setShowEfficiency(e.target.checked)} />
            Efficiency
          </label>
        )}
      </header>
      {latest?.repGap ? (
        <>
          <p className="headline">
            {formatDuration(secondsPerMile(latest.repGap))} <span className="unit">/mi Rep GAP</span>
          </p>
          <p className="change">
            {formatDate(latest.date)}
            {latest.repHr !== null && ` · ${Math.round(latest.repHr)} bpm`}
            {latest.overTarget && <span className="over-target"> · Over Target</span>}
            {previous?.repGap && ` · ${paceChange(latest.repGap, previous.repGap)} than ${formatDate(previous.date)}`}
          </p>
        </>
      ) : (
        <p className="rest">No Complete Quality Run yet</p>
      )}
      {card.runs.length > 0 && (
        <>
          <RepChart runs={card.runs} showEfficiency={showEfficiency} onSelect={setSelected} />
          <RunTable runs={card.runs} onSelect={setSelected} />
        </>
      )}
      {selected && <RunDrawer key={selected.activityId} run={selected} onClose={() => setSelected(null)} />}
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

/**
 * Rep GAP above Rep HR on a shared date axis; only Complete runs are joined into a trend line.
 * Over Target runs get a red ring, Format changes a marker line, and Efficiency an optional series beside Rep GAP.
 * Clicking a run's point, or the marker line of a run with no Reps, selects it.
 */
function RepChart({
  runs,
  showEfficiency,
  onSelect,
}: {
  runs: RepLengthRun[];
  showEfficiency: boolean;
  onSelect: (run: RepLengthRun) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = usePrefersDark();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const el = ref.current!;
    const chart = echarts.init(el, null, { renderer: "svg" });
    chart.setOption(chartOption(runs, chartColors(), showEfficiency));
    const byTime = new Map(runs.map((s) => [time(s), s]));
    chart.on("click", (params) => {
      const at = params.componentType === "markLine" ? (params.data as { xAxis: number }).xAxis : (params.value as number[])[0]!;
      const run = byTime.get(at);
      if (run) onSelectRef.current(run);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [runs, dark, showEfficiency]);

  return <div ref={ref} className="rep-chart" />;
}

interface ChartColors {
  gap: string;
  hr: string;
  efficiency: string;
  overTarget: string;
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
    efficiency: v("--series-3"),
    overTarget: v("--over-target"),
    text: v("--text"),
    muted: v("--muted"),
    grid: v("--border"),
    surface: v("--surface"),
  };
}

const DAY_MS = 86_400_000;
const time = (s: RepLengthRun) => Date.parse(`${s.date}T00:00:00`);

function chartOption(runs: RepLengthRun[], c: ChartColors, showEfficiency: boolean): echarts.EChartsCoreOption {
  const complete = runs.filter((s) => s.complete);
  const incomplete = runs.filter((s) => !s.complete);
  const byTime = new Map(runs.map((s) => [time(s), s]));
  /** A chart point, ringed in red when the run was Over Target. */
  const point = (s: RepLengthRun, value: number) =>
    s.overTarget
      ? { value: [time(s), value], symbolSize: 11, itemStyle: { borderColor: c.overTarget, borderWidth: 3 } }
      : [time(s), value];
  const gapPoint = (s: RepLengthRun) => point(s, secondsPerMile(s.repGap!));
  const hrPoint = (s: RepLengthRun) => point(s, s.repHr!);
  const efficiencyPoint = (s: RepLengthRun) => [time(s), s.efficiency];
  const formatChanges = runs.filter((s) => s.formatChange !== null);
  /** A vertical line at each Format change across one grid, on a series of its own so the legend never hides it. */
  const formatChangeLines = (grid: number, labelled: boolean) => ({
    type: "line",
    xAxisIndex: grid,
    yAxisIndex: grid,
    data: [],
    markLine: {
      silent: true,
      symbol: "none",
      lineStyle: { color: c.muted, type: "solid", opacity: 0.6 },
      label: labelled ? { color: c.muted, fontSize: 11, formatter: "{b}", position: "end" } : { show: false },
      data: formatChanges.map((s) => ({ xAxis: time(s), name: formatChangeLabel(s) })),
    },
  });
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
    legend: {
      top: 0,
      right: 0,
      data: [
        "Complete",
        "Incomplete",
        ...(runs.some((s) => s.overTarget) ? ["Over Target"] : []),
        ...(showEfficiency ? ["Efficiency"] : []),
      ],
      formatter: (name: string) => (name === "Efficiency" ? "Efficiency m/beat" : name),
      selectedMode: false,
      textStyle: { color: c.muted },
      itemWidth: 14,
    },
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
      { left: 48, right: showEfficiency ? 48 : 16, top: 48, height: 130 },
      { left: 48, right: showEfficiency ? 48 : 16, top: 216, bottom: 28 },
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
      {
        gridIndex: 0,
        type: "value",
        show: showEfficiency,
        position: "right",
        scale: true,
        minInterval: 0.01,
        axisLabel: { ...axisLabel, formatter: (v: number) => v.toFixed(2) },
        splitLine: { show: false },
        splitNumber: 3,
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
          symbol: "none",
          cursor: "pointer",
          emphasis: { disabled: true },
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
      /** No points of its own: it puts the red ring that marks Over Target runs in the legend. */
      { name: "Over Target", type: "scatter", data: [], ...hollow(c.overTarget) },
      formatChangeLines(0, false),
      formatChangeLines(1, true),
      ...(showEfficiency
        ? [
            {
              name: "Efficiency",
              type: "line",
              xAxisIndex: 0,
              yAxisIndex: 2,
              data: complete.filter((s) => s.efficiency !== null).map(efficiencyPoint),
              color: c.efficiency,
              lineStyle: { width: 2, type: "dashed" },
              ...filled,
            },
            {
              name: "Efficiency",
              type: "scatter",
              xAxisIndex: 0,
              yAxisIndex: 2,
              data: incomplete.filter((s) => s.efficiency !== null).map(efficiencyPoint),
              color: c.efficiency,
              ...hollow(c.efficiency),
            },
          ]
        : []),
    ],
  };
}

/** A short marker for a Format change, e.g. "4→5 reps" or "rec 1:30→1:00". */
function formatChangeLabel(s: RepLengthRun): string {
  const from = s.formatChange!;
  const parts: string[] = [];
  if (from.reps !== null) parts.push(`${from.reps}→${s.format.reps} reps`);
  if (from.recovery !== null) parts.push(`rec ${formatDuration(from.recovery)}→${formatDuration(s.recovery!)}`);
  return parts.join(" · ");
}

function runTooltip(s: RepLengthRun | undefined): string {
  if (!s) return "";
  const lines = [
    `<strong>${formatDate(s.date)}</strong> · ${escapeHtml(s.plannedWorkoutName)}`,
    `${s.complete ? "Complete" : "Incomplete"} · ${s.repsRun}/${s.format.reps} Reps`,
  ];
  if (s.formatChange) {
    const reps = s.formatChange.reps ?? s.format.reps;
    const recovery = s.formatChange.recovery ?? s.recovery;
    lines.push(
      `Format changed: ${formatText(reps, s.format.repLength, recovery)} → ${formatText(s.format.reps, s.format.repLength, s.recovery)}`,
    );
  }
  if (s.repGap !== null) lines.push(`Rep GAP ${formatDuration(secondsPerMile(s.repGap))} /mi`);
  if (s.repHr !== null) lines.push(`Rep HR ${Math.round(s.repHr)} bpm`);
  if (s.overTarget) lines.push(`<span class="over-target">Over Target: a Rep averaged above ${s.hrCeiling} bpm</span>`);
  if (s.efficiency !== null) lines.push(`Efficiency ${s.efficiency.toFixed(2)} m/beat`);
  return lines.join("<br>");
}

function RunTable({ runs, onSelect }: { runs: RepLengthRun[]; onSelect: (run: RepLengthRun) => void }) {
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
              <td>
                <button type="button" className="link" onClick={() => onSelect(s)}>
                  {formatDate(s.date)}
                </button>
              </td>
              <td>{formatText(s.format.reps, s.format.repLength, s.recovery)}</td>
              <td>
                {s.repsRun}/{s.format.reps} {s.complete ? "Complete" : "Incomplete"}
              </td>
              <td>{s.repGap === null ? "–" : `${formatDuration(secondsPerMile(s.repGap))} /mi`}</td>
              <td>
                {s.repHr === null ? "–" : `${Math.round(s.repHr)} bpm`}
                {s.overTarget && <span className="over-target"> Over Target</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
