"use client";
// Shared research tools for the experiments: downloads (CSV and research package) and a data table linked to the terrain.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useScrollRowIntoView } from "./ResearchCharts";
import { BASE } from "@/lib/data";
import { packageZip, type DatasetId, type Software } from "@/lib/exports";

export function software(): Software {
  return { name: "MarsShield", version: process.env.NEXT_PUBLIC_VERSION ?? "dev", commit: process.env.NEXT_PUBLIC_COMMIT ?? "unknown",
    app_url: typeof window !== "undefined" ? window.location.origin + window.location.pathname : "" };
}

/** Identify the processed dataset by content: SHA-256 of the exact file the browser loaded. */
export async function datasetId(file: string, producer: string, generated_utc?: string): Promise<DatasetId> {
  const buf = await (await fetch(`${BASE}/data/${file}`)).arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { file: `data/${file}`, sha256: hash, generated_utc, producer };
}

export function saveFile(name: string, data: BlobPart, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

type Pkg = { observations: string; predictions: string; experiment: unknown; datapackage: unknown; readme: string; manifest?: string };
/** The source-file manifest (names, sizes, SHA-256, URLs) produced by the Python pipeline; added to every package. */
export async function inputManifest(): Promise<string | undefined> {
  try { const r = await fetch(`${BASE}/data/input_manifest.json`); return r.ok ? await r.text() : undefined; } catch { return undefined; }
}
export function DownloadBar({ name, rows, csv, pkg, note }: { name: string; rows: number; csv: () => string; pkg: () => Promise<Pkg>; note?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <div className="dl-bar" role="group" aria-label="Download this experiment's data">
      <div className="dl-actions">
        <button className="btn dl" onClick={() => saveFile(`marsshield-${name}-${stamp}.csv`, csv(), "text/csv;charset=utf-8")}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m-3.5-3.5L8 10l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          Data (CSV)</button>
        <button className="btn dl" disabled={busy} onClick={async () => {
          setBusy(true);
          try { saveFile(`marsshield-${name}-package-${stamp}.zip`, packageZip({ ...(await pkg()), manifest: await inputManifest() }) as BlobPart, "application/zip"); } finally { setBusy(false); }
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3z M10 2.5v3h3 M6 8h4M6 10.5h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          {busy ? "Preparing…" : "Research package (ZIP)"}</button>
      </div>
      <p className="dl-note">{rows} rows in your current selection{note ? <>; {note}</> : null}. The package adds predictions, settings, seeds, schema and sources.</p>
    </div>
  );
}

export type ColSpec<R> = { key: string; label: string; title?: string; render: (r: R) => ReactNode; num?: boolean; wide?: boolean };
/** A data grid whose rows select an item (and so a place on the terrain and in the chart). One tab stop: arrow keys move
 *  between rows, Home/End jump, Enter or Space selects. On phones the first 25 rows show, with "Show more". */
export function DataTable<R>({ rows, cols, id, selected, onSelect, caption, compact = false }: {
  rows: R[]; cols: ColSpec<R>[]; id: (r: R) => string; selected: string | null; onSelect: (r: R) => void; caption: string; compact?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(25);
  const selIndex = rows.findIndex((r) => id(r) === selected);
  const [active, setActive] = useState(Math.max(0, selIndex));
  useEffect(() => { if (selIndex >= 0) { setActive(selIndex); if (compact && selIndex >= limit) setLimit(selIndex + 10); } }, [selIndex, compact, limit]);
  useScrollRowIntoView(wrap, selected);
  const shown = compact ? rows.slice(0, limit) : rows;
  const focusRow = (i: number) => { const j = Math.max(0, Math.min(shown.length - 1, i)); setActive(j);
    wrap.current?.querySelector<HTMLElement>(`[data-i="${j}"]`)?.focus({ preventScroll: false }); };
  const key = (e: KeyboardEvent<HTMLTableRowElement>, i: number, r: R) => {
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[e.key];
    if (step != null) { e.preventDefault(); focusRow(i + step); }
    else if (e.key === "Home") { e.preventDefault(); focusRow(0); }
    else if (e.key === "End") { e.preventDefault(); focusRow(shown.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(r); }
  };
  return (<>
    <div className="dt-wrap" ref={wrap}>
      <table className="dt" role="grid" aria-label={caption} aria-rowcount={rows.length + 1}>
        <caption className="sr-only">{caption}. Arrow keys move between rows; Enter selects.</caption>
        <thead><tr>{cols.map((c) => <th key={c.key} title={c.title} scope="col" className={`${c.num ? "num" : ""}${c.wide ? " wide-only" : ""}`}>{c.label}</th>)}</tr></thead>
        <tbody>{shown.map((r, i) => {
          const k = id(r);
          return <tr key={k} data-row={k} data-i={i} aria-selected={k === selected} aria-rowindex={i + 2} tabIndex={i === Math.min(active, shown.length - 1) ? 0 : -1}
            onClick={() => { setActive(i); onSelect(r); }} onKeyDown={(e) => key(e, i, r)}>
            {cols.map((c) => <td key={c.key} className={`${c.num ? "num" : ""}${c.wide ? " wide-only" : ""}`}>{c.render(r)}</td>)}</tr>;
        })}</tbody>
      </table>
    </div>
    {compact && rows.length > shown.length && (
      <button className="btn show-more" onClick={() => setLimit(limit + 50)}>Show {Math.min(50, rows.length - shown.length)} more of {rows.length - shown.length} remaining rows</button>)}
  </>);
}
