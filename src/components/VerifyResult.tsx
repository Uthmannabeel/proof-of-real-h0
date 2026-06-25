import type { Verification } from "@/lib/registry";
import { Certificate } from "./Certificate";

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

export function VerifyResult({ result }: { result: Verification }) {
  const copy = COPY[result.status];

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

        {result.distance !== null && result.status === "likely-altered" && (
          <p className="mono text-[0.78rem] text-[var(--color-ink-faint)] mt-4">
            fingerprint distance: {result.distance}/64 · confidence{" "}
            {(result.confidence * 100).toFixed(0)}%
          </p>
        )}
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
