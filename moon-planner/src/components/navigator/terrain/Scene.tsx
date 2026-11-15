"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef } from "react";
import { Raycaster, Vector2, type PerspectiveCamera } from "three";
import type { PlateBridge } from "./bridge";
import { EXAGGERATION, type RGB } from "./constants";
import { intersectRelief, type TerrainData } from "./data";
import { PlateRenderer } from "./engine";
import { pointInPolygon, type RegionShape, type V2, type V3 } from "./geo";
import { CameraRig, type SiteView } from "./rig";

export type SceneProps = {
  data: TerrainData;
  range: { min: number; max: number };
  /** Region outlines in sites order. */
  regions: (RegionShape | null)[];
  selectedIndex: number;
  hoveredIndex: number;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
  /** Sun direction in the plate frame, or null for neutral relief. */
  sun: V3 | null;
  /** Selected site centre (map metres), ground height (m) and region span (m). */
  site: SiteView;
  /** Map-plane bearings from the site toward the Sun and Earth. */
  sunBearing: V2 | null;
  earthBearing: V2 | null;
  /** Score tint per region (sites order); null entries get no ribbon. */
  tints: (RGB | null)[] | null;
  bridge: PlateBridge;
  reducedMotion: boolean;
  onFirstFrame: () => void;
};

const K = EXAGGERATION / 1000;

export default function TerrainScene(props: SceneProps) {
  const { data, range, regions, selectedIndex, hoveredIndex, sun, site, sunBearing, earthBearing, tints, bridge, reducedMotion } = props;
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const aspect = size.width / Math.max(1, size.height);

  const renderer = useMemo(() => new PlateRenderer(data, range), [data, range]);
  useEffect(() => () => renderer.dispose(), [renderer]);

  const rig = useMemo(
    () => new CameraRig(camera, { half: data.half, minY: range.min * K, maxY: range.max * K }, invalidate),
    [camera, data, range, invalidate],
  );
  useEffect(() => {
    rig.connect(gl.domElement);
    return () => rig.dispose();
  }, [rig, gl]);

  // ---------- Props into uniforms ----------

  useEffect(() => {
    renderer.setSun(sun);
    invalidate();
  }, [renderer, sun, invalidate]);

  useEffect(() => {
    renderer.setRegions(regions);
    invalidate();
  }, [renderer, regions, invalidate]);

  useEffect(() => {
    renderer.setHighlight(selectedIndex, hoveredIndex);
    invalidate();
  }, [renderer, selectedIndex, hoveredIndex, invalidate]);

  useEffect(() => {
    renderer.setTints(tints);
    invalidate();
  }, [renderer, tints, invalidate]);

  useEffect(() => {
    renderer.setBearings(site, sunBearing, earthBearing);
    invalidate();
  }, [renderer, site, sunBearing, earthBearing, invalidate]);

  // ---------- Camera ----------

  const firstView = useRef(true);
  const showSite = useEffectEvent(() => {
    rig.flyTo(rig.viewFor(site, aspect), firstView.current || reducedMotion);
    firstView.current = false;
  });
  const siteKey = site ? `${Math.round(site.x)},${Math.round(site.y)}` : "none";
  useLayoutEffect(() => {
    showSite();
  }, [siteKey, rig]);

  useEffect(() => {
    bridge.setInvalidate(invalidate);
    bridge.setCommands({
      zoom: (d) => rig.zoom(d, reducedMotion),
      orbit: (a, p) => rig.orbit(a, p),
      recentre: () => rig.flyTo(rig.viewFor(site, aspect), reducedMotion),
    });
    return () => {
      bridge.setCommands(null);
      bridge.setInvalidate(null);
    };
  }, [bridge, rig, site, aspect, reducedMotion, invalidate]);

  // ---------- Picking ----------

  // Smaller regions first, so a region inside another stays pickable.
  const pickOrder = useMemo(
    () =>
      regions
        .map((r, i) => ({ r, i }))
        .filter((q): q is { r: RegionShape; i: number } => q.r !== null)
        .sort((a, b) => a.r.areaKm2 - b.r.areaKm2),
    [regions],
  );
  const raycaster = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);

  const regionAt = useEffectEvent((clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = intersectRelief(data.grid, range, EXAGGERATION, raycaster.ray.origin, raycaster.ray.direction);
    if (!hit) return -1;
    for (const q of pickOrder) if (pointInPolygon(hit, q.r.corners)) return q.i;
    return -1;
  });
  const hoverTo = useEffectEvent((i: number) => {
    if (i !== hoveredIndex) props.onHover(i);
  });
  const pickTo = useEffectEvent((i: number) => props.onPick(i));

  useEffect(() => {
    const el = gl.domElement;
    let raf = 0;
    let last: PointerEvent | null = null;
    let down: { x: number; y: number } | null = null;
    const setHover = (i: number) => {
      hoverTo(i);
      if (!down) el.style.cursor = i >= 0 ? "pointer" : "grab";
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || down) return;
      last = e;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (last) setHover(regionAt(last.clientX, last.clientY));
        });
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const i = regionAt(e.clientX, e.clientY);
        if (i >= 0) pickTo(i);
      }
      down = null;
    };
    const onLeave = () => {
      last = null;
      setHover(-1);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [gl]);

  // ---------- Frames (rendered on demand) ----------

  const firstFrame = useRef(false);
  useFrame(() => rig.step(performance.now()), -3);
  useFrame(() => {
    renderer.beforeRender(gl, camera, rig.controls.target);
    bridge.sync(camera, size.width, size.height, rig.controls.target);
    if (!firstFrame.current) {
      firstFrame.current = true;
      requestAnimationFrame(() => props.onFirstFrame());
    }
  }, -2);

  return (
    <>
      <primitive object={renderer.surface} />
      <primitive object={renderer.walls} />
      <primitive object={renderer.cut} />
      <primitive object={renderer.frame} />
    </>
  );
}
