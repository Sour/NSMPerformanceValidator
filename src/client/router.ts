import { useEffect, useState } from "react";

/** The page shown at each URL. */
export type Page = "Progress" | "Plan";

export const PAGE_PATHS: Record<Page, string> = { Progress: "/", Plan: "/plan" };

/** The page at the current URL, following the browser's back and forward buttons. */
export function usePage(): Page {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  return path === PAGE_PATHS.Plan ? "Plan" : "Progress";
}

/** Shows `page`, giving it its own URL so a refresh or bookmark comes back to it. */
export function navigate(page: Page): void {
  if (location.pathname === PAGE_PATHS[page]) return;
  history.pushState(null, "", PAGE_PATHS[page]);
  dispatchEvent(new PopStateEvent("popstate"));
}
