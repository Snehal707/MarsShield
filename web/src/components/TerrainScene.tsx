"use client";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Dataset, Sky, Stop } from "@/lib/data";
import { BASE, centre, mapToScene, sampleGrid, sceneToMap } from "@/lib/data";

export type Layer = "terrain" | "dose" | "sky" | "slope" | "image" | "disagree";
const LAYER_ID: Record<Layer, number> = { terrain: 0, dose: 1, sky: 2, slope: 3, image: 4, disagree: 5 };

export type SceneLine = { key: string; xy: [number, number][]; color: string; width: number; dashed?: boolean; opacity?: number; animate?: boolean };
export type ScenePin = { key: string; x: number; y: number; color: string; label?: string; size?: number; high?: boolean; selected?: boolean; onClick?: () => void };
export type Focus = { x: number; y: number; dist?: number; n: number } | null;

type Props = {
  ds: Dataset; layer: Layer; alpha: number; exaggeration: number; disagreeErrPP: number; disagreeRefPP: number; viewShiftPx?: number;
  lines?: SceneLine[]; pins?: ScenePin[]; sky?: Sky | null; ring?: { x: number; y: number; r: number } | null;
  showObs: boolean; onObsClick?: (s: Stop) => void; onObsHover?: (s: Stop | null, cx: number, cy: number) => void;
  onPinHover?: (key: string | null, cx: number, cy: number) => void;
  onPick: (x: number, y: number) => void; onHover: (p: { x: number; y: number } | null) => void; focus: Focus;
};

