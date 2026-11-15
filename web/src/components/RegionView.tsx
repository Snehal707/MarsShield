"use client";
// Regions beyond Gale: a global Mars overview (MOLA) and regional terrain views (Jezero, Olympus Mons) built from the
// regional manifests. Terrain only: radiation tools stay in Gale, where Curiosity's RAD measurements exist.
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { layerUrl, loadRegion, nearestLocal, profileLine, profileSlope, sampleGlobal, sampleLocal, type Capability, type Region, type RegionIndex, type Status } from "@/lib/regions";
import { DockPortal } from "./Dock";
import { ProfileChart } from "./ResearchCharts";
import { More, Seg } from "./ui";

const STATUS_LABEL: Record<Status, string> = { validated: "Validated", exploratory: "Exploratory model", unavailable: "Unavailable" };
const fmtM = (v: number) => `${Math.round(v).toLocaleString("en")} m`;
const fmtKm = (m: number) => (m >= 2000 ? `${(m / 1000).toFixed(m < 20000 ? 1 : 0)} km` : `${Math.round(m)} m`);

export function CapabilityMatrix({ caps, defs }: { caps: Capability[]; defs?: Record<Status, string> }) {
  return (
    <div className="caps">
      <table className="dt wrap caps-t">
        <caption className="sr-only">What this region supports</caption>
        <thead><tr><th scope="col">Capability</th><th scope="col">Status</th><th scope="col">Basis and limits</th></tr></thead>
        <tbody>{caps.map((c) => (
          <tr key={c.name}><td>{c.name}</td><td><span className={`cap cap-${c.status}`}>{STATUS_LABEL[c.status]}</span></td><td>{c.detail}</td></tr>))}</tbody>
      </table>
      {defs && <More label="What the three labels mean">
        <dl className="cap-defs">{(Object.keys(STATUS_LABEL) as Status[]).map((s) => <div key={s}><dt><span className={`cap cap-${s}`}>{STATUS_LABEL[s]}</span></dt><dd>{defs[s]}</dd></div>)}</dl>
      </More>}
    </div>
  );
}

