/** Parse `1.2.3` or `v1.2.3`; missing patch defaults to 0. */
export function parseSemver(version: string): [number, number, number] | null {
  let s = version.trim();
  if (s.startsWith("v") || s.startsWith("V")) {
    s = s.slice(1);
  }
  const plus = s.indexOf("+");
  if (plus >= 0) {
    s = s.slice(0, plus);
  }
  const dash = s.indexOf("-");
  if (dash >= 0) {
    s = s.slice(0, dash);
  }
  const parts = s.split(".");
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = parts.length === 3 ? Number(parts[2]) : 0;
  if (![major, minor, patch].every((n) => Number.isInteger(n) && n >= 0)) {
    return null;
  }
  return [major, minor, patch];
}

/** Strict greater-than on major → minor → patch. */
export function isVersionNewer(candidate: string, installed: string): boolean {
  const a = parseSemver(candidate);
  const b = parseSemver(installed);
  if (!a || !b) {
    return false;
  }
  if (a[0] !== b[0]) {
    return a[0] > b[0];
  }
  if (a[1] !== b[1]) {
    return a[1] > b[1];
  }
  return a[2] > b[2];
}
