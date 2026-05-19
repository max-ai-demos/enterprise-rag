export function normalizeRotate(deg: number) {
  const normalized = ((deg % 360) + 360) % 360;
  return normalized;
}
