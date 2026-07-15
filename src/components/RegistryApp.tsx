"use client";

import { useState } from "react";
import type { EnclaveInfo, Registration } from "@/lib/types";
import type { Verification, RegisterResult } from "@/lib/registry";
import type { ApiResponse } from "@/lib/api";
import { UploadCard } from "./UploadCard";
import { Certificate } from "./Certificate";
import { VerifyResult } from "./VerifyResult";
import { Ledger } from "./Ledger";
import { AnchorPanel } from "./AnchorPanel";

type Tab = "register" | "verify";

/** When set, images go DIRECTLY to the confidential verifier — never to our server. */
const ENCLAVE_URL = (process.env.NEXT_PUBLIC_ENCLAVE_URL ?? "").replace(/\/$/, "");

/** Bundled demo images so a first-time visitor can reach a verdict in seconds. */
const SAMPLES = [
  { file: "original.png", label: "Registered original" },
  { file: "altered.png", label: "Altered copy" },
  { file: "unrelated.png", label: "Unrelated image" },
] as const;

export function RegistryApp({ initialLedger }: { initialLedger: Registration[] }) {
  const [tab, setTab] = useState<Tab>("register");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [registrant, setRegistrant] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registerResult, setRegisterResult] = useState<RegisterResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<Verification | null>(null);
  const [enclaveInfo, setEnclaveInfo] = useState<EnclaveInfo | null>(null);
  const [ledger, setLedger] = useState<Registration[]>(initialLedger);

  const selectFile = (next: File | null) => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next ? URL.createObjectURL(next) : null;
    });
    setFile(next);
    setError(null);
    setRegisterResult(null);
    setVerifyResult(null);
    setEnclaveInfo(null);
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setError(null);
    setRegisterResult(null);
    setVerifyResult(null);
    setEnclaveInfo(null);
  };

  async function refreshLedger() {
    const res = await fetch("/api/registrations");
    const body = (await res.json()) as ApiResponse<Registration[]>;
    if (body.success && body.data) setLedger(body.data);
  }

  async function loadSample(name: string) {
    try {
      const res = await fetch(`/samples/${name}`);
      if (!res.ok) throw new Error("Sample image unavailable.");
      const blob = await res.blob();
      selectFile(new File([blob], name, { type: "image/png" }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load the sample image.");
    }
  }

  async function submit() {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const form = new FormData();
      form.set("file", file);

      if (tab === "register") {
        form.set("title", title || file.name);
        form.set("registrant", registrant || "Anonymous");
        const body = (await postForm<RegisterResult>("/api/register", form));
        if (!body.success || !body.data) throw new Error(body.error ?? "Registration failed.");
        setRegisterResult(body.data);
        await refreshLedger();
      } else if (ENCLAVE_URL) {
        // Confidential path: the image goes straight to the enclave, not our server.
        const res = await fetch(`${ENCLAVE_URL}/verify`, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        const body = (await res.json()) as ApiResponse<Verification & { enclave: EnclaveInfo }>;
        if (!body.success || !body.data) throw new Error(body.error ?? "Verification failed.");
        setVerifyResult(body.data);
        setEnclaveInfo(body.data.enclave ?? null);
      } else {
        const body = await postForm<Verification>("/api/verify", form);
        if (!body.success || !body.data) throw new Error(body.error ?? "Verification failed.");
        setVerifyResult(body.data);
        setEnclaveInfo(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8 items-start">
      <section>
        <div className="flex gap-2 mb-5">
          <TabButton active={tab === "register"} onClick={() => switchTab("register")}>
            Register original
          </TabButton>
          <TabButton active={tab === "verify"} onClick={() => switchTab("verify")}>
            Verify an image
          </TabButton>
        </div>

        <UploadCard
          file={file}
          previewUrl={previewUrl}
          onFile={selectFile}
          hint={
            tab === "register"
              ? "Upload an original you created to seal it into the registry."
              : "Upload any image to check it against the registry."
          }
        />

        {tab === "verify" && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
            <span className="eyebrow">No image handy? Try:</span>
            {SAMPLES.map((sample) => (
              <button
                key={sample.file}
                type="button"
                className="btn btn-ghost"
                onClick={() => loadSample(sample.file)}
              >
                {sample.label}
              </button>
            ))}
          </div>
        )}

        {tab === "register" && (
          <div className="mt-4 space-y-3">
            <LabeledInput label="Title" value={title} onChange={setTitle} placeholder="e.g. Sunrise over Harbor" />
            <LabeledInput
              label="Registrant"
              value={registrant}
              onChange={setRegistrant}
              placeholder="Your name or handle"
            />
          </div>
        )}

        <button className="btn w-full mt-5" disabled={!file || loading} onClick={submit}>
          {loading
            ? "Working…"
            : tab === "register"
              ? "Seal into registry"
              : "Verify authenticity"}
        </button>

        {error && (
          <p className="mono text-[0.8rem] text-[var(--color-stamp-red)] mt-3">{error}</p>
        )}
      </section>

      <section className="space-y-5">
        {registerResult && (
          <div>
            {registerResult.alreadyRegistered && (
              <p className="eyebrow mb-2 text-[var(--color-stamp-amber)]">
                Already on file — existing certificate shown
              </p>
            )}
            <Certificate registration={registerResult.registration} />
          </div>
        )}

        {verifyResult && <VerifyResult result={verifyResult} enclave={enclaveInfo} />}

        {!registerResult && !verifyResult && (
          <div className="space-y-5">
            <div>
              <h2 className="font-serif text-xl mb-3">Public ledger</h2>
              <Ledger records={ledger} />
            </div>
            <AnchorPanel />
          </div>
        )}
      </section>
    </div>
  );
}

async function postForm<T>(url: string, form: FormData): Promise<ApiResponse<T>> {
  const res = await fetch(url, { method: "POST", body: form });
  return (await res.json()) as ApiResponse<T>;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`btn ${active ? "" : "btn-ghost"}`} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mono w-full mt-1 px-3 py-2 bg-[var(--color-paper)] border border-[var(--color-rule)] text-sm outline-none focus:border-[var(--color-ink)]"
      />
    </label>
  );
}
