import * as THREE from 'three';
import { GeoBuilder } from './utils.js';

const KEY = 'rv-jungle-save-v1';

// Progress is kept in this browser (localStorage). Every call is wrapped: private mode etc. just means "no save".
export const Save = {
  has() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } },
  load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
  write(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; } },
  clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } },
};

// Flags beside the road at every RV checkpoint. Orange = not reached yet, green = reached (saved).
export class CheckpointFlags {
  constructor(scene, world, svals) {
    this.t = 0;
    this.flags = svals.map((s, i) => {
      const p = world.T.road.pointAt(s), x = p.x + p.tz * 6.2, z = p.z - p.tx * 6.2, y = world.heightAt(x, z);
      const b = new GeoBuilder();
      b.cyl(0.07, 0.09, 3.4, 6, 0, 1.7, 0, 0xf2f2ee);
      for (let k = 0; k < 6; k++) { const a = k * 1.05; b.add(new THREE.DodecahedronGeometry(0.2, 0), 0x7d7b76, Math.cos(a) * 0.35, 0.1, Math.sin(a) * 0.35, a, a, 0); }
      const g = b.build(); g.position.set(x, y, z);
      const mat = new THREE.MeshLambertMaterial({ color: 0xf28c28, emissive: 0xf28c28, emissiveIntensity: 0.35, side: THREE.DoubleSide });
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75, 4, 1), mat);
      flag.position.set(0.62, 3.0, 0); g.add(flag);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.05, 4, 24), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.7 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.08; g.add(ring);
      scene.add(g);
      world.addCollider({ x, z, r: 0.25 });
      return { i, pos: new THREE.Vector3(x, y, z), mat, flag, ring, reached: false };
    });
    this.setReached(0);
  }
  setReached(n) {
    for (const f of this.flags) {
      const r = f.i <= n;
      if (r === f.reached) continue;
      f.reached = r;
      f.mat.color.setHex(r ? 0x3fbf5a : 0xf28c28); f.mat.emissive.setHex(r ? 0x3fbf5a : 0xf28c28);
      f.ring.material.color.setHex(r ? 0x6dff8a : 0xffd34d);
    }
  }
  acts(onSave) { return this.flags.map(f => ({ pos: f.pos, r: 2.6, label: () => '💾 Save progress (checkpoint)', act: () => onSave(f.i) })); }
  update(dt) {
    this.t += dt;
    for (const f of this.flags) { f.flag.rotation.y = Math.sin(this.t * 2 + f.i) * 0.25; f.ring.material.opacity = 0.45 + Math.sin(this.t * 3) * 0.25; }
  }
}
