import { describe, expect, it, vi } from "vitest";
import {
  anchorLine,
  escapeHtml,
  formatVerdict,
  handleUpdate,
  pickImage,
  statusText,
  MAX_UPLOAD_BYTES,
} from "./core.mjs";

const REGISTRATION = {
  id: "abc123def456",
  title: "Field <photo>",
  registrant: "PINL & Co",
  createdAt: "2026-07-15T10:00:00.000Z",
};

const ANCHORED = {
  configured: true,
  headAnchored: true,
  currentCount: 3,
  explorerUrl: "https://coston2-explorer.flare.network/address/0x438b",
  latest: { recordCount: 3, anchoredAt: "2026-07-15T12:00:00.000Z" },
  rpcError: null,
};

function makeDeps(overrides = {}) {
  return {
    reply: vi.fn(async (_chatId, html) => html),
    getFileBuffer: vi.fn(async () => Buffer.from("bytes")),
    verifyImage: vi.fn(async () => ({
      status: "registered-original",
      registration: REGISTRATION,
      distance: 0,
      confidence: 1,
    })),
    fetchAnchorStatus: vi.fn(async () => ANCHORED),
    ...overrides,
  };
}

describe("escapeHtml", () => {
  it("escapes ampersands and angle brackets", () => {
    expect(escapeHtml('<b>&"</b>')).toBe('&lt;b&gt;&amp;"&lt;/b&gt;');
  });
});

describe("pickImage", () => {
  it("selects the largest photo size", () => {
    const message = {
      photo: [{ file_id: "small" }, { file_id: "medium" }, { file_id: "large" }],
    };
    expect(pickImage(message)).toEqual({ fileId: "large", mime: "image/jpeg", filename: "photo.jpg" });
  });

  it("accepts image documents of supported types", () => {
    const message = {
      document: { file_id: "doc1", mime_type: "image/png", file_name: "scan.png", file_size: 1000 },
    };
    expect(pickImage(message)).toEqual({ fileId: "doc1", mime: "image/png", filename: "scan.png" });
  });

  it("rejects unsupported image mime types", () => {
    const message = { document: { file_id: "d", mime_type: "image/tiff" } };
    expect(pickImage(message).error).toMatch(/Unsupported type/);
  });

  it("rejects documents over the upload limit", () => {
    const message = {
      document: { file_id: "d", mime_type: "image/png", file_size: MAX_UPLOAD_BYTES + 1 },
    };
    expect(pickImage(message).error).toMatch(/15 MB/);
  });

  it("returns null for non-image messages", () => {
    expect(pickImage({ text: "hello" })).toBeNull();
    expect(pickImage({ document: { file_id: "d", mime_type: "application/pdf" } })).toBeNull();
  });
});

describe("formatVerdict", () => {
  it("renders a registered original with escaped registration details", () => {
    const html = formatVerdict(
      { status: "registered-original", registration: REGISTRATION, distance: 0, confidence: 1 },
      ANCHORED,
    );
    expect(html).toContain("Verdict: registered original");
    expect(html).toContain("Exact SHA-256 match");
    expect(html).toContain("Field &lt;photo&gt;");
    expect(html).toContain("PINL &amp; Co");
    expect(html).toContain("2026-07-15");
    expect(html).toContain("view contract");
  });

  it("renders a likely-altered verdict with distance and confidence", () => {
    const html = formatVerdict(
      { status: "likely-altered", registration: REGISTRATION, distance: 5, confidence: 0.922 },
      null,
    );
    expect(html).toContain("Verdict: likely altered");
    expect(html).toContain("distance 5/64");
    expect(html).toContain("92% similar");
  });

  it("renders an unregistered verdict without registration lines", () => {
    const html = formatVerdict(
      { status: "unregistered", registration: null, distance: null, confidence: 0 },
      null,
    );
    expect(html).toContain("Verdict: unregistered");
    expect(html).toContain("No exact or near match");
    expect(html).not.toContain("Registered by");
  });

  it("reports TEE attestation when the enclave result carries one", () => {
    const html = formatVerdict(
      {
        status: "unregistered",
        registration: null,
        distance: null,
        confidence: 0,
        enclave: { attested: true, hwModel: "INTEL_TDX" },
      },
      null,
    );
    expect(html).toContain("attested TEE on INTEL_TDX");
  });

  it("reports dev mode honestly when no attestation exists", () => {
    const html = formatVerdict(
      {
        status: "unregistered",
        registration: null,
        distance: null,
        confidence: 0,
        enclave: { attested: false },
      },
      null,
    );
    expect(html).toContain("dev mode — no TEE attestation");
  });
});

describe("anchorLine", () => {
  it("returns null when anchoring is not configured", () => {
    expect(anchorLine(null)).toBeNull();
    expect(anchorLine({ configured: false })).toBeNull();
  });

  it("reports RPC errors instead of claiming an unanchored ledger", () => {
    expect(anchorLine({ configured: true, rpcError: "timeout" })).toMatch(/RPC unreachable/);
  });

  it("reports a pending anchor when the head is not on-chain yet", () => {
    expect(anchorLine({ configured: true, headAnchored: false, rpcError: null })).toMatch(
      /not yet anchored/,
    );
  });
});

describe("statusText", () => {
  it("summarises ledger size and last anchor", () => {
    const html = statusText(ANCHORED);
    expect(html).toContain("Records in ledger: 3");
    expect(html).toContain("Last anchor covered 3 records");
  });

  it("degrades gracefully when the registry is unreachable", () => {
    expect(statusText(null)).toMatch(/Registry unreachable/);
  });
});

describe("handleUpdate", () => {
  it("replies with the welcome text to /start", async () => {
    const deps = makeDeps();
    const html = await handleUpdate({ message: { chat: { id: 7 }, text: "/start" } }, deps);
    expect(html).toContain("Proof of Real");
    expect(deps.reply).toHaveBeenCalledWith(7, expect.stringContaining("/status"));
  });

  it("replies with anchor status to /status", async () => {
    const deps = makeDeps();
    const html = await handleUpdate({ message: { chat: { id: 7 }, text: "/status" } }, deps);
    expect(html).toContain("Records in ledger: 3");
  });

  it("verifies a photo end-to-end and replies with the verdict", async () => {
    const deps = makeDeps();
    const update = { message: { chat: { id: 9 }, photo: [{ file_id: "p1" }] } };

    const html = await handleUpdate(update, deps);

    expect(deps.getFileBuffer).toHaveBeenCalledWith("p1");
    expect(deps.verifyImage).toHaveBeenCalledWith(expect.any(Buffer), "image/jpeg", "photo.jpg");
    expect(html).toContain("Verdict: registered original");
  });

  it("replies with a friendly error when verification fails", async () => {
    const deps = makeDeps({
      verifyImage: vi.fn(async () => {
        throw new Error("Registry unreachable: boom");
      }),
    });
    const update = { message: { chat: { id: 9 }, photo: [{ file_id: "p1" }] } };

    const html = await handleUpdate(update, deps);

    expect(html).toContain("Could not verify that image");
    expect(html).toContain("Registry unreachable: boom");
  });

  it("hints at usage for plain text messages", async () => {
    const deps = makeDeps();
    const html = await handleUpdate({ message: { chat: { id: 3 }, text: "hi" } }, deps);
    expect(html).toContain("Send a photo");
  });

  it("ignores updates without a message", async () => {
    const deps = makeDeps();
    expect(await handleUpdate({}, deps)).toBeNull();
    expect(deps.reply).not.toHaveBeenCalled();
  });
});
