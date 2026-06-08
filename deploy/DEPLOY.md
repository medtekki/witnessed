# Deploying the witness to a VPS (Hetzner)

A turnkey Docker Compose deploy: the witness container + Caddy for automatic HTTPS.
Replace `receipts.example.com` with your domain and `YOUR_VPS_IP` with the server's IP.

## 1. DNS (do this first — Caddy needs it to issue a cert)

Add an A record pointing your (sub)domain at the VPS:

```
receipts.example.com.  A  YOUR_VPS_IP
```

(Optionally an AAAA record for IPv6.) Wait for it to resolve: `dig +short receipts.example.com`.

## 2. Generate the witness key (on your trusted machine, not the VPS)

```bash
npm run gen:witness-key
```

Copy the printed `WITNESS_PRIVATE_JWK=...` line — it goes into `deploy/witness.env` below.
Also note the printed `key_id` / `public_key`: publish these so others can verify your receipts.

## 3. Get the code onto the VPS

If the repo is on GitHub/GitLab: `git clone <url> /opt/receipts`.
Otherwise rsync your working copy (excludes node_modules and local data):

```bash
rsync -av --exclude node_modules --exclude .git --exclude 'data' --exclude '*.db*' \
  ./ root@YOUR_VPS_IP:/opt/receipts/
```

## 4. Install Docker on the VPS (Ubuntu/Debian)

```bash
ssh root@YOUR_VPS_IP
curl -fsSL https://get.docker.com | sh        # installs Docker + compose plugin
```

## 5. Configure secrets on the VPS

```bash
cd /opt/receipts/deploy
cp .env.example .env                 # set WITNESS_DOMAIN=receipts.example.com
cp witness.env.example witness.env   # paste the WITNESS_PRIVATE_JWK from step 2
chmod 600 witness.env                # lock down the key file
```

## 6. Firewall (allow SSH + web only)

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 7. Launch

```bash
docker compose up -d --build
```

Caddy issues the TLS cert automatically on first boot. Verify:

```bash
curl https://receipts.example.com/healthz      # {"status":"ok"}
curl https://receipts.example.com/public-key    # {"key_id":"...","public_key":{...}}
```

## Updating

Re-sync (or `git pull`) the code, then rebuild:

```bash
cd /opt/receipts/deploy && docker compose up -d --build
```

## Operating notes

- **Backups:** the receipts live in the `receipts-data` Docker volume (`/data/receipts.db`).
  Back it up: `docker run --rm -v deploy_receipts-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/receipts-$(date +%F).tgz /data`.
- **Logs:** `docker compose logs -f witness`.
- **Key hardening:** the env-held key is fine for a labelled beta. Before charging money or
  handling regulated data, move signing to a KMS/HSM (`@witnessed/gcp-kms` + `KmsSigner`).
- **Billing:** to charge per receipt, add the `X402_*` vars to `witness.env` (see `.env.example`
  at the repo root) — only then does `POST /receipts` require payment.
