import React, { useEffect, useRef } from "react";
import * as echarts from "echarts";

// Thin React wrapper around Apache ECharts: init on mount, setOption on change,
// auto-resize with the container, and clean up on unmount. `onEvents` is a map of
// echarts event name → handler (e.g. { click: (p) => ... }).
export default function EChart({ option, height = 300, className, style, onEvents, notMerge = true }) {
  const elRef = useRef(null);
  const chartRef = useRef(null);
  const eventsRef = useRef(onEvents);
  eventsRef.current = onEvents;

  useEffect(() => {
    const chart = echarts.init(elRef.current, null, { renderer: "canvas" });
    chartRef.current = chart;

    // The container width changes on EVERY frame of the sidebar collapse animation,
    // which would re-render the whole canvas ~13x in 220ms (the main cause of the
    // lag). Coalesce those bursts into a single resize once the width settles.
    let timer = 0, raf = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => chartRef.current && chartRef.current.resize());
      }, 80);
    });
    ro.observe(elRef.current);
    return () => {
      clearTimeout(timer); cancelAnimationFrame(raf);
      ro.disconnect(); chart.dispose(); chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current && option) chartRef.current.setOption(option, notMerge);
  }, [option, notMerge]);

  // (re)bind events whenever the handler map identity changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;
    const entries = Object.entries(onEvents);
    entries.forEach(([ev, fn]) => chart.on(ev, fn));
    return () => entries.forEach(([ev]) => chart.off(ev));
  }, [onEvents]);

  return <div ref={elRef} className={className} style={{ width: "100%", height, minWidth: 0, ...style }} />;
}
