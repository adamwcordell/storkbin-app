import { supabase } from "../supabaseClient";

/**
 * Print a shipping label PDF from the current page (no navigation).
 * Uses a hidden iframe so the browser print dialog targets the PDF, not the app shell.
 */
function dataUrlToBlobUrl(dataUrl) {
  const raw = String(dataUrl || "").trim();
  const match = raw.match(/^data:application\/pdf;base64,(.+)$/i);
  if (!match) return null;

  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

function resolvePdfSrc(labelUrl) {
  const url = String(labelUrl || "").trim();
  if (!url) return { src: "", revoke: null };

  if (url.startsWith("data:application/pdf")) {
    const blobUrl = dataUrlToBlobUrl(url);
    return {
      src: blobUrl || url,
      revoke: blobUrl
        ? () => {
            URL.revokeObjectURL(blobUrl);
          }
        : null,
    };
  }

  if (/^https?:\/\//i.test(url)) {
    return { src: url, revoke: null };
  }

  return { src: "", revoke: null };
}

export function canPrintShipmentLabelPdf(labelUrl) {
  const url = String(labelUrl || "").trim();
  return (
    /^data:application\/pdf/i.test(url) ||
    (/^https?:\/\//i.test(url) && /\.pdf(?:$|[?#])/i.test(url))
  );
}

/** Load label_url from DB when the client shipment row omits the large data URL. */
export async function resolveShipmentLabelPdfUrl({ labelUrl, trackingNumber, shipmentId } = {}) {
  const direct = String(labelUrl || "").trim();
  if (canPrintShipmentLabelPdf(direct)) return direct;

  const id = String(shipmentId || "").trim();
  const tracking = String(trackingNumber || "").trim();

  let query = supabase.from("shipments").select("label_url");
  if (id) {
    query = query.eq("id", id);
  } else if (tracking) {
    query = query.eq("tracking_number", tracking);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;

  const fetched = String(data.label_url || "").trim();
  return canPrintShipmentLabelPdf(fetched) ? fetched : null;
}

/**
 * @param {string} labelUrl
 * @param {{ onFinish?: () => void }} [opts] — called after print dialog closes (print or cancel)
 * @returns {Promise<boolean>}
 */
export function printShipmentLabelPdf(labelUrl, opts = {}) {
  const { src, revoke } = resolvePdfSrc(labelUrl);
  if (!src) return Promise.resolve(false);

  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", "Shipping label print");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";

    let settled = false;
    let fallbackTimer = null;

    const cleanupListeners = () => {
      window.removeEventListener("afterprint", onParentAfterPrint);
      window.removeEventListener("focus", onWindowFocus);
    };

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
      cleanupListeners();
      iframe.remove();
      revoke?.();
      opts.onFinish?.();
      resolve(ok);
    };

    const onParentAfterPrint = () => finish(true);

    // Print dialog is opened from the iframe; parent `afterprint` often never fires.
    const onWindowFocus = () => {
      window.setTimeout(() => finish(true), 400);
    };

    iframe.onload = () => {
      window.setTimeout(() => {
        try {
          const frameWindow = iframe.contentWindow;
          if (!frameWindow) {
            finish(false);
            return;
          }

          window.addEventListener("afterprint", onParentAfterPrint, { once: true });
          window.addEventListener("focus", onWindowFocus, { once: true });
          frameWindow.addEventListener("afterprint", () => finish(true), { once: true });

          frameWindow.focus();
          frameWindow.print();

          // Unlock UI shortly after print dialog closes (focus/afterprint) or if neither fires.
          fallbackTimer = window.setTimeout(() => finish(true), 8_000);
        } catch {
          finish(false);
        }
      }, 350);
    };

    iframe.onerror = () => finish(false);
    iframe.src = src;
    document.body.appendChild(iframe);
  });
}
