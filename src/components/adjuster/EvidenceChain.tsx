export type StationStatus = "pending" | "active" | "done" | "failed";

export interface StationLine {
  text: string;
  tone?: "green" | "amber" | "red" | "faint";
  href?: string;
}

export interface Station {
  id: string;
  title: string;
  status: StationStatus;
  /** Small annotation beside the title, e.g. "≈ 90 s". */
  note?: string;
  lines: StationLine[];
}

const GLYPH: Record<StationStatus, string> = {
  pending: "",
  active: "›",
  done: "✓",
  failed: "✕",
};

const TONE_CLASS: Record<NonNullable<StationLine["tone"]>, string> = {
  green: "text-[var(--color-stamp-green)]",
  amber: "text-[var(--color-stamp-amber)]",
  red: "text-[var(--color-stamp-red)]",
  faint: "text-[var(--color-ink-faint)]",
};

/**
 * The claim file's spine — a vertical docket that fills in live as the claim
 * moves through photo → confidential check → chain → weather → payout.
 */
export function EvidenceChain({ stations }: { stations: Station[] }) {
  return (
    <ol className="chain">
      {stations.map((station) => (
        <li key={station.id} className={`chain-station is-${station.status}`}>
          <span className="chain-marker" aria-hidden="true">
            {GLYPH[station.status]}
          </span>
          <div className="flex items-baseline gap-x-3 flex-wrap">
            <h4 className="chain-title">{station.title}</h4>
            {station.note && <span className="eyebrow normal-case">{station.note}</span>}
          </div>
          {station.lines.length > 0 && (
            <ul className="chain-body mt-1.5 space-y-1">
              {station.lines.map((line, i) => (
                <li
                  key={i}
                  className={`text-sm leading-snug ${line.tone ? TONE_CLASS[line.tone] : "text-[var(--color-ink-soft)]"}`}
                >
                  {line.href ? (
                    <a
                      className="underline underline-offset-2 hover:text-[var(--color-ink)]"
                      href={line.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {line.text} ↗
                    </a>
                  ) : (
                    line.text
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
