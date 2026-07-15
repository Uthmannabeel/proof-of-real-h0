# Confidential verifier enclave

The verifier runs in **Google Cloud Confidential Space** — a hardened TEE
(Intel TDX / AMD SEV) whose launcher measures the container image and issues
Google-signed attestation tokens.

## Privacy architecture

```
browser ──(image, TLS)──▶ enclave (Confidential Space VM)
                            │  fingerprints in enclave memory only
                            │  image never stored, never forwarded
                            ▼
                          registry ◀──(hashes only)── /api/lookup
                            │
                            ▼
browser ◀─ verdict + attestation JWT (nonce = file SHA-256)
```

- The registry server **never receives the image** — only its hashes.
- The attestation token proves *which container image* processed the file, on
  *which confidential hardware*, and is **nonce-bound to the file's SHA-256**.
- Verifiers can check the token against Google's OIDC keys
  (`https://confidentialcomputing.googleapis.com/.well-known/openid-configuration`)
  and compare `submods.container.image_digest` with the published image digest.

## Local development

```bash
node enclave/server.mjs                      # REGISTRY_URL defaults to http://localhost:3000
# app: set NEXT_PUBLIC_ENCLAVE_URL=http://localhost:8080 in .env.local
```

Outside Confidential Space the service runs in clearly-labelled dev mode:
verdicts work, `enclave.attested` stays `false`.

## Production deployment (Confidential Space)

One-time setup (needs a GCP project with billing):

```bash
gcloud services enable compute.googleapis.com confidentialcomputing.googleapis.com artifactregistry.googleapis.com
gcloud artifacts repositories create proof-of-real --repository-format=docker --location=us-central1
```

Build and push the image (from repo root):

```bash
cd enclave
gcloud builds submit --tag us-central1-docker.pkg.dev/PROJECT_ID/proof-of-real/enclave:v1
```

Create the Confidential Space VM (Intel TDX example):

```bash
gcloud compute instances create por-enclave \
  --zone us-central1-a \
  --machine-type c3-standard-4 \
  --confidential-compute-type TDX \
  --shielded-secure-boot \
  --maintenance-policy TERMINATE \
  --image-project confidential-space-images \
  --image-family confidential-space \
  --service-account ENCLAVE_SA@PROJECT_ID.iam.gserviceaccount.com \
  --metadata "^~^tee-image-reference=us-central1-docker.pkg.dev/PROJECT_ID/proof-of-real/enclave:v1~tee-env-REGISTRY_URL=https://YOUR-APP-URL~tee-container-log-redirect=true"
```

Then set `NEXT_PUBLIC_ENCLAVE_URL=https://ENCLAVE_HOST` on the app deployment.
(For a demo, the VM's external IP + a Caddy/nginx TLS front or a load balancer
works; keep port 8080 open to the app's origin only.)

Cost: Confidential Space itself is free; you pay for the underlying VM
(c3-standard-4 on-demand ≈ $0.20/hr — run it for demos, stop it after).

## Attestation token claims worth showing judges

| Claim | Meaning |
|---|---|
| `hwmodel` | e.g. `INTEL_TDX` — the confidential hardware |
| `swname` | `CONFIDENTIAL_SPACE` |
| `submods.container.image_digest` | digest of THIS verifier image |
| `eat_nonce` | SHA-256 of the exact file that was verified |
| `iss` | `https://confidentialcomputing.googleapis.com` |
