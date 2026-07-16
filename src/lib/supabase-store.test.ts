import { describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseStore } from "./supabase-store";
import type { Registration } from "./types";

interface Row {
  id: string;
  content_hash: string;
  phash: string;
  bands: string[];
  created_at: string;
  record: Registration;
}

/**
 * In-memory stand-in for the supabase-js query builder covering exactly the
 * chains SupabaseStore uses: upsert / select().eq().maybeSingle() /
 * select().eq().limit() / select().overlaps() / select().order().limit().
 */
class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private rows: Row[];

  constructor(private readonly table: Row[]) {
    this.rows = [...table];
  }

  upsert(row: Row) {
    const i = this.table.findIndex((r) => r.id === row.id);
    if (i >= 0) this.table[i] = row;
    else this.table.push(row);
    return Promise.resolve({ data: null, error: null });
  }

  select(_cols: string) {
    return this;
  }

  eq(col: keyof Row, value: string) {
    this.rows = this.rows.filter((r) => r[col] === value);
    return this;
  }

  overlaps(col: "bands", values: string[]) {
    this.rows = this.rows.filter((r) => r[col].some((b) => values.includes(b)));
    return this;
  }

  order(col: "created_at", opts: { ascending: boolean }) {
    this.rows.sort((a, b) =>
      opts.ascending ? a[col].localeCompare(b[col]) : b[col].localeCompare(a[col]),
    );
    return this;
  }

  limit(n: number) {
    this.rows = this.rows.slice(0, n);
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }

  then<T1 = { data: Row[]; error: null }, T2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

function fakeClient(): { client: SupabaseClient; table: Row[] } {
  const table: Row[] = [];
  const client = { from: () => new FakeQuery(table) } as unknown as SupabaseClient;
  return { client, table };
}

function makeRegistration(
  id: string,
  contentHash: string,
  phash: string,
  createdAt: string,
): Registration {
  return {
    id,
    title: `Title ${id}`,
    registrant: "tester",
    mediaType: "image",
    filename: `${id}.jpg`,
    contentHash,
    phash,
    width: 100,
    height: 100,
    bytes: 1234,
    createdAt,
    provenance: [{ at: createdAt, action: "registered" }],
    prevHash: null,
    recordHash: "r".repeat(64),
    seal: "sig",
    sealAlg: "ed25519",
  };
}

describe("SupabaseStore", () => {
  test("put then getById round-trips the full record", async () => {
    const { client } = fakeClient();
    const store = new SupabaseStore(client);
    const reg = makeRegistration("a1", "c".repeat(64), "00ff00ff00ff00ff", "2026-07-16T00:00:00Z");

    await store.put(reg);
    expect(await store.getById("a1")).toEqual(reg);
    expect(await store.getById("missing")).toBeNull();
  });

  test("findByContentHash matches exact hash only", async () => {
    const { client } = fakeClient();
    const store = new SupabaseStore(client);
    const reg = makeRegistration("a1", "c".repeat(64), "00ff00ff00ff00ff", "2026-07-16T00:00:00Z");

    await store.put(reg);
    expect((await store.findByContentHash("c".repeat(64)))?.id).toBe("a1");
    expect(await store.findByContentHash("d".repeat(64))).toBeNull();
  });

  test("findNearest returns the closest record within maxDistance", async () => {
    const { client } = fakeClient();
    const store = new SupabaseStore(client);
    // Same phash except the last hex digit (f -> e is 1 bit) — shares 7/8 bands.
    await store.put(makeRegistration("near", "1".repeat(64), "00ff00ff00ff00fe", "2026-07-16T00:00:00Z"));
    await store.put(makeRegistration("far", "2".repeat(64), "ffffffffffffffff", "2026-07-16T01:00:00Z"));

    const match = await store.findNearest("00ff00ff00ff00ff", 8);
    expect(match?.record.id).toBe("near");
    expect(match?.distance).toBe(1);
  });

  test("findNearest ignores matches beyond maxDistance", async () => {
    const { client } = fakeClient();
    const store = new SupabaseStore(client);
    // Shares band 0 but differs by many bits overall.
    await store.put(makeRegistration("a1", "3".repeat(64), "00ffffffffffffff", "2026-07-16T00:00:00Z"));

    expect(await store.findNearest("00ff00ff00ff00ff", 8)).toBeNull();
  });

  test("list returns newest first, capped at limit", async () => {
    const { client } = fakeClient();
    const store = new SupabaseStore(client);
    await store.put(makeRegistration("old", "4".repeat(64), "00ff00ff00ff00ff", "2026-07-14T00:00:00Z"));
    await store.put(makeRegistration("mid", "5".repeat(64), "00ff00ff00ff00ff", "2026-07-15T00:00:00Z"));
    await store.put(makeRegistration("new", "6".repeat(64), "00ff00ff00ff00ff", "2026-07-16T00:00:00Z"));

    const listed = await store.list(2);
    expect(listed.map((r) => r.id)).toEqual(["new", "mid"]);
  });

  test("constructor without client requires env configuration", () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(() => new SupabaseStore()).toThrow(/SUPABASE_URL/);
    } finally {
      if (url !== undefined) process.env.SUPABASE_URL = url;
      if (key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    }
  });
});