const vert = /* glsl */ `
  uniform vec4 uData; uniform vec4 uHill; uniform vec4 uOrtho;
  varying vec2 vData; varying vec2 vHill; varying vec2 vOrtho; varying float vH; varying vec3 vWorld;
  void main() {
    vData = vec2(position.x * uData.x + uData.y, position.z * uData.z + uData.w);
    vHill = vec2(position.x * uHill.x + uHill.y, position.z * uHill.z + uHill.w);
    vOrtho = vec2(position.x * uOrtho.x + uOrtho.y, position.z * uOrtho.z + uOrtho.w);
    vH = position.y;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */ `
  uniform sampler2D tData; uniform sampler2D tHill; uniform sampler2D tOrtho;
  uniform int uLayer; uniform float uAlpha; uniform vec2 uZ; uniform float uExag; uniform float uErr; uniform float uRef;
  varying vec2 vData; varying vec2 vHill; varying vec2 vOrtho; varying float vH; varying vec3 vWorld;

  vec3 terrain(float t) {   // basalt-to-dust ramp by elevation
    vec3 lo = vec3(0.30, 0.20, 0.14), mid = vec3(0.62, 0.42, 0.28), hi = vec3(0.80, 0.66, 0.52);
    return t < 0.5 ? mix(lo, mid, t * 2.0) : mix(mid, hi, (t - 0.5) * 2.0);
  }
  float iso(float v, float step, float w) {
    float f = abs(fract(v / step + 0.5) - 0.5) * step;
    return 1.0 - smoothstep(0.0, fwidth(v) * w, f);
  }
  void main() {
    vec4 D = texture2D(tData, vData);
    float hs = texture2D(tHill, vHill).r;
    float hn = clamp((hs - 0.45) / 0.4, 0.0, 1.0);
    float t = clamp((vH / uExag - uZ.x) / (uZ.y - uZ.x), 0.0, 1.0);
    vec3 base = terrain(t) * (0.32 + 0.9 * hn);
    vec3 col = base;
    float a = uAlpha / (1.0 - uAlpha);
    float rel = (D.r + (1.0 + D.g) * a) / (1.0 + a);
    if (uLayer == 1) {
      float s = sqrt(clamp((0.97 - rel) / 0.17, 0.0, 1.0));
      vec3 shade = mix(vec3(0.80, 0.86, 0.90), vec3(0.16, 0.36, 0.55), s);
      col = mix(base * 0.88, shade * (0.45 + 0.7 * hn), 0.10 + 0.78 * s);
    } else if (uLayer == 2) {
      float s = clamp(D.g / 0.5, 0.0, 1.0);
      col = mix(base * 0.8, mix(vec3(0.85), vec3(0.18, 0.24, 0.42), s) * (0.45 + 0.7 * hn), 0.3 + 0.55 * s);
    } else if (uLayer == 3) {
      col = base;
      if (D.b > 25.0) { float h = step(0.5, fract((vWorld.x + vWorld.z) / 6.0)); col = mix(base, vec3(0.85, 0.35, 0.15), 0.35 + 0.35 * h); }
      else if (D.b > 15.0) col = mix(base, vec3(0.90, 0.66, 0.23), 0.35);
    } else if (uLayer == 4) {
      float g = texture2D(tOrtho, vOrtho).r;
      col = vec3(g * 1.04, g * 0.97, g * 0.9);
    } else if (uLayer == 5) {
      // model disagreement in LOCAL CONTRAST: (model - proxy) here minus its median over the area, in rate points.
      // This is what a measurement against nearby ordinary ground can test (same detrending as the 322-stop analysis).
      float d = (rel - (1.0 - D.g)) * 100.0 - uRef;
      float s = clamp(d / (2.0 * uErr), 0.0, 1.0);
      vec3 g3 = vec3(0.28 + 0.5 * hn) * vec3(0.95, 0.92, 0.88);
      col = mix(g3, vec3(0.93, 0.63, 0.31) * (0.6 + 0.45 * hn), s);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

function useTerrainGeometry(ds: Dataset, exag: number) {
  return useMemo(() => {
    const [ny, nx] = ds.meta.shape;
    const step = 2;
    const my = Math.floor((ny - 1) / step) + 1, mx = Math.floor((nx - 1) / step) + 1;
    const pos = new Float32Array(my * mx * 3);
    let k = 0;
    for (let i = 0; i < my; i++) for (let j = 0; j < mx; j++) {
      const r = i * step, c = j * step;
      const { sx, sz } = mapToScene(ds.meta, ds.meta.x0 + c * ds.meta.res, ds.meta.y0 - r * ds.meta.res);
      pos[k++] = sx; pos[k++] = (ds.grids.height[r * nx + c] - ds.meta.zmin) * exag; pos[k++] = sz;
    }
    const idx = new Uint32Array((my - 1) * (mx - 1) * 6);
    k = 0;
    for (let i = 0; i < my - 1; i++) for (let j = 0; j < mx - 1; j++) {
      const a = i * mx + j, b = a + 1, c = a + mx, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }, [ds, exag]);
}

function useMaterial(ds: Dataset) {
  return useMemo(() => {
    const [ny, nx] = ds.meta.shape;
    const data = new Float32Array(nx * ny * 4);
    for (let i = 0; i < nx * ny; i++) { data[i * 4] = ds.grids.relSky[i]; data[i * 4 + 1] = ds.grids.B[i]; data[i * 4 + 2] = ds.grids.slope[i]; data[i * 4 + 3] = 1; }
    const tData = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat, THREE.FloatType);
    tData.magFilter = THREE.LinearFilter; tData.minFilter = THREE.LinearFilter; tData.needsUpdate = true;
    const tHill = new THREE.TextureLoader().load(`${BASE}/data/hillshade.png`);
    tHill.flipY = false; tHill.colorSpace = THREE.NoColorSpace; tHill.anisotropy = 8;
    const { cx, cy } = centre(ds.meta);
    const m = ds.meta;
    const uData = new THREE.Vector4(1 / m.res / nx, (cx - m.x0) / m.res / nx + 0.5 / nx, 1 / m.res / ny, (m.y0 - cy) / m.res / ny + 0.5 / ny);
    const [hh, hw] = m.hillshade_shape, hr = m.hillshade_res;
    const uHill = new THREE.Vector4(1 / hr / hw, (cx - m.hillshade_x0) / hr / hw + 0.5 / hw, 1 / hr / hh, (m.hillshade_y0 - cy) / hr / hh + 0.5 / hh);
    let tOrtho: THREE.Texture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    tOrtho.needsUpdate = true;
    let uOrtho = new THREE.Vector4(0, 0.5, 0, 0.5);
    if (ds.ortho) {
      const o = ds.ortho, [oh, ow] = o.shape;
      tOrtho = new THREE.TextureLoader().load(`${BASE}/data/ortho.jpg`);
      tOrtho.flipY = false; tOrtho.colorSpace = THREE.NoColorSpace; tOrtho.anisotropy = 8;
      uOrtho = new THREE.Vector4(1 / o.res / ow, (cx - o.x0) / o.res / ow + 0.5 / ow, 1 / o.res / oh, (o.y0 - cy) / o.res / oh + 0.5 / oh);
    }
    return new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: { tData: { value: tData }, tHill: { value: tHill }, tOrtho: { value: tOrtho }, uData: { value: uData }, uHill: { value: uHill },
        uOrtho: { value: uOrtho }, uLayer: { value: 1 }, uAlpha: { value: 0.21 }, uZ: { value: new THREE.Vector2(0, m.zmax - m.zmin) },
        uExag: { value: 1 }, uErr: { value: 5.24 }, uRef: { value: 0 } },
      extensions: { derivatives: true } as unknown as THREE.ShaderMaterial["extensions"],
    });
  }, [ds]);
}

