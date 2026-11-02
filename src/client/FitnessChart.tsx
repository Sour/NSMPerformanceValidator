import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkAreaComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import {
  FITNESS_DAYS,
  FITNESS_RANGES,
  FORM_ZONE_FLOORS,
  FORM_ZONES,
  type FitnessDay,
  type FitnessRange,
  type FormZone,
  type FormZoneCount,
} from "../domain/fitness";
import { addDays } from "../domain/localDate";
import { formatDate } from "./format";
import { usePrefersDark } from "./usePrefersDark";

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, MarkAreaComponent, TooltipComponent, SVGRenderer]);

const RANGE_LABELS: Record<FitnessRange, string> = {
  "1m": "1 month",
  "6w": "42 days",
  "3m": "3 months",
  "6m": "6 months",
  "1y": "1 year",
};

/** Settling days are drawn at this opacity. */
const SETTLING_OPACITY = 0.35;

/**
 * Fitness: Fitness, Fatigue and Form as lines over the chosen range, in front of the Form Zones, above a bar per day of
 * that day's Training Load, with today's planned share drawn as planned, days holding workouts without heart rate
 * marked and the settling start of history faded.
 */
export function FitnessChart({
  days,
  formZones,
  range,
  onRange,
}: {
  days: FitnessDay[];
  formZones: FormZoneCount;
  range: FitnessRange;
  onRange: (range: FitnessRange) => void;
}) {
  const latest = days.at(-1);
  const withoutHeartRate = days.reduce((sum, d) => sum + d.withoutHeartRate, 0);
  const lastSettling = days.findLast((d) => d.settling);
  return (
    <section className="fitness">
      <div className="fitness-header">
        {latest ? (
          <p className="fitness-headline">
            Fitness <strong>{Math.round(latest.fitness)}</strong> · Fatigue <strong>{Math.round(latest.fatigue)}</strong> · Form{" "}
            <strong>{formatForm(latest.form)}</strong> · {latest.formZone}
            {latest.plannedTrainingLoad > 0 && <span className="fitness-planned"> includes today's plan</span>}
          </p>
        ) : (
          <span />
        )}
        <div className="fitness-controls">
          {formZones.counted > 0 && (
            <span className="fitness-optimal" title={FORM_ZONES.map((z) => `${z} ${formZones.days[z]}`).join(" · ")}>
              Optimal <strong>{formZones.days.Optimal}</strong> of {formZones.counted} days
            </span>
          )}
          <div className="presets" role="group" aria-label="Range">
            {(Object.keys(FITNESS_RANGES) as FitnessRange[]).map((r) => (
              <button key={r} type="button" aria-pressed={r === range} onClick={() => onRange(r)}>
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {latest ? <FitnessLines days={days} /> : <p className="rest">No Fitness yet: it needs synced workouts</p>}
      {lastSettling && (
        <p className="note">
          Settling until {formatDate(addDays(lastSettling.date, 1))}: Fitness starts from zero when stored history does, so the
          first {FITNESS_DAYS} days (faded) rise without any real gain in fitness.
        </p>
      )}
      {withoutHeartRate > 0 && (
        <p className="note">
          <span className="no-hr-marker">▲</span> {workoutCount(withoutHeartRate)} without heart rate in this range add no Training
          Load, so Fitness reads low.
        </p>
      )}
    </section>
  );
}

function workoutCount(n: number): string {
  return `${n} workout${n === 1 ? "" : "s"}`;
}

function formatForm(form: number): string {
  const rounded = Math.round(form);
  return rounded < 0 ? `−${-rounded}` : String(rounded);
}

function FitnessLines({ days }: { days: FitnessDay[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = usePrefersDark();

  useEffect(() => {
    const el = ref.current!;
    const chart = echarts.init(el, null, { renderer: "svg" });
    chart.setOption(chartOption(days, chartColors()));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [days, dark]);

  return <div ref={ref} className="fitness-chart" />;
}

const LINES = ["Fitness", "Fatigue", "Form"] as const;
type Line = (typeof LINES)[number];
const value = (d: FitnessDay, line: Line) => (line === "Fitness" ? d.fitness : line === "Fatigue" ? d.fatigue : d.form);

const TRAINING_LOAD = "Training Load";
const PLANNED = "Planned";
const NO_HR = "Without heart rate";

/** Each Form Zone's band on the Form axis; Form is judged rounded, so each boundary sits halfway between whole numbers. */
const zoneBand = (zone: FormZone): [low: number, high: number] => {
  const above = FORM_ZONES[FORM_ZONES.indexOf(zone) - 1];
  return [FORM_ZONE_FLOORS[zone] - 0.5, above === undefined ? Infinity : FORM_ZONE_FLOORS[above] - 0.5];
};
/** Zone bands are drawn at this opacity, Optimal's a little stronger. */
const ZONE_OPACITY = 0.07;
const OPTIMAL_OPACITY = 0.16;

interface ChartColors {
  lines: Record<Line, string>;
  zones: Record<FormZone, string>;
  load: string;
  noHr: string;
  text: string;
  muted: string;
  grid: string;
  surface: string;
}

function chartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    lines: { Fitness: v("--series-1"), Fatigue: v("--series-2"), Form: v("--series-3") },
    zones: {
      Transition: v("--series-2"),
      Fresh: v("--series-1"),
      "Grey Zone": v("--muted"),
      Optimal: v("--matched"),
      "High Risk": v("--missed"),
    },
    load: v("--muted"),
    noHr: v("--missed"),
    text: v("--text"),
    muted: v("--muted"),
    grid: v("--border"),
    surface: v("--surface"),
  };
}

function chartOption(days: FitnessDay[], c: ChartColors): echarts.EChartsCoreOption {
  const dates = days.map((d) => d.date);
  const axisLabel = { color: c.muted, fontSize: 11 };
  const settlingTo = days.findLastIndex((d) => d.settling);
  // A settling day's value on the faded line; the settled line starts from the last settling day so the two join.
  const settlingData = (line: Line) => days.map((d, i) => (i <= settlingTo ? round(value(d, line)) : null));
  const settledData = (line: Line) => days.map((d, i) => (i >= settlingTo ? round(value(d, line)) : null));
  const settlingArea =
    settlingTo < 0
      ? undefined
      : {
          silent: true,
          itemStyle: { color: c.grid, opacity: 0.5 },
          label: { show: true, position: "insideTop", formatter: "settling", color: c.muted, fontSize: 11 },
          data: [[{ xAxis: dates[0] }, { xAxis: dates[settlingTo] }]],
        };
  const xAxis = (grid: number) => ({
    type: "category",
    gridIndex: grid,
    data: dates,
    boundaryGap: true,
    axisLabel: { ...axisLabel, show: grid === 1, hideOverlap: true, formatter: (d: string) => formatDate(d) },
    axisLine: { lineStyle: { color: c.grid } },
    axisTick: { show: false },
  });
  // The Form Zone bands span the axis, which is fixed to whole tens around the lines so the bands can be clipped to it.
  const values = days.flatMap((d) => LINES.map((line) => value(d, line)));
  const axisMin = Math.floor(Math.min(0, ...values) / 10) * 10;
  const axisMax = Math.ceil(Math.max(0, ...values) / 10) * 10;
  const zoneBands = {
    silent: true,
    data: FORM_ZONES.flatMap((zone) => {
      const [bandLow, bandHigh] = zoneBand(zone);
      const low = Math.max(bandLow, axisMin);
      const high = Math.min(bandHigh, axisMax);
      if (low >= high) return [];
      const opacity = zone === "Optimal" ? OPTIMAL_OPACITY : ZONE_OPACITY;
      const label = { show: true, position: "insideTopRight", formatter: zone, color: c.muted, fontSize: 10 };
      return [[{ yAxis: low, itemStyle: { color: c.zones[zone], opacity }, label }, { yAxis: high }]];
    }),
  };
  const lineSeries = (line: Line, settling: boolean) => ({
    type: "line",
    name: line,
    xAxisIndex: 0,
    yAxisIndex: 0,
    color: c.lines[line],
    symbol: "none",
    lineStyle: { width: line === "Form" ? 1.5 : 2, opacity: settling ? SETTLING_OPACITY : 1 },
    emphasis: { disabled: true },
    data: settling ? settlingData(line) : settledData(line),
  });

  return {
    animation: false,
    textStyle: { fontFamily: "system-ui, sans-serif" },
    legend: {
      top: 0,
      left: 0,
      data: [
        ...LINES,
        TRAINING_LOAD,
        ...(days.some((d) => d.plannedTrainingLoad > 0) ? [PLANNED] : []),
        ...(days.some((d) => d.withoutHeartRate > 0) ? [NO_HR] : []),
      ],
      selectedMode: false,
      textStyle: { color: c.muted },
      itemWidth: 14,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: c.grid } },
      backgroundColor: c.surface,
      borderColor: c.grid,
      textStyle: { color: c.text },
      formatter: (params: { dataIndex: number }[]) => dayTooltip(days[params[0]!.dataIndex]!, c),
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: 40, right: 16, top: 40, bottom: 120 },
      { left: 40, right: 16, height: 64, bottom: 28 },
    ],
    xAxis: [xAxis(0), xAxis(1)],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        min: axisMin,
        max: axisMax,
        axisLabel,
        splitLine: { lineStyle: { color: c.grid } },
        splitNumber: 4,
      },
      { type: "value", gridIndex: 1, axisLabel, splitLine: { show: false }, splitNumber: 2 },
    ],
    series: [
      ...LINES.flatMap((line, i) => [
        { ...lineSeries(line, true), ...(i === 0 && settlingArea && { markArea: settlingArea }) },
        { ...lineSeries(line, false), ...(line === "Form" && { markArea: zoneBands }) },
      ]),
      {
        type: "bar",
        name: TRAINING_LOAD,
        xAxisIndex: 1,
        yAxisIndex: 1,
        stack: "load",
        color: c.load,
        barMaxWidth: 8,
        emphasis: { disabled: true },
        ...(settlingArea && { markArea: { ...settlingArea, label: { show: false } } }),
        data: days.map((d) => ({
          value: round(d.trainingLoad - d.plannedTrainingLoad),
          itemStyle: { opacity: d.settling ? SETTLING_OPACITY : 1 },
        })),
      },
      {
        type: "bar",
        name: PLANNED,
        xAxisIndex: 1,
        yAxisIndex: 1,
        stack: "load",
        color: c.load,
        barMaxWidth: 8,
        emphasis: { disabled: true },
        itemStyle: { color: "transparent", borderColor: c.load, borderWidth: 1, borderType: "dashed" },
        // None rather than 0 on days without a plan, so no empty outline is drawn there.
        data: days.map((d) => (d.plannedTrainingLoad > 0 ? round(d.plannedTrainingLoad) : null)),
      },
      {
        type: "scatter",
        name: NO_HR,
        xAxisIndex: 1,
        yAxisIndex: 1,
        color: c.noHr,
        symbol: "triangle",
        symbolSize: 9,
        symbolOffset: [0, -8],
        emphasis: { disabled: true },
        label: { show: true, position: "top", color: c.noHr, fontSize: 10, formatter: (p: { data: [string, number, number] }) => p.data[2] },
        data: days.filter((d) => d.withoutHeartRate > 0).map((d) => [d.date, round(d.trainingLoad), d.withoutHeartRate]),
      },
    ],
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function dayTooltip(day: FitnessDay, c: ChartColors): string {
  const swatch = (color: string) =>
    `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${color}"></span>`;
  return [
    `<strong>${formatDate(day.date, true)}</strong>${day.settling ? ` <span style="color:${c.muted}">· settling</span>` : ""}`,
    `<div>${swatch(c.lines.Fitness)}Fitness ${Math.round(day.fitness)}</div>`,
    `<div>${swatch(c.lines.Fatigue)}Fatigue ${Math.round(day.fatigue)}</div>`,
    `<div>${swatch(c.lines.Form)}Form ${formatForm(day.form)} · ${day.formZone}</div>`,
    `<div>${swatch(c.load)}Training Load ${Math.round(day.trainingLoad)}${
      day.plannedTrainingLoad > 0 ? ` (${Math.round(day.plannedTrainingLoad)} planned)` : ""
    }</div>`,
    day.withoutHeartRate > 0 ? `<div style="color:${c.noHr}">▲ ${workoutCount(day.withoutHeartRate)} without heart rate</div>` : "",
  ].join("");
}
