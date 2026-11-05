// Where villagers can walk: a small graph of waypoints — along every lane (js/village/layout.js), round the
// square, from each lane to each house's garden gate, up the garden path to the door, and out to the places
// people work or sit (garden beds, pens, the well, wood piles, benches…). A link between two waypoints is only
// made where the straight line between them stays clear of houses, gardens, pens and props (clear()), so a
// villager following the graph never walks through a wall or a fence. The shortest routes between all
// waypoints are worked out once (Dijkstra from each one), so finding a route later costs nothing.
// Everything here uses plain arithmetic on the village layout, so every player's game builds the same graph.

// a binary heap of [cost, node] (deterministic: ties go to the smaller node id)
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(c, n) { const a = this.a; a.push([c, n]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (less(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && less(a[l], a[m])) m = l; if (r < a.length && less(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
}
const less = (x, y) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
export const dist2 = (ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az; return Math.sqrt(dx * dx + dz * dz); };

export class Nav {
  // blocked(x, z, ignore) -> is that point inside a house, garden, pen or prop (ignore: a garden that's allowed)
  constructor(blocked) { this.blocked = blocked; this.nodes = []; this.adj = []; this.ready = false; }
  node(x, z, tag = {}) { const id = this.nodes.length; this.nodes.push({ id, x, z, lane: !!tag.lane, ...tag }); this.adj.push([]); return id; }
  link(a, b) { if (a === b || a < 0 || b < 0 || this.adj[a].includes(b)) return; this.adj[a].push(b); this.adj[b].push(a); }
  // is the straight line from a to b clear (sampled every 0.3 m, the ends not tested)?
  clear(ax, az, bx, bz, ignore) {
    const L = dist2(ax, az, bx, bz), n = Math.max(1, Math.ceil(L / 0.3));
    for (let i = 1; i < n; i++) { const t = i / n; if (this.blocked(ax + (bx - ax) * t, az + (bz - az) * t, ignore)) return false; }
    return true;
  }
  // the nearest lane waypoint within r
  nearestLane(x, z, r = 1e9) {
    let best = -1, bd = r;
    for (const N of this.nodes) if (N.lane) { const d = dist2(x, z, N.x, N.z); if (d < bd) { bd = d; best = N.id; } }
    return best;
  }
  // link a new waypoint at (x, z) to the nearest waypoints it can reach in a straight line; tries a detour
  // round a corner when none can be reached directly. Returns its id, or -1 (unreachable).
  attach(x, z, tag = {}, opts = {}) {
    const id = this.node(x, z, tag);
    if (opts.to !== undefined) { this.link(id, opts.to); return id; }
    if (this._attach(id, opts)) return id;
    // a detour: a point round about (2–3.5 m away) that sees both this spot and the graph
    for (const r of [2.2, 3.5]) for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, wx = x + Math.cos(a) * r, wz = z + Math.sin(a) * r;
      if (this.blocked(wx, wz, opts.ignore) || !this.clear(x, z, wx, wz, opts.ignore)) continue;
      const w = this.node(wx, wz, {});
      if (this._attach(w, opts, id)) { this.link(id, w); return id; }
      this.nodes.pop(); this.adj.pop();
    }
    return -1;
  }
  _attach(id, opts, skip = -1) {
    const N = this.nodes[id], cands = [];
    for (const M of this.nodes) if (M.id !== id && M.id !== skip && (opts.only ? opts.only(M) : true)) { const d = dist2(N.x, N.z, M.x, M.z); if (d < (opts.max || 28)) cands.push([d, M.id]); }
    cands.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    let first = -1;
    for (const [d, m] of cands.slice(0, 14)) {
      const M = this.nodes[m];
      if (!this.clear(N.x, N.z, M.x, M.z, opts.ignore)) continue;
      if (first < 0) { first = d; this.link(id, m); if (opts.single) return true; }
      else if (d < first * 1.6 + 1) { this.link(id, m); return true; }
    }
    return first >= 0;
  }
  // all the shortest routes (call once, after every waypoint is in)
  finish() {
    const n = this.nodes.length;
    this.D = new Float64Array(n * n).fill(1e9); this.prev = new Int16Array(n * n).fill(-1);
    const w = (a, b) => dist2(this.nodes[a].x, this.nodes[a].z, this.nodes[b].x, this.nodes[b].z);
    for (let s = 0; s < n; s++) {
      const D = this.D, row = s * n, h = new Heap();
      D[row + s] = 0; h.push(0, s);
      while (h.size) {
        const [c, u] = h.pop();
        if (c > D[row + u]) continue;
        for (const v of this.adj[u]) { const nc = c + w(u, v); if (nc < D[row + v]) { D[row + v] = nc; this.prev[row + v] = u; h.push(nc, v); } }
      }
    }
    this.ready = true;
  }
  dist(a, b) { return this.D[a * this.nodes.length + b]; }
  reachable(a, b) { return this.dist(a, b) < 1e8; }
  // the waypoints from a to b
  route(a, b) {
    const n = this.nodes.length, out = [b];
    if (a === b) return out;
    let v = b, guard = 0;
    while (v !== a && guard++ < n) { v = this.prev[a * n + v]; if (v < 0) return [a, b]; out.push(v); }
    return out.reverse();
  }
  // a walkable line: from point P (optional), along the waypoints from a to b, to point Q (optional). Lane
  // corners are rounded off. Returns { pts: [[x, z, lane]…], cum: [distance at each point], len }
  polyline(a, b, P, Q) {
    const ids = this.route(a, b), pts = [];
    if (P) pts.push([P[0], P[1], 0]);
    for (const id of ids) { const N = this.nodes[id]; pts.push([N.x, N.z, N.lane ? 1 : 0]); }
    if (Q) pts.push([Q[0], Q[1], 0]);
    // drop points that are on top of each other
    const clean = [pts[0]];
    for (let i = 1; i < pts.length; i++) { const L = clean[clean.length - 1]; if (dist2(L[0], L[1], pts[i][0], pts[i][1]) > 0.05) clean.push(pts[i]); }
    // round the corners at lane waypoints (cut a quarter of each side)
    const sm = [clean[0]];
    for (let i = 1; i < clean.length - 1; i++) {
      const A = clean[i - 1], B = clean[i], C = clean[i + 1];
      if (B[2] && A[2] && C[2]) { sm.push([B[0] + (A[0] - B[0]) * 0.25, B[1] + (A[1] - B[1]) * 0.25, 1]); sm.push([B[0] + (C[0] - B[0]) * 0.25, B[1] + (C[1] - B[1]) * 0.25, 1]); }
      else sm.push(B);
    }
    if (clean.length > 1) sm.push(clean[clean.length - 1]);
    const cum = [0];
    for (let i = 1; i < sm.length; i++) cum.push(cum[i - 1] + dist2(sm[i - 1][0], sm[i - 1][1], sm[i][0], sm[i][1]));
    return { pts: sm, cum, len: cum[cum.length - 1] };
  }
}

// where along a polyline at distance s: x, z, direction (tx, tz), whether it's a lane bit, and how far from
// the line's ends (for easing the keep-to-the-left offset in and out). `hint` speeds up the search.
export function along(line, s, out, hint = 0) {
  const { pts, cum, len } = line;
  if (pts.length < 2) { out.x = pts[0][0]; out.z = pts[0][1]; out.tx = 0; out.tz = 1; out.lane = 0; out.i = 0; out.edge = 0; return out; }
  s = s < 0 ? 0 : s > len ? len : s;
  let i = Math.min(Math.max(0, hint), pts.length - 2);
  while (i < pts.length - 2 && cum[i + 1] < s) i++;
  while (i > 0 && cum[i] > s) i--;
  const A = pts[i], B = pts[i + 1], L = cum[i + 1] - cum[i] || 1, k = (s - cum[i]) / L;
  out.x = A[0] + (B[0] - A[0]) * k; out.z = A[1] + (B[1] - A[1]) * k;
  out.tx = (B[0] - A[0]) / L; out.tz = (B[1] - A[1]) / L; out.lane = A[2] && B[2] ? 1 : 0; out.i = i; out.edge = Math.min(s, len - s);
  return out;
}