function Sources({ reg }: { reg: Region }) {
  return (
    <More label="Sources and checks">
      <ul className="sources">{reg.m.sources.map((s) => <li key={s.name}><b>{s.name}</b>. {s.producer}. {s.role}. <a href={s.url} target="_blank" rel="noreferrer">{s.url.replace(/^https?:\/\//, "").slice(0, 60)}{s.url.length > 68 ? "…" : ""}</a></li>)}</ul>
      {(reg.m.checks ?? []).map((c) => (
        <div key={c.name} className="note"><p><b>{c.name}.</b> {checkText(c)}</p><p>{c.note}</p></div>))}
      <p className="muted small">Horizontal frame: {reg.m.frame.note}. Manifest generated {reg.m.generated_utc.slice(0, 10)}.</p>
    </More>
  );
}
function checkText(c: Record<string, unknown>) {
  if (typeof c.median_m === "number") { const p = c.p05_p95_m as number[]; return `${c.n} waypoints: median ${c.median_m > 0 ? "+" : ""}${c.median_m} m, 5–95 % range ${p[0]} to ${p[1]} m.`; }
  if (typeof c.value_m === "number") return `Blend ${fmtM(c.value_m)} against ${fmtM(c.reference_m as number)} published (difference ${fmtM((c.value_m as number) - (c.reference_m as number))}).`;
  if (Array.isArray(c.rows)) return (c.rows as { name: string; min_m: number; max_m: number }[]).map((r) => `${r.name.replace(" floor", "")} ${fmtM(r.min_m)}–${fmtM(r.max_m)}`).join("; ") + ".";
  return "";
}

// ------------------------------------------------------------------ global overview
export function MarsOverview({ index, onOpen }: { index: RegionIndex; onOpen: (id: string) => void }) {
  const [reg, setReg] = useState<Region | null>(null);
  const [hover, setHover] = useState<{ lon: number; lat: number; z: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadRegion("mars").then(setReg).catch((e) => setErr(String(e))); }, []);
  const mars = index.regions.find((r) => r.id === "mars")!;
  const others = index.regions.filter((r) => r.id !== "mars");
  return (<>
    <section className="stage region-stage" aria-label="Elevation map of Mars">
      <div className="mars-map">
        {reg && <div className="mars-img" onMouseMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect(), lon = ((e.clientX - b.left) / b.width) * 360 - 180, lat = 90 - ((e.clientY - b.top) / b.height) * 180;
          setHover({ lon, lat, z: sampleGlobal(reg.elev, lon, lat) });
        }} onMouseLeave={() => setHover(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static export */}
          <img src={layerUrl("mars", reg.m.layers[0].file)} alt="Shaded elevation map of Mars from the MGS laser altimeter, 0 degrees longitude at the centre" />
          {others.map((r) => {
            const lon = (r.frame.lon[0] + r.frame.lon[1]) / 2, lat = (r.frame.lat[0] + r.frame.lat[1]) / 2;
            return <button key={r.id} className="mars-site" style={{ left: `${((lon + 180) / 360) * 100}%`, top: `${((90 - lat) / 180) * 100}%` }} onClick={() => onOpen(r.id)}>
              <i aria-hidden="true" /><span>{r.name}</span></button>;
          })}
        </div>}
        {!reg && !err && <p className="loading-inline">Loading the global elevation map (0.7 MB)…</p>}
        {err && <p className="err">{err}</p>}
        <p className="map-readout" aria-live="off">{hover && Number.isFinite(hover.z) ? <>{Math.abs(hover.lat).toFixed(1)}° {hover.lat >= 0 ? "N" : "S"}, {Math.abs(hover.lon).toFixed(1)}° {hover.lon >= 0 ? "E" : "W"}: <b>{fmtM(hover.z)}</b> (MOLA, 0.5° cell)</> : "Elevation relative to the Mars areoid; move over the map for values"}</p>
      </div>
    </section>
    <main id="panel" tabIndex={-1} className="panel region-panel">
      <div className="panel-head"><p className="kicker">Mars overview</p><h1 className="panel-title">Three places, three kinds of evidence</h1>
        <p className="sub">{mars.summary}</p></div>
      <div className="panel-body">
        <div className="region-cards">{others.map((r) => (
          <article key={r.id} className="region-card">
            <h2>{r.name}</h2><p>{r.summary}</p>
            <p className="cap-line">{(["validated", "exploratory", "unavailable"] as Status[]).map((s) => { const n = r.capabilities.filter((c) => c.status === s).length; return n ? <span key={s} className={`cap cap-${s}`}>{n} {STATUS_LABEL[s].toLowerCase()}</span> : null; })}</p>
            <button className="btn primary" onClick={() => onOpen(r.id)}>Open {r.name}{r.bytes ? ` (${(r.bytes / 1e6).toFixed(1)} MB)` : ""}</button>
          </article>))}</div>
        <h2 className="q">This map</h2>
        <CapabilityMatrix caps={mars.capabilities} defs={index.status_definitions} />
        {reg && <Sources reg={reg} />}
      </div>
    </main>
  </>);
}

// ------------------------------------------------------------------ regional 3D view
type Focus = { x: number; y: number; dist: number; n: number } | null;
const MAX_SIDE = 360;

function useRegionGeometry(reg: Region, exag: number) {
  return useMemo(() => {
    const g = reg.elev, s = Math.max(1, Math.ceil(Math.max(g.w, g.h) / MAX_SIDE));
    const nx = Math.ceil(g.w / s), ny = Math.ceil(g.h / s);
    const xc = g.x0! + (g.w * g.dx!) / 2, yc = g.y0! - (g.h * g.dy!) / 2, zmin = reg.m.elevation_range_m[0];
    const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
    for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
      const r = Math.min(i * s, g.h - 1), c = Math.min(j * s, g.w - 1), k = i * nx + j, z = g.data[r * g.w + c];
      pos[3 * k] = g.x0! + (c + 0.5) * g.dx! - xc; pos[3 * k + 2] = -(g.y0! - (r + 0.5) * g.dy! - yc); pos[3 * k + 1] = Number.isFinite(z) ? (z - zmin) * exag : 0;
      uv[2 * k] = (c + 0.5) / g.w; uv[2 * k + 1] = 1 - (r + 0.5) / g.h;
    }
    const idx: number[] = [];
    for (let i = 0; i < ny - 1; i++) for (let j = 0; j < nx - 1; j++) { const a = i * nx + j; idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const toScene = (x: number, y: number, lift = 0) => { const z = sampleLocal(g, g, x, y); return new THREE.Vector3(x - xc, (Number.isFinite(z) ? z - zmin : 0) * exag + lift, -(y - yc)); };
    const toLocal = (p: THREE.Vector3) => [p.x + xc, -p.z + yc] as [number, number];
    return { geo, toScene, toLocal, size: Math.max(g.w * g.dx!, g.h * g.dy!) };
  }, [reg, exag]);
}

function Terrain({ reg, layer, exag, onHover, onClick }: { reg: Region; layer: string; exag: number; onHover: (xy: [number, number] | null) => void; onClick: (xy: [number, number]) => void }) {
  const { geo, toLocal } = useRegionGeometry(reg, exag);
  const lay = reg.m.layers.find((l) => l.id === layer) ?? reg.m.layers[0];
  const tex = useLoader(THREE.TextureLoader, layerUrl(reg.m.id, lay.file));
  useEffect(() => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.needsUpdate = true; }, [tex]);
  return (
    <mesh geometry={geo} onPointerMove={(e: ThreeEvent<PointerEvent>) => onHover(toLocal(e.point))} onPointerOut={() => onHover(null)}
      onClick={(e: ThreeEvent<MouseEvent>) => { if (e.delta < 4) onClick(toLocal(e.point)); }}>
      <meshBasicMaterial map={tex} side={THREE.DoubleSide} />
    </mesh>
  );
}

function CameraRig({ focus, reg, exag }: { focus: Focus; reg: Region; exag: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const { toScene } = useRegionGeometry(reg, exag);
  useEffect(() => {
    if (!focus || !controls) return;
    const t = toScene(focus.x, focus.y), dir = camera.position.clone().sub(controls.target).normalize();
    if (dir.y < 0.35) { dir.y = 0.6; dir.normalize(); }
    const p0 = camera.position.clone(), t0 = controls.target.clone(), p1 = t.clone().add(dir.multiplyScalar(focus.dist)), start = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const step = () => {
      const k = reduce ? 1 : Math.min(1, (performance.now() - start) / 900), e = 1 - (1 - k) ** 3;
      camera.position.lerpVectors(p0, p1, e); controls.target.lerpVectors(t0, t, e); controls.update();
      if (k < 1) raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [focus, controls, camera, toScene]);
  return null;
}

function Overlays({ reg, exag, sel, profile, hoverPt, drawA }: { reg: Region; exag: number; sel: string | null;
  profile: { a: [number, number]; b: [number, number] } | null; hoverPt: [number, number] | null; drawA: [number, number] | null }) {
  const { toScene, size } = useRegionGeometry(reg, exag);
  const lift = size * 0.002;
  const trav = useMemo(() => reg.m.traverse ? reg.m.traverse.xy.map(([x, y]) => toScene(x, y, lift)) : null, [reg, toScene, lift]);
  const prof = useMemo(() => profile ? Array.from({ length: 121 }, (_, k) => toScene(profile.a[0] + (k / 120) * (profile.b[0] - profile.a[0]), profile.a[1] + (k / 120) * (profile.b[1] - profile.a[1]), lift * 1.5)) : null, [profile, toScene, lift]);
  return (<>
    {trav && <Line points={trav} color="#e7b37d" lineWidth={2.2} depthTest={false} renderOrder={5} />}
    {prof && <Line points={prof} color="#7db3cb" lineWidth={3} depthTest={false} renderOrder={6} />}
    {(reg.m.landmarks ?? []).map((l) => { const p = toScene(l.x, l.y, lift * 4); const on = sel === l.name; return (
      <Html key={l.name} position={p} center zIndexRange={[3, 0]}>
        <div className={`pin${on ? " sel" : ""}`} aria-hidden="true" data-sel={on ? "1" : undefined} style={{ width: on ? 16 : 11, height: on ? 16 : 11, background: l.kind === "rover" ? "#e7b37d" : l.kind === "unit" ? "#efe6d8" : "#b9ab97" }}>
          <span className="pin-label">{l.name}</span></div>
      </Html>); })}
    {drawA && <Html position={toScene(drawA[0], drawA[1], lift * 2)} center><div className="pin sel" aria-hidden="true" style={{ width: 12, height: 12, background: "#7db3cb" }}><span className="pin-label">A</span></div></Html>}
    {hoverPt && <Html position={toScene(hoverPt[0], hoverPt[1], lift * 2)} center><div className="pin" aria-hidden="true" style={{ width: 10, height: 10, background: "#7db3cb" }} /></Html>}
  </>);
}

type Prof = { name: string; a: [number, number]; b: [number, number]; kind: "line" } | { name: string; kind: "traverse" };

export function RegionalView({ id, index, onOpen, desktop }: { id: string; index: RegionIndex; onOpen: (id: string) => void; desktop: boolean }) {
  const [reg, setReg] = useState<Region | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const summary = index.regions.find((r) => r.id === id)!;
  const [layer, setLayer] = useState("relief");
  const [exag, setExag] = useState(id === "olympus" ? 3 : 2);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [prof, setProf] = useState<Prof | null>(null);
  const [draw, setDraw] = useState(false);
  const [drawA, setDrawA] = useState<[number, number] | null>(null);
  const [profHover, setProfHover] = useState<number | null>(null);
  useEffect(() => {
    let live = true; const t0 = performance.now();
    setReg(null); setErr(null); setProf(null); setSel(null); setLayer("relief"); setExag(id === "olympus" ? 3 : 2);
    loadRegion(id).then((r) => { if (live) { setReg(r); setLoadMs(performance.now() - t0); } }).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [id]);
  const profile = useMemo(() => {
    if (!reg || !prof) return null;
    if (prof.kind === "line") { const p = profileLine(reg, prof.a, prof.b); return { ...p, line: { a: prof.a, b: prof.b }, points: undefined as { d: number; z: number }[] | undefined }; }
    const wp = reg.m.traverse!.waypoints, d: number[] = [], z: number[] = [], pts: { d: number; z: number }[] = [];
    let acc = 0;
    wp.forEach((w, i) => { if (i) acc += Math.hypot(w[0] - wp[i - 1][0], w[1] - wp[i - 1][1]); d.push(acc); z.push(sampleLocal(reg.elev, reg.elev, w[0], w[1])); if (w[2] != null) pts.push({ d: acc, z: w[2] }); });
    return { d, z, step: NaN, L: acc, line: null, points: pts };
  }, [reg, prof]);
  const hoverXY: [number, number] | null = useMemo(() => {
    if (!profile || profHover == null || !reg) return null;
    if (prof?.kind === "traverse") { const w = reg.m.traverse!.waypoints[profHover]; return w ? [w[0], w[1]] : null; }
    const l = profile.line!, t = profile.d[profHover] / profile.L;
    return [l.a[0] + t * (l.b[0] - l.a[0]), l.a[1] + t * (l.b[1] - l.a[1])];
  }, [profile, profHover, reg, prof]);

  const readout = useMemo(() => {
    if (!reg || !hover) return null;
    const z = sampleLocal(reg.elev, reg.elev, hover[0], hover[1]);
    if (!Number.isFinite(z)) return null;
    const s = reg.aux.slope ? sampleLocal(reg.aux.slope, reg.elev, hover[0], hover[1]) : NaN;
    const sky = reg.aux.sky ? sampleLocal(reg.aux.sky, reg.elev, hover[0], hover[1]) : NaN;
    const u = reg.aux.units ? nearestLocal(reg.aux.units, reg.elev, hover[0], hover[1]) : NaN;
    const unit = Number.isFinite(u) && u > 0 ? reg.m.aux!.units.codes![u - 1] : null;
    const leg = reg.m.layers.find((l) => l.legend)?.legend?.find((q) => q.id === unit);
    return { z, s, sky, unit: leg ? `${leg.id}, ${leg.name}` : null };
  }, [reg, hover]);
  const onTerrainClick = (xy: [number, number]) => {
    if (!draw) return;
    if (!drawA) { setDrawA(xy); return; }
    setProf({ name: "Your profile", kind: "line", a: drawA, b: xy }); setDrawA(null); setDraw(false);
  };
  const lay = reg?.m.layers.find((l) => l.id === layer);
  const ps = profile && prof?.kind === "line" ? profileSlope(profile) : null;

  return (<>
    <section className="stage region-stage" aria-label={`3D terrain of ${summary.name}`}>
      {reg ? (
        <Canvas camera={{ fov: 40, near: 20, far: 2e6, position: [0, reg.elev.h * reg.elev.dy! * 0.75, reg.elev.h * reg.elev.dy! * 0.75] }} dpr={[1, 2]}
          aria-label={`3D terrain of ${summary.name}; use the panel to move between landmarks and to draw profiles`} style={{ cursor: draw ? "crosshair" : undefined }}>
          <color attach="background" args={["#171310"]} />
          <Suspense fallback={null}>
            <Terrain reg={reg} layer={layer} exag={exag} onHover={setHover} onClick={onTerrainClick} />
          </Suspense>
          <Overlays reg={reg} exag={exag} sel={sel} profile={profile?.line ?? null} hoverPt={hoverXY} drawA={drawA} />
          <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.47} minDistance={500} maxDistance={reg.elev.h * reg.elev.dy! * 3} />
          <CameraRig focus={focus} reg={reg} exag={exag} />
        </Canvas>
      ) : <p className="loading-inline">{err ?? `Loading ${summary.name} (${((summary.bytes ?? 0) / 1e6).toFixed(1)} MB)…`}</p>}
      {reg && <div className="region-legend mapcard" aria-live="off">
        <b>{lay?.name}</b>
        {lay?.ramp && <div className="mini-ramp"><i style={{ background: `linear-gradient(90deg, ${lay.ramp.stops.map((c) => `rgb(${c.join(",")})`).join(",")})` }} /><span>{lay.ramp.lo}</span><span>{lay.ramp.hi}</span></div>}
        {lay?.note && <span className="muted small">{lay.note}</span>}
        <span className="muted small">{readout ? <>Under the cursor: <b>{fmtM(readout.z)}</b>{Number.isFinite(readout.s) ? `, slope ${readout.s.toFixed(0)}°` : ""}{Number.isFinite(readout.sky) ? `, sky blocked ${readout.sky.toFixed(0)} % (exploratory)` : ""}{readout.unit ? `, unit ${readout.unit}` : ""}</> : `Vertical exaggeration ×${exag}`}</span>
      </div>}
    </section>

    <main id="panel" tabIndex={-1} className="panel region-panel">
      <div className="panel-head">
        <button className="linklike small" onClick={() => onOpen("mars")}>Mars overview</button>
        <h1 className="panel-title" style={{ marginTop: 8 }}>{summary.name}</h1>
        <p className="sub">{summary.summary}</p>
      </div>
      <div className="panel-body">
        {reg && <p className="muted calc-time">Loaded {((summary.bytes ?? 0) / 1e6).toFixed(1)} MB in {Math.round(loadMs ?? 0)} ms; {reg.elev.w} × {reg.elev.h} elevation grid at {Math.round(reg.elev.dx!)}–{Math.round(reg.elev.dy!)} m.</p>}
        <section className="rg-sec" aria-labelledby="rg-cap"><h2 id="rg-cap" className="q">What this region supports</h2>
          <CapabilityMatrix caps={summary.capabilities} defs={index.status_definitions} /></section>
        {reg && (<>
          <section className="rg-sec" aria-labelledby="rg-layers"><h2 id="rg-layers" className="q">Map layer</h2>
            <div className="layer-list" role="radiogroup" aria-label="Map layer">
              {reg.m.layers.map((l) => <button key={l.id} role="radio" aria-checked={layer === l.id} onClick={() => setLayer(l.id)}><b>{l.name}</b><span>{l.note}</span></button>)}
            </div>
            {lay?.legend && <ul className="unit-legend">{lay.legend.map((u) => <li key={u.id}><i style={{ background: `rgb(${u.color.join(",")})` }} aria-hidden="true" /><b>{u.id}</b> {u.name}<span>{u.desc}</span></li>)}</ul>}
            <div className="row"><span className="muted">Vertical exaggeration</span><Seg label="Vertical exaggeration" value={exag} onChange={setExag} options={[[1, "×1"], [2, "×2"], [3, "×3"], [5, "×5"]]} /></div>
          </section>
          <section className="rg-sec" aria-labelledby="rg-lm"><h2 id="rg-lm" className="q">Landmarks</h2>
            <div className="lm-list">{(reg.m.landmarks ?? []).map((l) => (
              <button key={l.name} aria-pressed={sel === l.name} onClick={() => { setSel(l.name); setFocus((f) => ({ x: l.x, y: l.y, dist: reg.elev.h * reg.elev.dy! * 0.28, n: (f?.n ?? 0) + 1 })); }}>
                <b>{l.name}</b><span>{l.note}</span></button>))}</div>
            <button className="linklike small" onClick={() => { setSel(null); setFocus((f) => ({ x: reg.elev.x0! + (reg.elev.w * reg.elev.dx!) / 2, y: reg.elev.y0! - (reg.elev.h * reg.elev.dy!) / 2, dist: reg.elev.h * reg.elev.dy! * 1.05, n: (f?.n ?? 0) + 1 })); }}>Show the whole region</button>
          </section>
          <section className="rg-sec" aria-labelledby="rg-prof"><h2 id="rg-prof" className="q">Elevation profiles</h2>
            <div className="lm-list">
              {(reg.m.profiles ?? []).map((p) => <button key={p.name} aria-pressed={prof?.name === p.name} onClick={() => setProf({ ...p, kind: "line" })}><b>{p.name}</b></button>)}
              {reg.m.traverse && <button aria-pressed={prof?.kind === "traverse"} onClick={() => setProf({ name: "Along Perseverance's traverse", kind: "traverse" })}>
                <b>Along Perseverance&apos;s traverse</b><span>DTM elevation and the rover&apos;s own localized elevations, sols {reg.m.traverse.sol_range[0]}–{reg.m.traverse.sol_range[1]}</span></button>}
            </div>
            <button className="btn" aria-pressed={draw} onClick={() => { setDraw(!draw); setDrawA(null); }}>{draw ? (drawA ? "Click the end point on the terrain" : "Click the start point on the terrain") : "Draw your own profile"}</button>
            <p className="muted small">Profiles are sampled at the grid spacing ({Math.round(reg.elev.dy!)} m); slopes over shorter distances are not resolved.</p>
          </section>
          {id === "olympus" && reg.m.context && <figure className="ctx-fig">
            {/* eslint-disable-next-line @next/next/no-img-element -- static export */}
            <img src={layerUrl(id, reg.m.context.file)} alt="Shaded relief of the whole Olympus Mons volcano; the caldera map area is outlined" />
            <span className="ctx-box" style={{ left: `${((reg.m.frame.lon[0] - reg.m.context.lon[0]) / (reg.m.context.lon[1] - reg.m.context.lon[0])) * 100}%`, width: `${((reg.m.frame.lon[1] - reg.m.frame.lon[0]) / (reg.m.context.lon[1] - reg.m.context.lon[0])) * 100}%`,
              top: `${((reg.m.context.lat[1] - reg.m.frame.lat[1]) / (reg.m.context.lat[1] - reg.m.context.lat[0])) * 100}%`, height: `${((reg.m.frame.lat[1] - reg.m.frame.lat[0]) / (reg.m.context.lat[1] - reg.m.context.lat[0])) * 100}%` }} />
            <figcaption className="muted small">{reg.m.context.note}.</figcaption></figure>}
          <Sources reg={reg} />
        </>)}
      </div>
    </main>

    {reg && profile && prof && (
      <DockPortal title={`Elevation profile: ${prof.name}`}>
        <div className="dock-grid">
          <div className="dock-main">
            <ProfileChart d={profile.d} z={profile.z} points={profile.points} label={`${reg.m.sources[0].name.split(",")[0]}`} pointLabel="Rover-reported elevation" onHover={setProfHover} />
          </div>
          <div className="dock-side">
            <dl className="prof-stats">
              <div><dt>Length</dt><dd>{fmtKm(profile.L)}</dd></div>
              <div><dt>Elevation range</dt><dd>{fmtM(Math.min(...profile.z.filter(Number.isFinite)))} to {fmtM(Math.max(...profile.z.filter(Number.isFinite)))}</dd></div>
              {ps && <div><dt>Steepest step</dt><dd>{ps.max.toFixed(1)}° over {Math.round(profile.step)} m</dd></div>}
              {profile.points && <div><dt>Rover positions</dt><dd>{profile.points.length}</dd></div>}
            </dl>
            <p className="muted small">{prof.kind === "traverse"
              ? "Distance is the straight-line sum between localized waypoints, shorter than the distance driven. Rings are the rover's own localized elevations; the line is the DTM at the same positions."
              : "Sampled from the elevation grid by bilinear interpolation at the grid spacing. Walls and steps narrower than two grid cells are smoothed."}</p>
            {desktop && <p className="muted small">Move along the chart to see the position on the terrain.</p>}
          </div>
        </div>
      </DockPortal>
    )}
  </>);
}
