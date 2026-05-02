const FEDEX_TRACK_BASE_URL = "https://www.fedex.com/fedextrack/?trknbr=";
const MOCK_LABEL_BASE_URL = "https://storkbin.local/mock-fedex/labels/";

const randomAlphaNumeric = (length = 10) =>
  Array.from({ length }, () => Math.floor(Math.random() * 36).toString(36))
    .join("")
    .toUpperCase();

export function createMockFedExLabel({ shipment }) {
  const trackingNumber =
    shipment?.tracking_number || `MOCK-FDX-${randomAlphaNumeric(12)}`;

  return {
    carrier: "fedex",
    trackingNumber,
    trackingUrl: `${FEDEX_TRACK_BASE_URL}${encodeURIComponent(trackingNumber)}`,
    labelUrl: `${MOCK_LABEL_BASE_URL}${encodeURIComponent(trackingNumber)}.pdf`,
  };
}
