// Camera for the terrain plate: orbit controls with limits, a default
// oblique view per site (from the outward side, looking toward the pole)
// and an eased fly-to between views.

import { Spherical, Vector3, type PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EXAGGERATION } from "./constants";

const K = EXAGGERATION / 1000;
const PITCH = (36 * Math.PI) / 180;

export type SiteView = { x: number; y: number; h: number; spanM: number } | null;
export type View = { target: Vector3; position: Vector3 };

type Fly = { t0: number; dur: number; fromT: Vector3; toT: Vector3; fromS: Spherical; toS: Spherical; arc: number };

export class CameraRig {
  readonly controls: OrbitControls;
  private fly: Fly | null = null;
  private dom: HTMLElement | null = null;
  private readonly onChange = () => {
    this.clampTarget();
    this.invalidate();
  };
  private readonly onStart = () => {
    this.fly = null;
    if (this.dom) this.dom.style.cursor = "grabbing";
  };
  private readonly onEnd = () => {
    if (this.dom) this.dom.style.cursor = "grab";
  };

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly limits: { half: number; minY: number; maxY: number },
    private readonly invalidate: () => void,
  ) {
    const c = new OrbitControls(camera);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = false;
    c.zoomToCursor = true;
    c.minDistance = 10;
    c.maxDistance = 1500;
    c.maxPolarAngle = 1.36;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.9;
    this.controls = c;
  }

  connect(dom: HTMLElement) {
    this.dom = dom;
    dom.style.cursor = "grab";
    this.controls.connect(dom);
    this.controls.addEventListener("change", this.onChange);
    this.controls.addEventListener("start", this.onStart);
    this.controls.addEventListener("end", this.onEnd);
  }

  dispose() {
    this.controls.removeEventListener("change", this.onChange);
    this.controls.removeEventListener("start", this.onStart);
    this.controls.removeEventListener("end", this.onEnd);
    this.controls.dispose();
    this.dom = null;
  }

  get dragging() {
    return this.dom?.style.cursor === "grabbing";
  }

  /** Default view: the site from its outward side, 36 degrees down, wide enough for the region and its neighbours. */
  viewFor(site: SiteView, aspect: number): View {
    const tanV = Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    const a = Math.min(Math.max(aspect, 0.55), 1.8);
    if (!site) {
      const dist = Math.min(1400, (this.limits.half / 1000) * 2.4 / (2 * tanV * Math.min(a, 1.4)));
      const p = (52 * Math.PI) / 180;
      return { target: new Vector3(0, 0, 0), position: new Vector3(0, dist * Math.sin(p), dist * Math.cos(p)) };
    }
    const widthKm = Math.max(220, (site.spanM / 1000) * 4);
    const dist = Math.min(600, Math.max(45, widthKm / (2 * tanV * a)));
    const r = Math.hypot(site.x, site.y);
    const ux = r > 1 ? site.x / r : 0;
    const uy = r > 1 ? site.y / r : 1;
    const target = new Vector3(site.x / 1000, site.h * K, -site.y / 1000);
    const position = new Vector3(
      target.x + ux * dist * Math.cos(PITCH),
      target.y + dist * Math.sin(PITCH),
      target.z - uy * dist * Math.cos(PITCH),
    );
    return { target, position };
  }

  flyTo(to: View, instant: boolean, durMs?: number) {
    this.halt();
    if (instant) {
      this.fly = null;
      this.controls.target.copy(to.target);
      this.camera.position.copy(to.position);
      this.controls.update();
      this.invalidate();
      return;
    }
    const fromT = this.controls.target.clone();
    const fromS = new Spherical().setFromVector3(this.camera.position.clone().sub(fromT));
    const toS = new Spherical().setFromVector3(to.position.clone().sub(to.target));
    let dTheta = toS.theta - fromS.theta;
    while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
    toS.theta = fromS.theta + dTheta;
    const travel = fromT.distanceTo(to.target);
    this.fly = {
      t0: performance.now(),
      dur: durMs ?? 650 + 550 * Math.min(1, travel / 250),
      fromT,
      toT: to.target.clone(),
      fromS,
      toS,
      arc: Math.min(0.45, travel / 400),
    };
    this.invalidate();
  }

  zoom(direction: 1 | -1, instant: boolean) {
    const t = this.controls.target;
    const offset = this.camera.position.clone().sub(t);
    const len = offset.length() * (direction > 0 ? 0.7 : 1 / 0.7);
    offset.setLength(Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, len)));
    this.flyTo({ target: t.clone(), position: t.clone().add(offset) }, instant, 240);
  }

  orbit(azimuthRad: number, polarRad: number) {
    this.fly = null;
    this.controls.rotateLeft(azimuthRad);
    this.controls.rotateUp(polarRad);
    this.invalidate();
  }

  /** Advance the fly-to and the damped controls; call once per rendered frame. */
  step(now: number) {
    const f = this.fly;
    if (f) {
      const t = Math.min(1, (now - f.t0) / f.dur);
      // Exponential ease-out, normalised to land exactly at 1.
      const e = t >= 1 ? 1 : (1 - Math.pow(2, -10 * t)) / (1 - Math.pow(2, -10));
      const target = new Vector3().lerpVectors(f.fromT, f.toT, e);
      const radius = Math.exp(Math.log(f.fromS.radius) + (Math.log(f.toS.radius) - Math.log(f.fromS.radius)) * e);
      const s = new Spherical(
        radius * (1 + f.arc * Math.sin(Math.PI * e)),
        f.fromS.phi + (f.toS.phi - f.fromS.phi) * e,
        f.fromS.theta + (f.toS.theta - f.fromS.theta) * e,
      );
      this.controls.target.copy(target);
      this.camera.position.setFromSpherical(s).add(target);
      if (t >= 1) this.fly = null;
      else this.invalidate();
    }
    this.controls.update();
  }

  /** OrbitControls keeps damped motion internally; clear it before moving the camera directly. */
  private halt() {
    const inner = this.controls as unknown as { _sphericalDelta?: Spherical; _panOffset?: Vector3; _scale?: number };
    inner._sphericalDelta?.set(0, 0, 0);
    inner._panOffset?.set(0, 0, 0);
    if (typeof inner._scale === "number") inner._scale = 1;
  }

  /** Keep the orbit centre on the plate. */
  private clampTarget() {
    const t = this.controls.target;
    const h = this.limits.half / 1000;
    const cx = Math.min(Math.max(t.x, -h), h);
    const cz = Math.min(Math.max(t.z, -h), h);
    const cy = Math.min(Math.max(t.y, this.limits.minY), this.limits.maxY);
    if (cx !== t.x || cy !== t.y || cz !== t.z) {
      this.camera.position.x += cx - t.x;
      this.camera.position.y += cy - t.y;
      this.camera.position.z += cz - t.z;
      t.set(cx, cy, cz);
    }
  }
}
