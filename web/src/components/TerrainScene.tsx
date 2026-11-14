"use client";
import { Canvas, ThreeEvent, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Dataset, Plan, Sky, Stop } from "@/lib/data";
import { BASE, centre, mapToScene, ROUTE_COLORS, ROUTE_DASH, sampleGrid, sceneToMap } from "@/lib/data";

export type Layer = "terrain" | "dose" | "sky" | "slope" | "image";
const LAYER_ID: Record<Layer, number> = { terrain: 0, dose: 1, sky: 2, slope: 3, image: 4 };

type Props = {
  ds: Dataset;
  layer: Layer;
  alpha: number;
  exaggeration: number;
  plan: Plan | null;
  selectedRoute: string | null;
  sky: Sky | null;
  markers: { start?: [number, number]; end?: [number, number]; stops: [number, number][] };
  showObs: boolean;
  extraRoutes?: { key: string; xy: [number, number][]; color: string; width: number }[];
  extraPins?: { key: string; x: number; y: number; color: string; label: string }[];
  ring?: { x: number; y: number; r: number } | null;
  sitePins?: { key: string; x: number; y: number; label: string }[];
  onObsClick?: (s: Stop) => void;
  onPick: (x: number, y: number) => void;
  onHover: (p: { x: number; y: number } | null) => void;
};

