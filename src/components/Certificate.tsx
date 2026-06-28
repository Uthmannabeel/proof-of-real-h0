import type { Registration } from "@/lib/types";
import { formatBytes, formatDate, shortHash } from "@/lib/format";

interface CertificateProps {
  registration: Registration;
  /** Optional stamp override; defaults to a green "Registered Original". */
  stamp?: { label: string; tone: "green" | "red" | "amber" };
}

export function Certificate({ registration, stamp }: CertificateProps) {
  const badge = stamp ?? { label: "Registered Original", tone: "green" as const };

  return (
    <article className="doc-card p-6 sm:p-8">
      <header className="doc-rule pb-4 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Certificate of Registration</p>
          <h3 className="font-serif text-2xl sm:text-3xl mt-1 leading-tight">
            {registration.title}
          </h3>
        </div>
        <span className={`stamp stamp-${badge.tone} shrink-0`}>{badge.label}</span>
      </header>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 mt-5 text-sm">
        <Field label="Registry ID" value={registration.id} mono />
        <Field label="Registrant" value={registration.registrant} />
        <Field label="Registered" value={formatDate(registration.createdAt)} />
        <Field
          label="Dimensions"
          value={
            registration.width && registration.height
              ? `${registration.width} × ${registration.height}px`
              : "—"
          }
        />
        <Field label="Content hash (SHA-256)" value={shortHash(registration.contentHash)} mono full />
        <Field
          label="Perceptual fingerprint (dHash)"
          value={registration.phash}
          mono
          full
        />
        <Field label="File" value={registration.filename} />
        <Field label="Size" value={formatBytes(registration.bytes)} />
      </dl>

      <footer className="mt-6 pt-4 doc-rule border-b-0 border-t space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.78rem]">
          {registration.sealAlg === "ed25519" ? (
            <span className="mono text-[var(--color-stamp-green)] font-bold">✓ Sealed · Ed25519</span>
          ) : (
            <span className="mono text-[var(--color-ink-faint)]">Unsealed</span>
          )}
          <span className="mono text-[var(--color-ink-faint)]">
            record {shortHash(registration.recordHash, 6, 4)}
            {registration.prevHash
              ? ` ← prev ${shortHash(registration.prevHash, 6, 4)}`
              : " · genesis block"}
          </span>
        </div>
        <p className="mono text-[0.7rem] text-[var(--color-ink-faint)]">
          Provenance: {registration.provenance.map((p) => p.action).join(" → ")} ·{" "}
          {new Date(registration.createdAt).toISOString()}
        </p>
      </footer>
    </article>
  );
}

function Field({
  label,
  value,
  mono = false,
  full = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-1 break-all ${mono ? "mono text-[0.85rem]" : ""}`}>{value}</dd>
    </div>
  );
}
