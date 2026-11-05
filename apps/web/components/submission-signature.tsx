"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";

// The salon's acknowledgement of one rep delivery, for the office to review before approving (P1-31, D-49). A delivery
// is final only with this signed acknowledgement of exactly these goods and the office's approval, so the page shows
// whether one exists and matches, lets the reviewer open the picture (each opening is logged by the database), and links
// to the invoice preview. The database refuses an approval without a valid signature; the button here only says so first.
export type SignatureStatus = {
  signature_id: string | null;
  outcome: "signed" | "refused" | "unable" | null;
  signatory_name: string | null;
  signatory_designation: string | null;
  signed_at: string | null;
  note: string | null;
  valid: boolean;
  has_picture: boolean;
};

const PICTURE_WIDTH = 300;
const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

export function SubmissionSignature({
  submissionId,
  orderId,
  onStatus,
}: {
  submissionId: string;
  orderId: string;
  onStatus?: (signed: boolean) => void;
}) {
  const [status, setStatus] = useState<SignatureStatus | null>(null);
  const [picture, setPicture] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const s = await rpc<SignatureStatus>("office_delivery_signature", { p_submission_id: submissionId });
        setStatus(s);
        onStatus?.(s.outcome === "signed" && s.valid);
      } catch (e) {
        setError((e as Error).message);
        onStatus?.(false);
      }
    };
    void load();
  }, [submissionId, onStatus]);

  const open = async () => {
    if (!status?.signature_id) return;
    setError(null);
    try {
      const b64 = await rpc<string>("office_signature_image", {
        p_signature_id: status.signature_id,
        p_purpose: "checking the delivery",
      });
      setPicture(`data:image/png;base64,${b64}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const signed = status?.outcome === "signed" && status.valid;
  return (
    <div className="muted" data-testid="signature-status">
      {!status && !error && <span aria-busy="true">Checking the customer&apos;s signature…</span>}
      {status && signed && (
        <span className="ok" data-testid="signature-valid">
          Signed by {status.signatory_name} ({status.signatory_designation}) on {status.signed_at ? when(status.signed_at) : ""},
          for exactly these goods.
        </span>
      )}
      {status && status.outcome === "signed" && !status.valid && (
        <span className="error" role="alert" data-testid="signature-mismatch">
          A signature exists but it is not for exactly these goods. It cannot make this delivery final.
        </span>
      )}
      {status && (status.outcome === "refused" || status.outcome === "unable") && (
        <span className="error" role="alert" data-testid="signature-refused">
          The salon did not sign ({status.outcome === "refused" ? "refused" : "no one could sign"}): {status.note}. This delivery
          cannot be approved; reject it so the goods return.
        </span>
      )}
      {status && status.outcome === null && (
        <span className="error" role="alert" data-testid="signature-missing">
          No customer signature has been recorded. A delivery is final only with the salon&apos;s signature and your approval.
        </span>
      )}
      {error && (
        <span className="error" role="alert">
          {" "}
          {error}
        </span>
      )}
      <div className="row">
        {status?.has_picture && (
          <button type="button" className="inline" onClick={() => void open()}>
            View the signature
          </button>
        )}
        <Link href={`/office/orders/${orderId}/invoice?submission=${submissionId}`}>Preview the invoice</Link>
      </div>
      {picture && (
        // A data URL from the database, never a stored link; the picture is the customer's signature, shown only to the office.
        // biome-ignore lint/performance/noImgElement: a data URL is not an optimisable remote image.
        <img
          src={picture}
          alt="The customer's signature"
          style={{ maxWidth: PICTURE_WIDTH, border: "1px solid var(--border)", background: "#fff" }}
        />
      )}
    </div>
  );
}
