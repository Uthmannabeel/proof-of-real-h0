import type { Registration } from "@/lib/types";
import { formatDate, shortHash } from "@/lib/format";

export function Ledger({ records }: { records: Registration[] }) {
  if (records.length === 0) {
    return (
      <p className="text-[var(--color-ink-soft)] text-sm italic">
        The ledger is empty. Register the first original above.
      </p>
    );
  }

  return (
    <div className="doc-card overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="doc-rule">
            <th className="eyebrow p-3 font-normal">Title</th>
            <th className="eyebrow p-3 font-normal hidden sm:table-cell">Registrant</th>
            <th className="eyebrow p-3 font-normal hidden md:table-cell">Fingerprint</th>
            <th className="eyebrow p-3 font-normal">Registered</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="doc-rule last:border-b-0">
              <td className="p-3 font-serif">{r.title}</td>
              <td className="p-3 hidden sm:table-cell text-[var(--color-ink-soft)]">
                {r.registrant}
              </td>
              <td className="p-3 hidden md:table-cell mono text-[0.78rem] text-[var(--color-ink-soft)]">
                {shortHash(r.phash, 6, 4)}
              </td>
              <td className="p-3 mono text-[0.78rem] text-[var(--color-ink-soft)]">
                {formatDate(r.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
