// In-memory roots that should be browsable in addition to roots derived from
// persisted sessions. Stored on globalThis so Next.js hot-reload keeps them.
declare global {
  var __workspliceAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
  var __workspliceAdditionalAllowedRoots: Set<string> | undefined;
}

export function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function getAdditionalAllowedRoots(): Set<string> {
  if (!globalThis.__workspliceAdditionalAllowedRoots) {
    globalThis.__workspliceAdditionalAllowedRoots = new Set();
  }
  return globalThis.__workspliceAdditionalAllowedRoots;
}

export function allowFileRoot(root: string): void {
  if (!root) return;
  const normalizedRoot = normalizeSlashes(root);
  getAdditionalAllowedRoots().add(normalizedRoot);
  globalThis.__workspliceAllowedRootsCache?.roots.add(normalizedRoot);
}
