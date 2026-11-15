"use client";
// Shared research tools for the experiments: downloads (CSV and research package) and a data table linked to the terrain.
import { useState, type ReactNode } from "react";
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

type Pkg = { observations: string; predictions: string; experiment: unknown; datapackage: unknown; readme: string };
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
          try { saveFile(`marsshield-${name}-package-${stamp}.zip`, packageZip(await pkg()) as BlobPart, "application/zip"); } finally { setBusy(false); }
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3z M10 2.5v3h3 M6 8h4M6 10.5h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          {busy ? "Preparing…" : "Research package (ZIP)"}</button>
      </div>
      <p className="dl-note">{rows} rows in your current selection{note ? <>; {note}</> : null}. The package adds predictions, settings, seeds, schema and sources.</p>
    </div>
  );
}

export type ColSpec<R> = { key: string; label: string; title?: string; render: (r: R) => ReactNode; num?: boolean; wide?: boolean };
/** A compact table whose rows select an item (and so a place on the terrain). Wide-only columns appear in the expanded view. */
export function DataTable<R>({ rows, cols, id, selected, onSelect, caption }: {
  rows: R[]; cols: ColSpec<R>[]; id: (r: R) => string; selected: string | null; onSelect: (r: R) => void; caption: string;
}) {
  return (
    <div className="dt-wrap" tabIndex={0} aria-label={caption}>
      <table className="dt">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{cols.map((c) => <th key={c.key} title={c.title} className={`${c.num ? "num" : ""}${c.wide ? " wide-only" : ""}`}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r) => {
          const k = id(r);
          return <tr key={k} aria-selected={k === selected} tabIndex={0} onClick={() => onSelect(r)} onKeyDown={(e) => e.key === "Enter" && onSelect(r)}>
            {cols.map((c) => <td key={c.key} className={`${c.num ? "num" : ""}${c.wide ? " wide-only" : ""}`}>{c.render(r)}</td>)}</tr>;
        })}</tbody>
      </table>
    </div>
  );
}
