import type { Verification } from "@/lib/registry";
import { Certificate } from "./Certificate";
import { AnchorPanel } from "./AnchorPanel";

const COPY: Record<
  Verification["status"],
  { label: string; tone: "green" | "red" | "amber"; headline: string; body: string }
> = {
  "registered-original": {
    label: "Authentic Original",
    tone: "green",
    headline: "This is a registered original.",
    body: "The exact bytes of this file match a registration on the public ledger.",
  },
  "likely-altered": {
    label: "Altered Copy",
    tone: "amber",
    headline: "This looks like an altered copy of a registered original.",
    body: "The image did not match byte-for-byte, but its perceptual fingerprint is close to a registered original.",
  },
  unregistered: {
    label: "Not Registered",
    tone: "red",
    headline: "No matching original found.",
    body: "This image is not in the registry and is not a near match to anything registered. It carries no provenance here.",
  },
};

interface EvidenceRow {
  check: string;
  finding: string;
  pass: boolean | null; // null = informational
}

/** Every check the verifier ran, with its concrete finding — verdicts must be explainable. */
function buildEvidence(result: Verification): EvidenceRow[] {
  const rows: EvidenceRow[] = [
    {
      check: "Exact bytes · SHA-256",
      finding:
        result.status === "registered-original"
          ? "byte-for-byte match with a registered original"
          : "no registered original has these exact bytes",
      pass: result.status === "registered-original",
    },
    {
      check: "Perceptual fingerprint · dHash",
      finding:
        result.distance === null
          ? "no registered original within 10/64 bits — not a recognizable derivative"
          : result.distance === 0
            ? "identical fingerprint (0/64 bits differ)"
            : `${result.distance}/64 bits differ from a registered original · ${(result.confidence * 100).toFixed(0)}% confidence`,
      pass: result.distance !== null,
    },
  ];

  if (result.registration) {
    rows.push({
      check: "Matched record seal · Ed25519",
      finding:
        result.registration.sealAlg === "ed25519"
          ? "record is cryptographically sealed by the registry key"
          : "record predates sealing — unsealed",
      pass: result.registration.sealAlg === "ed25519",
    });
    rows.push({
      check: "Hash-chain position",
      finding: result.registration.prevHash
        ? `chained to prior record ${result.registration.prevHash.slice(0, 10)}…`
        : "genesis record of the ledger",
      pass: null,
    });
  }

  return rows;
}

export function VerifyResult({ result }: { result: Verification }) {
  const copy = COPY[result.status];
  const evidence = buildEvidence(result);

  return (
    <div className="space-y-5">
      <div className="doc-card p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Verification Result</p>
            <h3 className="font-serif text-2xl sm:text-3xl mt-1 leading-tight">{copy.headline}</h3>
          </div>
          <span className={`stamp stamp-${copy.tone} shrink-0`}>{copy.label}</span>
        </div>
        <p className="text-[var(--color-ink-soft)] mt-4 max-w-prose">{copy.body}</p>

        <div className="mt-6 doc-rule border-b-0 border-t pt-4">
          <p className="eyebrow mb-3">Evidence — checks performed</p>
          <ul className="space-y-2">
            {evidence.map((row) => (
              <li key={row.check} className="flex gap-3 items-baseline">
                <span
                  className={`mono text-[0.8rem] font-bold shrink-0 ${
                    row.pass === null
                      ? "text-[var(--color-ink-faint)]"
                      : row.pass
                        ? "text-[var(--color-stamp-green)]"
                        : "text-[var(--color-stamp-red)]"
                  }`}
                >
                  {row.pass === null ? "·" : row.pass ? "✓" : "✕"}
                </span>
                <span className="text-sm">
                  <span className="mono text-[0.78rem] text-[var(--color-ink-faint)]">
                    {row.check}
                  </span>
                  <br />
                  {row.finding}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <AnchorPanel compact />
          </div>
        </div>
      </div>

      {result.registration && (
        <div>
          <p className="eyebrow mb-2">Matched record on file</p>
          <Certificate
            registration={result.registration}
            stamp={{
              label: result.status === "registered-original" ? "Registered Original" : "Source of Record",
              tone: result.status === "registered-original" ? "green" : "amber",
            }}
          />
        </div>
      )}
    </div>
  );
}
