# Proof of Real — confidential verifier enclave image.
# Built for Google Cloud Confidential Space: the launcher measures this image's
# digest into the attestation token, so keep it minimal and reproducible.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY hash.mjs attestation.mjs server.mjs ./

# Confidential Space runs the container as-is; no shell entrypoint tricks.
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]

# Confidential Space requires these labels for logging visibility choices.
LABEL "tee.launch_policy.allow_env_override"="REGISTRY_URL,ALLOWED_ORIGIN,ATTESTATION_AUDIENCE"
LABEL "tee.launch_policy.log_redirect"="always"
