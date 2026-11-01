/**
 * View preferences remembered per browser. Storage can be unavailable (a private window, blocked site data), so a
 * failed read gives null and a failed write is dropped: the page then just uses its defaults.
 */
const PREFIX = "nsmpv.";

export function loadViewPreference(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function saveViewPreference(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Not remembered; the default applies on the next visit.
  }
}
