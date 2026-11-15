// GPU side of the terrain plate: relief mesh, height texture, the
// map-space light pass, the surface material and the plate's side walls.

import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RGFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from "three";
import { EXAGGERATION, hexToRgb, RELIEF, TOKENS, type RGB } from "./constants";
import type { TerrainData } from "./data";
import type { RegionShape, V2, V3 } from "./geo";
import { lightFragment, lightVertex, opennessFragment, REGION_COUNT, surfaceFragment, surfaceVertex } from "./shaders";

const K = EXAGGERATION / 1000; // metres of height to scene units (km)
const vec3 = (c: RGB) => new Vector3(c[0], c[1], c[2]);

export class PlateRenderer {
  readonly surface: Mesh;
  readonly walls: Mesh;
  readonly cut: LineSegments;
  readonly frame: LineSegments;

  private heightTex: DataTexture;
  private lightTarget: WebGLRenderTarget;
  private lightMaterial: ShaderMaterial;
  private lightScene = new Scene();
  private lightCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private openTarget: WebGLRenderTarget;
  private openMaterial: ShaderMaterial;
  private openScene = new Scene();
  private openDone = false;
  private material: ShaderMaterial;
  private bakeDirty = true;

  constructor(data: TerrainData, range: { min: number; max: number }) {
    const defs = { half: data.half, pixel: data.meta.pixelSize };
    const { width, height } = data.meta;

    this.heightTex = new DataTexture(data.texData, width, height, RGFormat, HalfFloatType);
    this.heightTex.minFilter = LinearFilter;
    this.heightTex.magFilter = LinearFilter;
    this.heightTex.wrapS = ClampToEdgeWrapping;
    this.heightTex.wrapT = ClampToEdgeWrapping;
    this.heightTex.generateMipmaps = false;
    this.heightTex.needsUpdate = true;

    // One texel per DEM pixel: visible fraction of the Sun's disc.
    this.lightTarget = new WebGLRenderTarget(width, height, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.lightMaterial = new ShaderMaterial({
      vertexShader: lightVertex,
      fragmentShader: lightFragment(defs),
      uniforms: { uHeight: { value: this.heightTex }, uSun: { value: new Vector3(0, 0, 1) } },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.lightMaterial);
    quad.frustumCulled = false;
    this.lightScene.add(quad);

    const half = { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
    this.openTarget = new WebGLRenderTarget(Math.floor(width / 2), Math.floor(height / 2), half);
    this.openMaterial = new ShaderMaterial({
      vertexShader: lightVertex,
      fragmentShader: opennessFragment(defs),
      uniforms: { uHeight: { value: this.heightTex } },
      depthTest: false,
      depthWrite: false,
    });
    const openQuad = new Mesh(new PlaneGeometry(2, 2), this.openMaterial);
    openQuad.frustumCulled = false;
    this.openScene.add(openQuad);

    this.material = new ShaderMaterial({
      vertexShader: surfaceVertex,
      fragmentShader: surfaceFragment(defs),
      uniforms: {
        uHeight: { value: this.heightTex },
        uLight: { value: this.lightTarget.texture },
        uOpen: { value: this.openTarget.texture },
        uHasSun: { value: 0 },
        uSun: { value: new Vector3(0, 0, 1) },
        uExag: { value: EXAGGERATION },
        uDpr: { value: 1 },
        uLitLo: { value: vec3(RELIEF.litLo) },
        uLitHi: { value: vec3(RELIEF.litHi) },
        uShLo: { value: vec3(RELIEF.shadowLo) },
        uShHi: { value: vec3(RELIEF.shadowHi) },
        uNeuLo: { value: vec3(RELIEF.neutralLo) },
        uNeuHi: { value: vec3(RELIEF.neutralHi) },
        uSunCol: { value: vec3(hexToRgb(TOKENS.sun)) },
        uEarthCol: { value: vec3(hexToRgb(TOKENS.earth)) },
        uInk: { value: vec3(hexToRgb(TOKENS.ink)) },
        uPaper: { value: vec3(hexToRgb(TOKENS.paper)) },
        uEdges: { value: Array.from({ length: REGION_COUNT * 4 }, () => new Vector4(1e9, 1e9, 1, 0)) },
        uTint: { value: Array.from({ length: REGION_COUNT }, () => new Vector4(0, 0, 0, 0)) },
        uSelected: { value: -1 },
        uHovered: { value: -1 },
        uSite: { value: new Vector2() },
        uHasSite: { value: 0 },
        uSunBear: { value: new Vector2(0, 1) },
        uShowSunBear: { value: 0 },
        uEarthBear: { value: new Vector2(0, 1) },
        uShowEarthBear: { value: 0 },
        uFade: { value: new Vector3(400, 1600, 0.3) },
      },
    });

    this.surface = new Mesh(buildRelief(data), this.material);
    const sides = buildSides(data, range.min * K - 5);
    this.walls = new Mesh(sides.walls, new MeshBasicMaterial({ color: TOKENS.paper3, side: DoubleSide }));
    this.cut = new LineSegments(sides.cut, new LineBasicMaterial({ color: TOKENS.ink }));
    this.frame = new LineSegments(sides.frame, new LineBasicMaterial({ color: TOKENS.ink3 }));
  }

  /** Sun direction in the plate frame; null draws neutral relief without cast shadows. */
  setSun(sun: V3 | null) {
    const u = this.material.uniforms;
    u.uHasSun.value = sun ? 1 : 0;
    if (!sun) return;
    const next = new Vector3(sun[0], sun[1], sun[2]).normalize();
    const cur = u.uSun.value as Vector3;
    if (cur.distanceToSquared(next) > 1e-12 || this.bakeDirty) {
      cur.copy(next);
      (this.lightMaterial.uniforms.uSun.value as Vector3).copy(next);
      this.bakeDirty = true;
    }
  }

  setRegions(regions: (RegionShape | null)[]) {
    const edges = this.material.uniforms.uEdges.value as Vector4[];
    for (let i = 0; i < REGION_COUNT; i++) {
      const c = regions[i]?.corners;
      for (let j = 0; j < 4; j++) {
        if (!c || c.length < 4) {
          edges[i * 4 + j].set(1e9, 1e9, 1, 0);
          continue;
        }
        const a = c[j];
        const b = c[(j + 1) % 4];
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        // Outward normal of a counter-clockwise edge.
        edges[i * 4 + j].set(a.x, a.y, (b.y - a.y) / l, -(b.x - a.x) / l);
      }
    }
  }

  setHighlight(selected: number, hovered: number) {
    this.material.uniforms.uSelected.value = selected;
    this.material.uniforms.uHovered.value = hovered;
  }

  setTints(tints: (RGB | null)[] | null) {
    const arr = this.material.uniforms.uTint.value as Vector4[];
    for (let i = 0; i < REGION_COUNT; i++) {
      const c = tints?.[i];
      if (c) arr[i].set(c[0], c[1], c[2], 0.9);
      else arr[i].set(0, 0, 0, 0);
    }
  }

  setBearings(site: V2 | null, sun: V2 | null, earth: V2 | null) {
    const u = this.material.uniforms;
    u.uHasSite.value = site ? 1 : 0;
    if (site) (u.uSite.value as Vector2).set(site.x, site.y);
    u.uShowSunBear.value = site && sun ? 1 : 0;
    if (sun) (u.uSunBear.value as Vector2).set(sun.x, sun.y);
    u.uShowEarthBear.value = site && earth ? 1 : 0;
    if (earth) (u.uEarthBear.value as Vector2).set(earth.x, earth.y);
  }

  /** Per-frame uniforms, and the light pass when the Sun has moved. */
  beforeRender(gl: WebGLRenderer, camera: Camera, target: Vector3) {
    const u = this.material.uniforms;
    u.uDpr.value = gl.getPixelRatio();
    const d = camera.position.distanceTo(target);
    (u.uFade.value as Vector3).set(d * 1.8, d * 6, 0.32);
    const prev = gl.getRenderTarget();
    if (!this.openDone) {
      this.openDone = true;
      gl.setRenderTarget(this.openTarget);
      gl.render(this.openScene, this.lightCamera);
    }
    if (this.bakeDirty && u.uHasSun.value > 0.5) {
      this.bakeDirty = false;
      gl.setRenderTarget(this.lightTarget);
      gl.render(this.lightScene, this.lightCamera);
    }
    gl.setRenderTarget(prev);
  }

  /** Frees GPU memory. three.js re-uploads on next use, so the passes are marked to run again. */
  dispose() {
    this.openDone = false;
    this.bakeDirty = true;
    this.heightTex.dispose();
    this.lightTarget.dispose();
    this.lightMaterial.dispose();
    this.lightScene.traverse((o) => (o as Mesh).geometry?.dispose());
    this.openTarget.dispose();
    this.openMaterial.dispose();
    this.openScene.traverse((o) => (o as Mesh).geometry?.dispose());
    this.material.dispose();
    this.surface.geometry.dispose();
    for (const o of [this.walls, this.cut, this.frame]) {
      o.geometry.dispose();
      (o.material as MeshBasicMaterial).dispose();
    }
  }
}

function buildRelief(data: TerrainData): BufferGeometry {
  const { n, spacing, x0, y0, heights } = data.grid;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 3;
      pos[o] = (x0 + i * spacing) / 1000;
      pos[o + 1] = heights[j * n + i] * K;
      pos[o + 2] = -(y0 - j * spacing) / 1000;
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let t = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Counter-clockwise seen from above (+y).
      idx[t++] = a;
      idx[t++] = c;
      idx[t++] = b;
      idx[t++] = b;
      idx[t++] = c;
      idx[t++] = d;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** Side walls cut down to a flat base, the hairline along the cut, and the base frame. */
function buildSides(data: TerrainData, base: number) {
  const { n, spacing, x0, y0, heights } = data.grid;
  const at = (i: number, j: number): V3 => [(x0 + i * spacing) / 1000, heights[j * n + i] * K, -(y0 - j * spacing) / 1000];
  const ring: V3[] = [];
  for (let i = 0; i < n; i++) ring.push(at(i, 0));
  for (let j = 1; j < n; j++) ring.push(at(n - 1, j));
  for (let i = n - 2; i >= 0; i--) ring.push(at(i, n - 1));
  for (let j = n - 2; j > 0; j--) ring.push(at(0, j));
  const m = ring.length;

  const wallPos = new Float32Array(m * 6);
  const wallIdx: number[] = [];
  const cutPos = new Float32Array(m * 6);
  ring.forEach((p, k) => {
    wallPos.set([p[0], p[1], p[2], p[0], base, p[2]], k * 6);
    const a = 2 * k;
    const b = 2 * ((k + 1) % m);
    wallIdx.push(a, a + 1, b, b, a + 1, b + 1);
    const q = ring[(k + 1) % m];
    cutPos.set([p[0], p[1], p[2], q[0], q[1], q[2]], k * 6);
  });
  const walls = new BufferGeometry();
  walls.setAttribute("position", new BufferAttribute(wallPos, 3));
  walls.setIndex(wallIdx);
  const cut = new BufferGeometry();
  cut.setAttribute("position", new BufferAttribute(cutPos, 3));

  const corners = [ring[0], ring[n - 1], ring[2 * n - 2], ring[3 * n - 3]];
  const framePos: number[] = [];
  corners.forEach((p, k) => {
    const q = corners[(k + 1) % 4];
    framePos.push(p[0], base, p[2], q[0], base, q[2], p[0], base, p[2], p[0], p[1], p[2]);
  });
  const frame = new BufferGeometry();
  frame.setAttribute("position", new BufferAttribute(new Float32Array(framePos), 3));
  return { walls, cut, frame };
}
