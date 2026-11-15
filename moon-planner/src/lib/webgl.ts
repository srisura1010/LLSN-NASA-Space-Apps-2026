// Graphics support checks, run once per page and cached.

let gl1: boolean | null = null;
let gl2: boolean | null = null;

function probe(kind: "webgl2" | "any"): boolean {
  try {
    const c = document.createElement("canvas");
    const ctx = kind === "webgl2" ? c.getContext("webgl2") : (c.getContext("webgl2") ?? c.getContext("webgl"));
    const ok = !!ctx;
    (ctx as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

/** WebGL 1 or 2: enough for the Moon globe and the System diagram. */
export function hasWebGL(): boolean {
  if (gl1 === null) gl1 = probe("any");
  return gl1;
}

/** WebGL 2: the terrain plate's shaders need it. */
export function hasWebGL2(): boolean {
  if (gl2 === null) gl2 = probe("webgl2");
  return gl2;
}
