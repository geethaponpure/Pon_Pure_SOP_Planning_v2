import React, { useEffect, useMemo, useRef, useState } from "react";
import { gantt as ganttSingleton, Gantt as GanttFactory } from "dhtmlx-gantt";
import "dhtmlx-gantt/codebase/dhtmlxgantt.css";
import { fmt } from "../api";

// Production calendar on DHTMLX Gantt Community edition (MIT). Equipment rows are
// project rows; each job is a child bar coloured by priority, dashed when the RM
// only arrives via lead time. A fresh instance is created per mount so React
// StrictMode's double-invoke can't collide with the library singleton.
const D = (s) => new Date(s + "T00:00:00");
const fmtD = (s) => D(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const tipText = (j) =>
  `${j.item}
${j.equipment} · ${j.scenario} · Priority ${j.priority}
`
  + `${fmt.num(j.qty)} kg · ${j.batches} batch(es) × ${fmt.num(j.batch_size)} kg · ${j.cycle_hrs}h/batch
`
  + `${fmtD(j.start)} → ${fmtD(j.end)}`
  + (j.rm_available ? " · RM in stock" : ` · RM via lead time ${j.lead_days}d`);

export default function ProductionGantt({ jobs, view, today, jcStart, prio }) {
  const todayTs = today ? D(today).getTime() : null;
  const jcTs = jcStart ? D(jcStart).getTime() : null;
  const elRef = useRef(null);
  const [err, setErr] = useState(null);

  const tasks = useMemo(() => {
    const byEq = {};
    jobs.forEach((j) => (byEq[j.equipment] = byEq[j.equipment] || []).push(j));
    const out = [];
    let id = 1;
    Object.keys(byEq).sort().forEach((eq) => {
      const pid = id++;
      // collapsed by default — the user expands an equipment to see its jobs
      out.push({ id: pid, text: eq, type: "project", open: false });
      byEq[eq]
        .slice()
        .sort((a, b) => (a.start < b.start ? -1 : 1))
        .forEach((j) => out.push({
          id: id++, parent: pid, text: j.item,
          start_date: j.start, end_date: j.end,
          color: (prio && prio[j.priority] ? prio[j.priority].c : "#888"),
          progress: 0, job: j,
        }));
    });
    return out;
  }, [jobs, prio]);

  useEffect(() => {
    const el = elRef.current;
    if (!el || !tasks.length) return undefined;
    let g = null;
    try {
      g = GanttFactory && GanttFactory.getGanttInstance ? GanttFactory.getGanttInstance() : ganttSingleton;
      // NOTE: the marker extension is Pro-only, so addMarker() does not exist in the
      // MIT Community build. Today / JC-start are drawn as tinted timeline columns
      // via the core timeline_cell_class + scale_cell_class templates instead.
      if (typeof g.plugins === "function") g.plugins({ tooltip: true });
      Object.assign(g.config, {
        date_format: "%Y-%m-%d",
        readonly: true,
        row_height: 32,
        bar_height: 20,
        scale_height: 54,
        min_column_width: view === "week" ? 34 : 56,
        open_tree_initially: false,
        columns: [{ name: "text", label: "Equipment / Vessel", tree: true, width: 210, resize: true }],
        scales: view === "week"
          ? [{ unit: "month", step: 1, format: "%F %Y" }, { unit: "day", step: 1, format: "%d" }]
          : [{ unit: "month", step: 1, format: "%F %Y" }, { unit: "week", step: 1, format: "%d %M" }],
      });
      g.templates.task_class = (s, e, t) => (t.job && !t.job.rm_available ? "rm-lead" : "");
      // native title= as well, so hover details work even if the tooltip ext is absent
      g.templates.task_text = (s, e, t) => {
        if (!t.job) return t.text;
        return `<span title="${esc(tipText(t.job))}">${t.job.batches}b · ${t.text}</span>`;
      };
      const stepMs = view === "week" ? 86400000 : 7 * 86400000;
      const inCell = (ts, cell) => ts != null && ts >= cell && ts < cell + stepMs;
      const colClass = (date) => {
        const c = date.getTime();
        return (inCell(todayTs, c) ? " pg-col-today" : "") + (inCell(jcTs, c) ? " pg-col-jc" : "");
      };
      g.templates.timeline_cell_class = (task, date) => colClass(date);
      g.templates.scale_cell_class = (date) => colClass(date);
      g.templates.tooltip_text = (s, e, t) => (t.job ? tipText(t.job).split(String.fromCharCode(10)).join("<br/>") : t.text);
      g.init(el);
      g.parse({ data: tasks, links: [] });
      setErr(null);
    } catch (e) {
      console.error("dhtmlx-gantt failed to render:", e);
      setErr(e && (e.message || String(e)));
    }
    return () => {
      try { if (g && g.destructor) g.destructor(); } catch (_) { /* already torn down */ }
      if (el) el.innerHTML = "";
    };
  }, [tasks, view, today, jcStart]);

  if (!tasks.length) return <div className="banner info">No scheduled jobs to plot.</div>;
  return (
    <>
      {err && <div className="banner warn">Calendar could not be drawn: {err}</div>}
      <div className="prod-gantt" ref={elRef} style={{ height: Math.min(620, tasks.length * 32 + 90) }} />
    </>
  );
}