function groundY(ds: Dataset, x: number, y: number, exag: number, lift = 0) {
  const z = sampleGrid(ds.meta, ds.grids.height, x, y);
  return (Number.isFinite(z) ? z - ds.meta.zmin : 0) * exag + lift;
}

function Terrain(p: Props) {
  const geom = useTerrainGeometry(p.ds, p.exaggeration);
  const mat = useMaterial(p.ds);
  useEffect(() => {
    mat.uniforms.uLayer.value = LAYER_ID[p.layer]; mat.uniforms.uAlpha.value = p.alpha;
    mat.uniforms.uExag.value = p.exaggeration; mat.uniforms.uErr.value = p.disagreeErrPP; mat.uniforms.uRef.value = p.disagreeRefPP;
  }, [mat, p.layer, p.alpha, p.exaggeration, p.disagreeErrPP, p.disagreeRefPP]);
  const last = useRef(0);
  const toMap = (e: ThreeEvent<PointerEvent | MouseEvent>) => sceneToMap(p.ds.meta, e.point.x, e.point.z);
  return (
    <mesh geometry={geom} material={mat}
      onClick={(e) => { e.stopPropagation(); if (e.delta > 4) return; const m = toMap(e); p.onPick(m.x, m.y); }}
      onPointerMove={(e) => { const now = performance.now(); if (now - last.current < 60) return; last.current = now; p.onHover(toMap(e)); }}
      onPointerOut={() => p.onHover(null)} />
  );
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// A route that draws itself from start to end when it changes (0.8 s), so a recalculation is visible.
function AnimatedLine({ ds, l, exag }: { ds: Dataset; l: SceneLine; exag: number }) {
  const pts = useMemo(() => l.xy.map(([x, y]) => { const q = mapToScene(ds.meta, x, y); return new THREE.Vector3(q.sx, groundY(ds, x, y, exag, 3), q.sz); }), [ds, l.xy, exag]);
  const [n, setN] = useState(l.animate && !reduced() ? 2 : pts.length);
  const t0 = useRef(0);
  useEffect(() => { t0.current = performance.now(); setN(l.animate && !reduced() ? 2 : pts.length); }, [pts, l.animate]);
  useFrame(() => {
    if (n >= pts.length) return;
    const f = Math.min(1, (performance.now() - t0.current) / 800);
    const k = Math.max(2, Math.round(2 + (pts.length - 2) * (1 - Math.pow(1 - f, 3))));
    if (k !== n) setN(k);
  });
  if (pts.length < 2) return null;
  return <Line points={pts.slice(0, n)} color={l.color} lineWidth={l.width} transparent opacity={l.opacity ?? 1}
    dashed={!!l.dashed} dashSize={10} gapSize={7} depthTest={false} renderOrder={10} />;
}

function SkyCurtain({ ds, sky, exag }: { ds: Dataset; sky: Sky; exag: number }) {
  const geo = useMemo(() => {
    const R = 70, n = sky.az.length, step = Math.max(1, Math.floor(n / 360));
    const pos: number[] = [], line: THREE.Vector3[] = [];
    const ring = (az: number, el: number) => {
      const a = (az * Math.PI) / 180, e = (Math.max(el, 0) * Math.PI) / 180;
      return new THREE.Vector3(R * Math.cos(e) * Math.sin(a), R * Math.sin(e), -R * Math.cos(e) * Math.cos(a));
    };
    for (let i = 0; i < n; i += step) {
      const j = (i + step) % n;
      const a0 = sky.az[i], a1 = sky.az[j] < a0 ? sky.az[j] + 360 : sky.az[j];
      const p00 = ring(a0, 0), p01 = ring(a0, sky.elev[i]), p10 = ring(a1, 0), p11 = ring(a1, sky.elev[j]);
      pos.push(...p00.toArray(), ...p01.toArray(), ...p10.toArray(), ...p10.toArray(), ...p01.toArray(), ...p11.toArray());
      line.push(p01);
    }
    line.push(line[0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return { g, line, rings: [30, 60].map((el) => Array.from({ length: 73 }, (_, k) => ring(k * 5, el))) };
  }, [sky]);
  const { sx, sz } = mapToScene(ds.meta, sky.x, sky.y);
  return (
    <group position={[sx, groundY(ds, sky.x, sky.y, exag, sky.h_obs), sz]}>
      <mesh geometry={geo.g} renderOrder={5}><meshBasicMaterial color="#1a1411" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <Line points={geo.line} color="#7db3cb" lineWidth={2} />
      {geo.rings.map((r, i) => <Line key={i} points={r} color="#efe6d8" lineWidth={0.6} transparent opacity={0.22} />)}
      <mesh><sphereGeometry args={[2.2, 16, 16]} /><meshBasicMaterial color="#ffffff" /></mesh>
    </group>
  );
}

// Labels of nearby targets (e.g. Mary Anning / Groken) would overprint: stack each one above earlier close neighbours.
function labelLift(pins: ScenePin[], i: number) {
  let n = 0;
  for (let j = 0; j < i; j++) if (pins[j].label && pins[i].label && Math.hypot(pins[j].x - pins[i].x, pins[j].y - pins[i].y) < 160) n++;
  return n;            // 1st neighbour: label below the marker; 2nd: stacked above, and so on
}

function Pin({ ds, pin, exag, onHover, lift = 0 }: { ds: Dataset; pin: ScenePin; exag: number; onHover?: Props["onPinHover"]; lift?: number }) {
  const { sx, sz } = mapToScene(ds.meta, pin.x, pin.y);
  const gy = groundY(ds, pin.x, pin.y, exag);
  const h = pin.high ? 30 : 16;
  // markers are screen-space (constant size at any camera distance); the stem stays in 3D so height reads correctly
  const px = Math.round((pin.size ?? (pin.selected ? 5.5 : 4)) * 3);
  const below = lift % 2 === 1, stack = below ? 0 : (lift / 2) * 17;
  return (
    <group position={[sx, gy, sz]}>
      <mesh position={[0, h / 2, 0]}><cylinderGeometry args={[0.6, 0.6, h, 6]} /><meshBasicMaterial color={pin.color} /></mesh>
      <Html position={[0, h, 0]} center zIndexRange={[3, 0]}>
        <div className={`pin${pin.selected ? " sel" : ""}${pin.onClick ? " click" : ""}`} style={{ width: px, height: px, background: pin.color }}
          role={pin.onClick ? "button" : undefined} aria-label={pin.onClick ? pin.label ?? pin.key : undefined} tabIndex={pin.onClick ? 0 : undefined}
          onClick={pin.onClick ? (e) => { e.stopPropagation(); pin.onClick!(); } : undefined}
          onKeyDown={pin.onClick ? (e) => { if (e.key === "Enter") pin.onClick!(); } : undefined}
          onMouseEnter={(e) => onHover?.(pin.key, e.clientX, e.clientY)} onMouseLeave={() => onHover?.(null, 0, 0)}>
          {pin.label && <span className={`pin-label${below ? " below" : ""}`} style={stack ? { bottom: `calc(100% + ${6 + stack}px)` } : undefined}>{pin.label}</span>}
        </div>
      </Html>
    </group>
  );
}

function ObservedStops({ ds, stops, exag, onClick, onHover }: { ds: Dataset; stops: Stop[]; exag: number; onClick?: (s: Stop) => void; onHover?: Props["onObsHover"] }) {
  const ref = useRef<THREE.InstancedMesh>(null), ringRef = useRef<THREE.InstancedMesh>(null), hitRef = useRef<THREE.InstancedMesh>(null);
  const valid = useMemo(() => stops.filter((s) => s.anomaly_obs != null && (s.data_sols ?? 0) >= 1), [stops]);
  useEffect(() => {
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const gray = new THREE.Color("#8f8373"), cold = new THREE.Color("#3987e5"), warm = new THREE.Color("#d95926");
    valid.forEach((s, i) => {
      const { sx, sz } = mapToScene(ds.meta, s.x, s.y);
      m.makeRotationX(-Math.PI / 2).setPosition(sx, groundY(ds, s.x, s.y, exag, 2.5), sz);
      ref.current?.setMatrixAt(i, m); ringRef.current?.setMatrixAt(i, m); hitRef.current?.setMatrixAt(i, m);
      const v = Math.max(-1, Math.min(1, (s.anomaly_obs as number) / 0.08));
      c.copy(gray).lerp(v < 0 ? cold : warm, Math.abs(v)); ref.current?.setColorAt(i, c);
    });
    for (const r of [ref, ringRef, hitRef]) if (r.current) { r.current.instanceMatrix.needsUpdate = true; r.current.computeBoundingSphere(); }
    if (ref.current?.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [valid, ds, exag]);
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, valid.length]} renderOrder={8}><circleGeometry args={[4.2, 20]} /><meshBasicMaterial depthTest={false} transparent /></instancedMesh>
      <instancedMesh ref={ringRef} args={[undefined, undefined, valid.length]} renderOrder={9}><ringGeometry args={[4.2, 6, 24]} /><meshBasicMaterial color="#f6f1e7" depthTest={false} transparent /></instancedMesh>
      <instancedMesh ref={hitRef} args={[undefined, undefined, valid.length]}
        onClick={(e) => { e.stopPropagation(); if (e.instanceId != null) onClick?.(valid[e.instanceId]); }}
        onPointerMove={(e) => { if (e.instanceId != null) { document.body.style.cursor = "pointer"; onHover?.(valid[e.instanceId], e.nativeEvent.clientX, e.nativeEvent.clientY); } }}
        onPointerOut={() => { document.body.style.cursor = ""; onHover?.(null, 0, 0); }}>
        <circleGeometry args={[16, 12]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
      </instancedMesh>
    </>
  );
}

function WorkRing({ ds, ring, exag }: { ds: Dataset; ring: { x: number; y: number; r: number }; exag: number }) {
  const pts = useMemo(() => Array.from({ length: 97 }, (_, k) => {
    const a = (k / 96) * Math.PI * 2, x = ring.x + ring.r * Math.sin(a), y = ring.y + ring.r * Math.cos(a);
    const q = mapToScene(ds.meta, x, y);
    return new THREE.Vector3(q.sx, groundY(ds, x, y, exag, 2), q.sz);
  }), [ds, ring, exag]);
  return <Line points={pts} color="#c9a86a" lineWidth={1.5} dashed dashSize={8} gapSize={6} depthTest={false} renderOrder={9} />;
}

// Smooth camera flight to a focus point (0.9 s, eased); instant when reduced motion is requested.
/** Shift the projection so the camera's focus appears centred in the visible part of the canvas (left of the panel). */
function ViewShift({ px }: { px: number }) {
  const { camera, size } = useThree() as unknown as { camera: THREE.PerspectiveCamera; size: { width: number; height: number } };
  useEffect(() => {
    if (px) camera.setViewOffset(size.width, size.height, px, 0, size.width, size.height); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, px]);
  return null;
}

function CameraRig({ focus, ds, exag }: { focus: Focus; ds: Dataset; exag: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const anim = useRef<{ t0: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3 } | null>(null);
  useEffect(() => {
    if (!focus || !controls) return;
    const { sx, sz } = mapToScene(ds.meta, focus.x, focus.y);
    const toT = new THREE.Vector3(sx, groundY(ds, focus.x, focus.y, exag), sz);
    const off = camera.position.clone().sub(controls.target);
    off.setLength(focus.dist ?? Math.min(off.length(), 1100));
    anim.current = { t0: performance.now(), fromT: controls.target.clone(), toT, fromP: camera.position.clone(), toP: toT.clone().add(off) };
    if (reduced()) { controls.target.copy(toT); camera.position.copy(anim.current.toP); controls.update(); anim.current = null; }
  }, [focus, ds, exag, camera, controls]);
  useFrame(() => {
    const a = anim.current;
    if (!a || !controls) return;
    const f = Math.min(1, (performance.now() - a.t0) / 900), e = 1 - Math.pow(1 - f, 3);
    controls.target.lerpVectors(a.fromT, a.toT, e); camera.position.lerpVectors(a.fromP, a.toP, e); controls.update();
    if (f >= 1) anim.current = null;
  });
  return null;
}

export default function TerrainScene(p: Props) {
  const relief = (p.ds.meta.zmax - p.ds.meta.zmin) * p.exaggeration;
  return (
    <Canvas camera={{ position: [-700, relief + 900, 1250], fov: 40, near: 5, far: 40000 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#1d1712"]} />
      <fog attach="fog" args={["#1d1712", 5000, 12000]} />
      <Terrain {...p} />
      {p.lines?.map((l) => <AnimatedLine key={l.key} ds={p.ds} l={l} exag={p.exaggeration} />)}
      {p.ring && <WorkRing ds={p.ds} ring={p.ring} exag={p.exaggeration} />}
      {p.sky && <SkyCurtain ds={p.ds} sky={p.sky} exag={p.exaggeration} />}
      {p.showObs && <ObservedStops ds={p.ds} stops={p.ds.observations.stops} exag={p.exaggeration} onClick={p.onObsClick} onHover={p.onObsHover} />}
      {p.pins?.map((q, i) => <Pin key={q.key} ds={p.ds} pin={q} exag={p.exaggeration} onHover={p.onPinHover} lift={labelLift(p.pins!, i)} />)}
      <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.47} minDistance={60} maxDistance={7000} enableDamping />
      <CameraRig focus={p.focus} ds={p.ds} exag={p.exaggeration} />
      <ViewShift px={p.viewShiftPx ?? 0} />
    </Canvas>
  );
}
