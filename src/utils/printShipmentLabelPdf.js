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
 * @returns {Promise<boolean>} — resolves once the print dialog has been opened (not when it closes)
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
    let printInvoked = false;
    let loadFallbackTimer = null;
    let cleanupTimer = null;

    const tearDown = () => {
      iframe.remove();
      revoke?.();
    };

    const scheduleCleanup = () => {
      const onAfterPrint = () => {
        window.clearTimeout(cleanupTimer);
        tearDown();
        opts.onFinish?.();
      };

      window.addEventListener("afterprint", onAfterPrint, { once: true });
      try {
        iframe.contentWindow?.addEventListener("afterprint", onAfterPrint, { once: true });
      } catch {
        /* cross-origin or detached frame */
      }

      cleanupTimer = window.setTimeout(() => {
        window.removeEventListener("afterprint", onAfterPrint);
        tearDown();
        opts.onFinish?.();
      }, 30_000);
    };

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (loadFallbackTimer != null) window.clearTimeout(loadFallbackTimer);
      resolve(ok);
    };

    const invokePrint = () => {
      if (printInvoked) return;
      printInvoked = true;
      if (loadFallbackTimer != null) window.clearTimeout(loadFallbackTimer);

      try {
        const frameWindow = iframe.contentWindow;
        if (!frameWindow) {
          tearDown();
          finish(false);
          return;
        }

        frameWindow.focus();
        frameWindow.print();

        // Resolve immediately so UI unlocks; the modal print dialog blocks interaction anyway.
        finish(true);
        scheduleCleanup();
      } catch {
        tearDown();
        finish(false);
      }
    };

    iframe.onload = () => {
      window.setTimeout(invokePrint, 350);
    };

    iframe.onerror = () => {
      tearDown();
      finish(false);
    };

    // Chrome's PDF iframe viewer often never fires `onload` for blob/data URLs.
    loadFallbackTimer = window.setTimeout(invokePrint, 1_500);

    iframe.src = src;
    document.body.appendChild(iframe);
  });
}