const vert = /* glsl */ `
  uniform vec4 uData;   // u = sx*uData.x + uData.y ; v = sz*uData.z + uData.w
  uniform vec4 uHill;
  uniform vec4 uOrtho;
  varying vec2 vData; varying vec2 vHill; varying vec2 vOrtho; varying float vH; varying vec3 vWorld;
  void main() {
    vOrtho = vec2(position.x * uOrtho.x + uOrtho.y, position.z * uOrtho.z + uOrtho.w);
    vData = vec2(position.x * uData.x + uData.y, position.z * uData.z + uData.w);
    vHill = vec2(position.x * uHill.x + uHill.y, position.z * uHill.z + uHill.w);
    vH = position.y;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */ `
  uniform sampler2D tData;   // r: rel_sky, g: B, b: slope(deg)
  uniform sampler2D tHill;
  uniform sampler2D tOrtho;
  uniform int uLayer; uniform float uAlpha; uniform vec2 uZ; uniform float uExag;
  varying vec2 vData; varying vec2 vHill; varying vec2 vOrtho; varying float vH; varying vec3 vWorld;

  vec3 terrain(float t) {          // dust ochre ramp by elevation
    vec3 lo = vec3(0.36, 0.22, 0.15), mid = vec3(0.70, 0.47, 0.30), hi = vec3(0.86, 0.72, 0.56);
    return t < 0.5 ? mix(lo, mid, t * 2.0) : mix(mid, hi, (t - 0.5) * 2.0);
  }
  float iso(float v, float step, float w) {   // anti-aliased isolines
    float f = abs(fract(v / step + 0.5) - 0.5) * step;
    float d = fwidth(v);
    return 1.0 - smoothstep(0.0, d * w, f);
  }
  void main() {
    vec4 D = texture2D(tData, vData);
    float hs = texture2D(tHill, vHill).r;
    float t = clamp((vH / uExag - uZ.x) / (uZ.y - uZ.x), 0.0, 1.0);
    float hn = clamp((hs - 0.45) / 0.4, 0.0, 1.0);
    vec3 base = terrain(t) * (0.32 + 0.9 * hn);
    vec3 col = base;
    float a = uAlpha / (1.0 - uAlpha);
    float rel = (D.r + (1.0 + D.g) * a) / (1.0 + a);
    vec3 sunset = vec3(0.435, 0.702, 0.863);
    if (uLayer == 1) {
      // modeled relative dose rate: single-hue sequential (more shielding = deeper blue)
      float s = clamp((0.97 - rel) / 0.17, 0.0, 1.0);
      s = sqrt(s);
      vec3 shade = mix(vec3(0.80, 0.87, 0.93), vec3(0.09, 0.30, 0.62), s);
      col = mix(base * 0.85, shade * (0.45 + 0.7 * hn), 0.12 + 0.78 * s);
    } else if (uLayer == 2) {
      float s = clamp(D.g / 0.5, 0.0, 1.0);
      col = mix(base * 0.8, mix(vec3(0.85), vec3(0.15, 0.22, 0.45), s) * (0.45 + 0.7 * hn), 0.3 + 0.55 * s);
      col = mix(col, vec3(0.95), 0.5 * iso(D.g, 0.1, 0.8) * step(0.099, D.g));
    } else if (uLayer == 4) {
      // USGS HiRISE-based orthophoto (grayscale), lightly warmed for display only
      float g = texture2D(tOrtho, vOrtho).r;
      col = vec3(g * 1.04, g * 0.97, g * 0.9);
    } else if (uLayer == 3) {
      float s = D.b;
      col = base;
      if (s > 25.0) {
        float hatch = step(0.5, fract((vWorld.x + vWorld.z) / 6.0));
        col = mix(base, vec3(0.85, 0.35, 0.15), 0.35 + 0.35 * hatch);
      } else if (s > 15.0) {
        col = mix(base, vec3(0.90, 0.66, 0.23), 0.35);
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

function useTerrainGeometry(ds: Dataset, exag: number) {
  return useMemo(() => {
    const [ny, nx] = ds.meta.shape;
    const step = 2; // 10 m mesh vertices; shading comes from the 1 m hillshade and 5 m data textures
    const my = Math.floor((ny - 1) / step) + 1;
    const mx = Math.floor((nx - 1) / step) + 1;
    const pos = new Float32Array(my * mx * 3);
    const z0 = ds.meta.zmin;
    let k = 0;
    for (let i = 0; i < my; i++) {
      for (let j = 0; j < mx; j++) {
        const r = i * step, c = j * step;
        const x = ds.meta.x0 + c * ds.meta.res, y = ds.meta.y0 - r * ds.meta.res;
        const { sx, sz } = mapToScene(ds.meta, x, y);
        pos[k++] = sx;
        pos[k++] = (ds.grids.height[r * nx + c] - z0) * exag;
        pos[k++] = sz;
      }
    }
    const idx = new Uint32Array((my - 1) * (mx - 1) * 6);
    k = 0;
    for (let i = 0; i < my - 1; i++)
      for (let j = 0; j < mx - 1; j++) {
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
    for (let i = 0; i < nx * ny; i++) {
      data[i * 4] = ds.grids.relSky[i];
      data[i * 4 + 1] = ds.grids.B[i];
      data[i * 4 + 2] = ds.grids.slope[i];
      data[i * 4 + 3] = 1;
    }
    const tData = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat, THREE.FloatType);
    tData.magFilter = THREE.LinearFilter;
    tData.minFilter = THREE.LinearFilter;
    tData.needsUpdate = true;
    const tHill = new THREE.TextureLoader().load(`${BASE}/data/hillshade.png`);
    tHill.flipY = false;
    tHill.colorSpace = THREE.NoColorSpace;
    tHill.anisotropy = 8;
    const { cx, cy } = centre(ds.meta); // scene = (x - cx, -(y - cy))
    // data texture: u = (x - x0)/res/nx + 0.5/nx with x = sx + cx ; v = (y0 - y)/res/ny + 0.5/ny with y = cy - sz
    const m = ds.meta;
    const uData = new THREE.Vector4(
      1 / m.res / nx, (cx - m.x0) / m.res / nx + 0.5 / nx,
      1 / m.res / ny, (m.y0 - cy) / m.res / ny + 0.5 / ny,
    );
    const [hh, hw] = m.hillshade_shape;
    const hr = m.hillshade_res;
    const uHill = new THREE.Vector4(
      1 / hr / hw, (cx - m.hillshade_x0) / hr / hw + 0.5 / hw,
      1 / hr / hh, (m.hillshade_y0 - cy) / hr / hh + 0.5 / hh,
    );
    let tOrtho: THREE.Texture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    tOrtho.needsUpdate = true;
    let uOrtho = new THREE.Vector4(0, 0.5, 0, 0.5);
    if (ds.ortho) {
      const o = ds.ortho;
      const [oh, ow] = o.shape;
      tOrtho = new THREE.TextureLoader().load(`${BASE}/data/ortho.jpg`);
      tOrtho.flipY = false;
      tOrtho.colorSpace = THREE.NoColorSpace;
      tOrtho.anisotropy = 8;
      uOrtho = new THREE.Vector4(1 / o.res / ow, (cx - o.x0) / o.res / ow + 0.5 / ow, 1 / o.res / oh, (o.y0 - cy) / o.res / oh + 0.5 / oh);
    }
    return new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        tData: { value: tData }, tHill: { value: tHill }, uData: { value: uData }, uHill: { value: uHill },
        tOrtho: { value: tOrtho }, uOrtho: { value: uOrtho },
        uLayer: { value: 1 }, uAlpha: { value: 0.21 }, uZ: { value: new THREE.Vector2(0, m.zmax - m.zmin) },
        uExag: { value: 1 },
      },
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
    mat.uniforms.uLayer.value = LAYER_ID[p.layer];
    mat.uniforms.uAlpha.value = p.alpha;
    mat.uniforms.uExag.value = p.exaggeration;
  }, [mat, p.layer, p.alpha, p.exaggeration]);
  const last = useRef(0);
  const toMap = (e: ThreeEvent<PointerEvent | MouseEvent>) => sceneToMap(p.ds.meta, e.point.x, e.point.z);
  return (
    <mesh
      geometry={geom}
      material={mat}
      onClick={(e) => { e.stopPropagation(); if (e.delta > 4) return; const m = toMap(e); p.onPick(m.x, m.y); }}
      onPointerMove={(e) => {
        const now = performance.now();
        if (now - last.current < 60) return;
        last.current = now;
        p.onHover(toMap(e));
      }}
      onPointerOut={() => p.onHover(null)}
    />
  );
}

function RouteLines({ ds, plan, selected, exag }: { ds: Dataset; plan: Plan; selected: string | null; exag: number }) {
  return (
    <>
      {plan.routes.filter((r) => r.feasible).map((r) => {
        const pts = r.xy.filter((_, i) => i % 2 === 0 || i === r.xy.length - 1).map(([x, y]) => {
          const { sx, sz } = mapToScene(ds.meta, x, y);
          return new THREE.Vector3(sx, groundY(ds, x, y, exag, 3), sz);
        });
        const on = selected === r.objective;
        const dash = ROUTE_DASH[r.objective];
        return (
          <Line key={r.objective} points={pts} color={ROUTE_COLORS[r.objective]} lineWidth={on ? 5 : 3}
            transparent opacity={selected && !on ? 0.45 : 1} dashed={!!dash} dashSize={dash?.[0] ?? 1} gapSize={dash?.[1] ?? 0}
            depthTest={false} renderOrder={on ? 12 : 10} />
        );
      })}
    </>
  );
}

function SkyCurtain({ ds, sky, exag }: { ds: Dataset; sky: Sky; exag: number }) {
  // A dome of radius R centred on the observer; the terrain-blocked part of the sky is drawn as a
  // dark curtain from the horizon (elev 0) up to the terrain horizon h(az).
  const geo = useMemo(() => {
    const R = 70;
    const n = sky.az.length;
    const step = Math.max(1, Math.floor(n / 360));
    const pos: number[] = [];
    const line: THREE.Vector3[] = [];
    const ring = (az: number, el: number) => {
      const a = (az * Math.PI) / 180, e = (Math.max(el, 0) * Math.PI) / 180;
      return new THREE.Vector3(R * Math.cos(e) * Math.sin(a), R * Math.sin(e), -R * Math.cos(e) * Math.cos(a));
    };
    for (let i = 0; i < n; i += step) {
      const j = (i + step) % n;
      const a0 = sky.az[i], a1 = sky.az[j] < a0 ? sky.az[j] + 360 : sky.az[j];
      const h0 = sky.elev[i], h1 = sky.elev[j];
      const p00 = ring(a0, 0), p01 = ring(a0, h0), p10 = ring(a1, 0), p11 = ring(a1, h1);
      pos.push(...p00.toArray(), ...p01.toArray(), ...p10.toArray(), ...p10.toArray(), ...p01.toArray(), ...p11.toArray());
      line.push(p01);
    }
    line.push(line[0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const rings = [30, 60].map((el) => Array.from({ length: 73 }, (_, k) => ring(k * 5, el)));
    return { g, line, rings };
  }, [sky]);
  const { sx, sz } = mapToScene(ds.meta, sky.x, sky.y);
  const y0 = groundY(ds, sky.x, sky.y, exag, sky.h_obs);
  return (
    <group position={[sx, y0, sz]}>
      <mesh geometry={geo.g} renderOrder={5}>
        <meshBasicMaterial color="#1c2333" transparent opacity={0.42} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={geo.line} color="#6fb3dc" lineWidth={2} />
      {geo.rings.map((r, i) => <Line key={i} points={r} color="#ece6da" lineWidth={0.6} transparent opacity={0.25} />)}
      <mesh><sphereGeometry args={[2.2, 16, 16]} /><meshBasicMaterial color="#ffffff" /></mesh>
    </group>
  );
}

function Pin({ ds, x, y, exag, color, label, size = 4, high = false }: { ds: Dataset; x: number; y: number; exag: number; color: string; label?: string; size?: number; high?: boolean }) {
  const { sx, sz } = mapToScene(ds.meta, x, y);
  const gy = groundY(ds, x, y, exag);
  return (
    <group position={[sx, gy, sz]}>
      <mesh position={[0, high ? 30 : 14, 0]}><sphereGeometry args={[size, 16, 16]} /><meshBasicMaterial color={color} /></mesh>
      <mesh position={[0, high ? 15 : 7, 0]}><cylinderGeometry args={[0.6, 0.6, high ? 30 : 14, 6]} /><meshBasicMaterial color={color} /></mesh>
      {label && (
        <Html position={[0, high ? 44 : 24, 0]} center style={{ pointerEvents: "none", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, color: "#ece6da", textShadow: "0 1px 3px #000" }}>
          {label}
        </Html>
      )}
    </group>
  );
}

function ObservedStops({ ds, stops, exag, onClick }: { ds: Dataset; stops: Stop[]; exag: number; onClick?: (s: Stop) => void }) {
  // Observations: white rings; inner fill = detrended observed anomaly (diverging blue/orange, gray at 0).
  const ref = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const hitRef = useRef<THREE.InstancedMesh>(null);
  const valid = useMemo(() => stops.filter((s) => s.anomaly_obs != null && (s.data_sols ?? 0) >= 1), [stops]);
  useEffect(() => {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    valid.forEach((s, i) => {
      const { sx, sz } = mapToScene(ds.meta, s.x, s.y);
      m.makeRotationX(-Math.PI / 2).setPosition(sx, groundY(ds, s.x, s.y, exag, 2.5), sz);
      ref.current?.setMatrixAt(i, m);
      ringRef.current?.setMatrixAt(i, m);
      hitRef.current?.setMatrixAt(i, m);
      const v = Math.max(-1, Math.min(1, (s.anomaly_obs as number) / 0.08));
      const gray = new THREE.Color("#8b8678"), cold = new THREE.Color("#3987e5"), warm = new THREE.Color("#d95926");
      c.copy(gray).lerp(v < 0 ? cold : warm, Math.abs(v));
      ref.current?.setColorAt(i, c);
    });
    if (ref.current) { ref.current.instanceMatrix.needsUpdate = true; if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true; }
    if (ringRef.current) ringRef.current.instanceMatrix.needsUpdate = true;
    if (hitRef.current) { hitRef.current.instanceMatrix.needsUpdate = true; hitRef.current.computeBoundingSphere(); }
  }, [valid, ds, exag]);
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, valid.length]} renderOrder={8}>
        <circleGeometry args={[4.2, 20]} />
        <meshBasicMaterial depthTest={false} transparent />
      </instancedMesh>
      <instancedMesh ref={ringRef} args={[undefined, undefined, valid.length]} renderOrder={9}>
        <ringGeometry args={[4.2, 6, 24]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} transparent />
      </instancedMesh>
      {/* invisible, larger hit targets so a RAD observation is easy to click */}
      <instancedMesh ref={hitRef} args={[undefined, undefined, valid.length]}
        onClick={(e) => { e.stopPropagation(); if (e.instanceId != null && onClick) onClick(valid[e.instanceId]); }}
        onPointerOver={() => { document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = ""; }}>
        <circleGeometry args={[16, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
      </instancedMesh>
    </>
  );
}

function WorkRing({ ds, ring, exag }: { ds: Dataset; ring: { x: number; y: number; r: number }; exag: number }) {
  const pts = useMemo(() => Array.from({ length: 97 }, (_, k) => {
    const a = (k / 96) * Math.PI * 2;
    const x = ring.x + ring.r * Math.sin(a), y = ring.y + ring.r * Math.cos(a);
    const q = mapToScene(ds.meta, x, y);
    return new THREE.Vector3(q.sx, groundY(ds, x, y, exag, 2), q.sz);
  }), [ds, ring, exag]);
  return <Line points={pts} color="#e5a53a" lineWidth={1.5} dashed dashSize={8} gapSize={6} depthTest={false} renderOrder={9} />;
}

function CameraRig({ focus, ds, exag }: { focus: [number, number] | null; ds: Dataset; exag: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  useEffect(() => {
    if (!focus || !controls) return;
    const { sx, sz } = mapToScene(ds.meta, focus[0], focus[1]);
    const gy = groundY(ds, focus[0], focus[1], exag);
    const off = camera.position.clone().sub(controls.target);
    const len = Math.min(off.length(), 900);
    off.setLength(len);
    controls.target.set(sx, gy, sz);
    camera.position.copy(controls.target.clone().add(off));
    controls.update();
  }, [focus, ds, exag, camera, controls]);
  return null;
}

export default function TerrainScene(p: Props & { focus: [number, number] | null }) {
  const relief = (p.ds.meta.zmax - p.ds.meta.zmin) * p.exaggeration;
  return (
    <Canvas camera={{ position: [-900, relief + 1100, 1500], fov: 42, near: 5, far: 40000 }} dpr={[1, 2]}
      gl={{ antialias: true }} onPointerMissed={() => undefined}>
      <color attach="background" args={["#1f2840"]} />
      <fog attach="fog" args={["#1f2840", 5000, 12000]} />
      <Terrain {...p} />
      {p.plan && <RouteLines ds={p.ds} plan={p.plan} selected={p.selectedRoute} exag={p.exaggeration} />}
      {p.extraRoutes?.map((r) => (
        <Line key={r.key} points={r.xy.map(([x, y]) => { const q = mapToScene(p.ds.meta, x, y); return new THREE.Vector3(q.sx, groundY(p.ds, x, y, p.exaggeration, 3), q.sz); })}
          color={r.color} lineWidth={r.width} depthTest={false} renderOrder={11} />
      ))}
      {p.ring && <WorkRing ds={p.ds} ring={p.ring} exag={p.exaggeration} />}
      {p.extraPins?.map((q) => <Pin key={q.key} ds={p.ds} x={q.x} y={q.y} exag={p.exaggeration} color={q.color} label={q.label} high />)}
      {p.sky && <SkyCurtain ds={p.ds} sky={p.sky} exag={p.exaggeration} />}
      {p.showObs && <ObservedStops ds={p.ds} stops={p.ds.observations.stops} exag={p.exaggeration} onClick={p.onObsClick} />}
      {(p.sitePins ?? p.ds.targets.map((t) => ({ key: t.name, x: t.x, y: t.y, label: t.name }))).map((t) => (
        <Pin key={t.key} ds={p.ds} x={t.x} y={t.y} exag={p.exaggeration} color="#ece6da" label={t.label} size={2.6} />
      ))}
      {p.markers.start && <Pin ds={p.ds} x={p.markers.start[0]} y={p.markers.start[1]} exag={p.exaggeration} color="#199e70" label="Start" high />}
      {p.markers.end && <Pin ds={p.ds} x={p.markers.end[0]} y={p.markers.end[1]} exag={p.exaggeration} color="#d55181" label="Destination" high />}
      {p.markers.stops.map((s, i) => <Pin key={i} ds={p.ds} x={s[0]} y={s[1]} exag={p.exaggeration} color="#c98500" label={`Stop ${i + 1}`} high />)}
      <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.47} minDistance={60} maxDistance={7000} enableDamping />
      <CameraRig focus={p.focus} ds={p.ds} exag={p.exaggeration} />
    </Canvas>
  );
}
