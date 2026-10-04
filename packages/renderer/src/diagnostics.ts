import type { Material, Mesh, Object3D } from 'three/webgpu';
export function countLiveMaterials(roots: Object3D[]): number {
 const materials = new Set<Material>();
 for (const root of roots) root.traverse(object => {
  const material = (object as Mesh).material;
  if (material) for (const item of Array.isArray(material) ? material : [material]) materials.add(item);
 });
 return materials.size;
}
export function createDiagnosticsSampler() {
 let last = -Infinity;
 return (now: number): boolean => {
  if (!Number.isFinite(now) || now - last < 1000) return false;
  last = now; return true;
 };
}
