"use client";
// The research dock: a resizable analysis area along the bottom of the terrain (desktop) or below the panel (phones).
// Experiments keep their steps and verdict in the narrow panel and portal their charts, tables and downloads here,
// so the terrain, the reasoning and the data are visible together.
import { createContext, useContext, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

type DockCtxT = { head: HTMLElement | null; body: HTMLElement | null; setTitle: (t: string | null) => void; mobile: boolean };
export const DockCtx = createContext<DockCtxT>({ head: null, body: null, setTitle: () => {}, mobile: false });
export const useDock = () => useContext(DockCtx);

/** Render `children` into the dock body and `head` (downloads) into the dock bar while this component is mounted. */
export function DockPortal({ title, head, children }: { title: string; head?: ReactNode; children: ReactNode }) {
  const { head: h, body, setTitle } = useDock();
  useEffect(() => { setTitle(title); return () => setTitle(null); }, [title, setTitle]);
  return <>{h && head ? createPortal(head, h) : null}{body ? createPortal(children, body) : null}</>;
}

export type DockSize = "min" | "mid" | "max";
export function DockShell({ title, size, setSize, height, setHeight, maxH, desktop, right, setHead, setBody }: {
  title: string | null; size: DockSize; setSize: (s: DockSize) => void; height: number; setHeight: (h: number) => void; maxH: number;
  desktop: boolean; right: number; setHead: (e: HTMLElement | null) => void; setBody: (e: HTMLElement | null) => void;
}) {
  const drag = useRef<{ y0: number; h0: number } | null>(null);
  const MIN = 200;
  const clamp = (h: number) => Math.round(Math.max(MIN, Math.min(maxH, h)));
  const onKey = (e: KeyboardEvent) => {
    const d = { ArrowUp: 40, ArrowDown: -40, PageUp: 120, PageDown: -120 }[e.key];
    if (d != null) { e.preventDefault(); setSize("mid"); setHeight(clamp(height + d)); }
    else if (e.key === "Home") { e.preventDefault(); setSize("max"); }
    else if (e.key === "End") { e.preventDefault(); setSize("min"); }
  };
  const shown = size === "min" ? 0 : size === "max" ? maxH : height;
  return (
    <section className={`dock dock-${size}`} aria-label={title ? `Analysis: ${title}` : "Analysis"} hidden={!title} id="analysis"
      style={desktop ? { right, height: size === "min" ? undefined : shown } : undefined}>
      <div className="dock-bar">
        {desktop && (
          <div className="dock-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the analysis area"
            aria-valuemin={0} aria-valuemax={maxH} aria-valuenow={shown} tabIndex={0} onKeyDown={onKey}
            onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { y0: e.clientY, h0: shown || MIN }; if (size !== "mid") setSize("mid"); }}
            onPointerMove={(e) => { if (drag.current) setHeight(clamp(drag.current.h0 + drag.current.y0 - e.clientY)); }}
            onPointerUp={() => { drag.current = null; }} />)}
        <h2 className="dock-title">{title}</h2>
        <div className="dock-head" ref={setHead} />
        <div className="seg dock-size" role="group" aria-label="Analysis area size">
          {((desktop ? [["min", "Collapse"], ["mid", "Split"], ["max", "Expand"]] : [["min", "Hide"], ["mid", "Show"]]) as [DockSize, string][]).map(([k, l]) => (
            <button key={k} aria-pressed={size === k || (!desktop && k === "mid" && size === "max")} onClick={() => setSize(k)}>{l}</button>))}
        </div>
      </div>
      <div className="dock-body" ref={setBody} hidden={size === "min"} />
    </section>
  );
}
