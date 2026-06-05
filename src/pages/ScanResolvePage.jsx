import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import styles from "../styles/styles";
import { resolveAdminBoxId } from "../utils/binIntake";
import { isSafeBoxIdPathSegment } from "../utils/boxIdRef";

/**
 * Smart router for `/scan/:boxIdOrToken` when the user is already signed in.
 *
 * Query flags (encode on printed QRs):
 * - `?customer=1` — customer sticker on the bin (warehouse staff logged in as admin → receive/intake flow).
 * - `?admin=1` — warehouse sticker → receive/intake flow.
 * - (no flag) — if you own the bin → customer card; else if admin → receive/intake; else denied.
 */
export default function ScanResolvePage({ appData }) {
  const { boxIdOrToken } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const raw = String(boxIdOrToken || "").trim();
  const customerIntent = searchParams.get("customer") === "1";
  const adminIntent = searchParams.get("admin") === "1";

  const [phase, setPhase] = useState(() => (!raw ? "denied" : "working"));
  const [message, setMessage] = useState(() => (!raw ? "Missing bin reference." : ""));

  useEffect(() => {
    if (!raw) return undefined;

    if (!isSafeBoxIdPathSegment(raw)) {
      setPhase("denied");
      setMessage("This scan link is not valid.");
      return undefined;
    }

    let cancelled = false;

    (async () => {
      const uid = appData?.user?.id;
      if (!uid) {
        if (!cancelled) {
          setPhase("denied");
          setMessage("You need to be signed in.");
        }
        return;
      }

      try {
        const goCustomerBin = (id) => {
          navigate(`/bins/${id}?from_scan=1`, { replace: true });
        };

        const goAdminIntake = (id) => {
          navigate(`/admin/intake/${id}`, { replace: true });
        };

        const resolveAdminTargetId = async () => resolveAdminBoxId(supabase, raw);

        const loadOwnedBoxId = async () => {
          const { data: mine, error: mineErr } = await supabase
            .from("boxes")
            .select("id")
            .eq("id", raw)
            .eq("user_id", uid)
            .maybeSingle();
          if (mineErr || !mine?.id) return null;
          return String(mine.id);
        };

        // Customer sticker — admin staff go to warehouse receive flow; owners see their bin.
        if (customerIntent) {
          if (appData?.isAdmin) {
            const adminId = await resolveAdminTargetId();
            if (cancelled) return;
            if (adminId) {
              goAdminIntake(adminId);
              return;
            }
            setPhase("denied");
            setMessage("This bin was not found for warehouse intake.");
            return;
          }

          const owned = await loadOwnedBoxId();
          if (cancelled) return;
          if (owned) {
            goCustomerBin(owned);
            return;
          }
          setPhase("denied");
          setMessage("This bin is not linked to your account.");
          return;
        }

        // Warehouse sticker — admin only.
        if (adminIntent) {
          if (!appData?.isAdmin) {
            if (!cancelled) {
              setPhase("denied");
              setMessage("This link is for warehouse staff. Sign in with an admin account.");
            }
            return;
          }
          const adminId = await resolveAdminTargetId();
          if (cancelled) return;
          if (adminId) {
            goAdminIntake(adminId);
            return;
          }
          setPhase("denied");
          setMessage("This bin was not found for warehouse intake.");
          return;
        }

        // Plain /scan/:id — owners see their bin first (so admin accounts still get the customer phone flow).
        const owned = await loadOwnedBoxId();
        if (cancelled) return;
        if (owned) {
          goCustomerBin(owned);
          return;
        }

        if (appData?.isAdmin) {
          const adminId = await resolveAdminTargetId();
          if (cancelled) return;
          if (adminId) {
            goAdminIntake(adminId);
            return;
          }
          setPhase("denied");
          setMessage("This bin was not found for warehouse intake.");
          return;
        }

        setPhase("denied");
        setMessage("This bin is not linked to your account.");
      } catch (e) {
        if (!cancelled) {
          setPhase("denied");
          setMessage(e instanceof Error ? e.message : "Something went wrong.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [raw, boxIdOrToken, customerIntent, adminIntent, appData?.isAdmin, appData?.user?.id, navigate]);

  if (phase === "denied") {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>Cannot open this bin</h2>
        <p style={styles.mutedText}>{message || "Access denied."}</p>
        <div style={{ ...styles.row, marginTop: "16px", flexWrap: "wrap", gap: "10px" }}>
          <Link to="/dashboard" style={styles.linkButtonSecondary}>
            Dashboard
          </Link>
          <Link to="/bins" style={styles.linkButtonSecondary}>
            My bins
          </Link>
          {appData?.isAdmin && (
            <Link to="/admin" style={styles.linkButtonSecondary}>
              Admin
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <h2 style={styles.sectionTitle}>Opening bin…</h2>
      <p style={styles.mutedText}>Checking your access and routing you to the right screen.</p>
    </div>
  );
}
