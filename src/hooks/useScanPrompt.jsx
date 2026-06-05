import { useCallback, useState } from "react";
import QrScanModal from "../components/QrScanModal";

/**
 * Promise-based scan prompt — opens QrScanModal instead of window.prompt().
 * Resolves with trimmed string or null when cancelled / empty.
 */
export function useScanPrompt() {
  const [request, setRequest] = useState(null);

  const scanPrompt = useCallback((options) => {
    return new Promise((resolve) => {
      setRequest({ ...options, resolve });
    });
  }, []);

  const close = useCallback((value) => {
    setRequest((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const scanModal = request ? (
    <QrScanModal
      title={request.title || "Scan"}
      message={request.message || ""}
      expectedHint={request.expectedHint || ""}
      scanMode={request.scanMode || "qr_url"}
      delayScanStartMs={request.delayScanStartMs ?? 0}
      manualPlaceholder={request.manualPlaceholder || ""}
      onResult={(value) => close(value)}
      onCancel={() => close(null)}
    />
  ) : null;

  return { scanPrompt, scanModal };
}
