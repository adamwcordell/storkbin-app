import { useEffect, useState } from "react";

const MOBILE_MAX_WIDTH_PX = 639;

/** Matches `index.css` mobile breakpoints for customer bin cards. */
export function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
