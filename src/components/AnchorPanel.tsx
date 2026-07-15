"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResponse } from "@/lib/api";
import type { AnchorReceipt, AnchorStatus } from "@/lib/anchor";

interface AnchorPanelProps {
  /** Compact: a single evidence row for verdict cards. Full: the ledger-side notarization card. */
  compact?: boolean;
}

/**
 * Flare notarization status. The ledger's hash-chain head is periodically
 * anchored to the ProofOfRealAnchor contract on Flare Coston2, which makes
 * the whole registration history publicly tamper-provable.
 */
export function AnchorPanel({ compact = false }: AnchorPanelProps) {
  const [status, setStatus] = useState<AnchorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnchoring, setIsAnchoring] = useState(false);
  const [receipt, setReceipt] = useState<AnchorReceipt | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/anchor");
      const body = (await res.json()) as ApiResponse<AnchorStatus>;
      if (body.success && body.data) setStatus(body.data);
      else setError(body.error ?? "Could not load anchor status.");
    } catch {
      setError("Could not load anchor status.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function anchorNow() {
    setIsAnchoring(true);
    setError(null);
    try {
      const res = await fetch("/api/anchor", { method: "POST" });
      const body = (await res.json()) as ApiResponse<AnchorReceipt>;
      if (!body.success || !body.data) throw new Error(body.error ?? "Anchoring failed.");
      setReceipt(body.data);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Anchoring failed.");
    } finally {
      setIsAnchoring(false);
    }
  }

  if (compact) {
    return (
      <p className="mono text-[0.78rem] text-[var(--color-ink-faint)]">
        Flare anchor:{" "}
        {status === null ? (
          "checking…"
        ) : status.rpcError ? (
          "on-chain status temporarily unavailable"
        ) : status.headAnchored && status.latest ? (
          <>
            <span className="text-[var(--color-stamp-green)] font-bold">
              ledger notarized on Coston2
            </span>{" "}
            · {status.latest.recordCount} records ·{" "}
            <ExplorerLink href={status.explorerUrl}>contract</ExplorerLink>
          </>
        ) : status.latest ? (
          <>
            last anchor covers {status.latest.recordCount} records ·{" "}
            <ExplorerLink href={status.explorerUrl}>contract</ExplorerLink> · newer entries pending
          </>
        ) : (
          "not yet anchored on-chain"
        )}
      </p>
    );
  }

  return (
    <div className="doc-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Flare notarization</p>
          <p className="text-sm text-[var(--color-ink-soft)] mt-2 max-w-prose">
            The ledger&rsquo;s hash-chain head is anchored to a public contract on Flare
            (Coston2). Once anchored, no past record can be rewritten without the chain
            failing to match the on-chain head.
          </p>
        </div>
        {status && !status.rpcError && (
          <span
            className={`stamp ${status.headAnchored ? "stamp-green" : "stamp-amber"} shrink-0`}
          >
            {status.headAnchored ? "Notarized" : "Pending"}
          </span>
        )}
      </div>

      {status?.rpcError && (
        <p className="mono text-[0.78rem] text-[var(--color-ink-faint)] mt-3">
          on-chain status temporarily unavailable — the Flare network could not be reached
        </p>
      )}

      {status?.latest && (
        <p className="mono text-[0.78rem] text-[var(--color-ink-faint)] mt-3">
          latest anchor: {status.latest.recordCount} records ·{" "}
          {new Date(status.latest.anchoredAt).toLocaleString()} ·{" "}
          <ExplorerLink href={status.explorerUrl}>view contract</ExplorerLink>
        </p>
      )}

      {receipt && (
        <p className="mono text-[0.78rem] text-[var(--color-stamp-green)] mt-2">
          anchored in block {receipt.blockNumber} ·{" "}
          <ExplorerLink href={receipt.txUrl}>view transaction</ExplorerLink>
        </p>
      )}

      {status?.configured && !status.rpcError && !status.headAnchored && status.currentCount > 0 && (
        <button className="btn mt-4" disabled={isAnchoring} onClick={anchorNow} type="button">
          {isAnchoring ? "Anchoring…" : "Anchor ledger on Flare"}
        </button>
      )}

      {status !== null && !status.configured && (
        <p className="mono text-[0.72rem] text-[var(--color-ink-faint)] mt-3">
          anchoring not configured on this deployment
        </p>
      )}

      {error && <p className="mono text-[0.78rem] text-[var(--color-stamp-red)] mt-3">{error}</p>}
    </div>
  );
}

function ExplorerLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-ink)]"
    >
      {children}
    </a>
  );
}
