"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 20_000;

/** Keeps the claims desk live while settlements land on-chain. */
export function DeskRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <button type="button" className="btn btn-ghost" onClick={() => router.refresh()}>
      Refresh
    </button>
  );
}
