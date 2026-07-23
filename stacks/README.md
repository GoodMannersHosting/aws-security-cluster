Single-node Compose for Traefik, Authentik, and OpenBao on **keeper.goodmanners.services**.

Stack **compose and secrets** come from git. Doco-CD clones this repo on push to `main` and applies **`.doco-cd.yml`**. Host paths under **`/opt/stacks/`** hold bind-mount data only (ACME, OpenBao config/KMS creds, age key).

## Production layout

| Path | Purpose |
|------|---------|
| `stacks/*/secrets.enc.env` (git) | SOPS-encrypted stack env (Doco-CD decrypts at deploy) |
| `/opt/stacks/doco-cd/sops_age_key.txt` | age **secret** key for SOPS (never commit) |
| `/opt/stacks/traefik/` | ACME (`acme.json`), dynamic middlewares (from git sync) |
| `/opt/stacks/openbao/` | `config/`, `aws/` (KMS seal credentials) |
| `/opt/hcloud-security-cluster/` | Host ops clone (scripts, manual runs) |
| `/opt/stack-secrets/` | age key backup, optional `bao-admin.token` for automation |
| `/opt/backups/keeper/` | Local backup staging; nightly S3 upload via Roles Anywhere |
| `/mnt/sec-hil-1-authentik/` | Authentik Postgres + app data |
| `/mnt/data/openbao/` | OpenBao data volume |

Install or refresh GitOps on the VPS:

```bash
sudo bash /opt/hcloud-security-cluster/stacks/doco-cd/install-prod.sh
```

## Prerequisites

- Docker Engine and Docker Compose v2
- DNS A/AAAA for `auth`, `keeper`, `pdns`, `traefik`, and `doco-cd` hostnames
- External `traefik` Docker network (created by the traefik stack on first boot)
- **`age`** and **`sops`** on the host for encrypting secrets into git

```bash
sudo mkdir -p /mnt/data/postgres/openbao /mnt/data/openbao /mnt/data/postgres/powerdns /var/log/traefik
sudo touch /var/log/traefik/access.log
```

## Deploy order

Doco-CD applies stacks in this order (see `.doco-cd.yml`):

1. **traefik** — ingress, ACME resolver `letsencrypt`
2. **authentik** — Postgres, server, worker (via socket-proxy), embedded outpost routes
3. **openbao** — Postgres, AWS KMS auto-unseal
4. **powerdns** — authoritative DNS server + PostgreSQL backend (DNS TCP/UDP 53 and API routed via Traefik)
5. **alloy** — metrics/logs collector (remote_write + Loki push; no local Grafana)
6. **doco-cd** — self-managed GitOps controller

After Doco-CD is up, use **`stacks/ops/reconcile-gitops.sh`** (or push to `main`). Do not run compose from `/opt/stacks/*/compose.yaml`.

## Secrets (GitOps + SOPS)

1. **In git:** `stacks/{traefik,authentik,openbao,powerdns,doco-cd,alloy}/secrets.enc.env` encrypted with age (see **`.sops.yaml`**).
2. **On keeper only:** `/opt/stacks/doco-cd/sops_age_key.txt` — Doco-CD mounts this via `compose.sops.yaml` and decrypts env files at deploy time.
3. **Rotate or add a secret:** edit `/opt/stacks/<stack>/.env` on keeper, then:

```bash
sudo /opt/hcloud-security-cluster/stacks/ops/encrypt-stack-secrets.sh
cd /opt/hcloud-security-cluster && git add stacks/*/secrets.enc.env
git commit -m "chore(secrets): rotate stack env" && git push
```

Host `/opt/stacks/*/.env` is used only for cold-start (`compose.install.yaml`) and encrypt input; deploys read **`secrets.enc.env`** from the clone.

Never commit plaintext **`stacks/*/.env`**, **`bao/config.env`**, or **`sops_age_key.txt`**.

## Doco-CD (Compose GitOps)

[Doco-CD](https://github.com/kimdre/doco-cd) runs `docker compose` per stack when GitHub sends a webhook.

1. Run **`stacks/doco-cd/install-prod.sh`** (clone, Doco-CD, SOPS key, ops cron).
2. Set **`GIT_ACCESS_TOKEN`** in encrypted doco-cd secrets if the repo is private.
3. GitHub webhook on **`GoodMannersHosting/aws-security-cluster`**:
   - URL: `https://doco-cd.goodmanners.services/v1/webhook`
   - Secret: **`WEBHOOK_SECRET`** (in `stacks/doco-cd/secrets.enc.env`)
   - Content type: `application/json`
   - Events: **push** on branch **main** only
4. **`MAX_CONCURRENT_DEPLOYMENTS=1`** in doco-cd env (serial deploys).

The UI at `https://doco-cd.goodmanners.services` uses Authentik forward auth. **`/v1/webhook`** and **`/v1/health`** bypass forward auth.

**Doco-CD self-deploy:** first adoption uses **`stacks/ops/bootstrap-doco-self-deploy.sh`**. After compose changes to the doco-cd stack, run with **`FORCE_BOOTSTRAP=1`**.

For a greenfield VPS with no existing `/opt/stacks`, use **`stacks/doco-cd/bootstrap.sh`**.

## Authentik blueprints

Git-managed blueprints in **`authentik/blueprints/`** mount into the worker at **`/blueprints/custom`**.

| Blueprint | Purpose |
|-----------|---------|
| `010-platform-groups.yaml` | `platform-admin` group + policy |
| `020-keeper-openbao.yaml` | Keeper OIDC app, groups scope |
| `030-doco-cd-forward-auth.yaml` | Doco-CD forward auth provider + outpost |
| `040-brand-goodmanners.yaml` | Brand for auth hostname |

After blueprints apply:

- Add your user to **`platform-admin`** (Doco-CD UI) and **`keeper-admin`** (OpenBao OIDC admin)
- OpenBao OIDC and policies: repo **`bao/`** (`setup.sh` with `config.env` on the host — not in git)

If blueprint discovery fails:

```bash
sudo bash /opt/hcloud-security-cluster/stacks/ops/fix-blueprints.sh
docker restart authentik-worker
```

**`AUTHENTIK_BLUEPRINTS_PATH`** must point at the git blueprints dir (in encrypted authentik secrets).

## Operations (`stacks/ops/`)

| Script | Purpose |
|--------|---------|
| `verify-gitops.sh` | Clone alignment, encrypted env in clone, compose projects |
| `reconcile-gitops.sh` | Pull host clone, sync traefik binds, webhook or bootstrap |
| `encrypt-stack-secrets.sh` | Host `.env` → `stacks/*/secrets.enc.env` in clone |
| `setup-sops.sh` | age key on host + run encrypt |
| `bootstrap-doco-self-deploy.sh` | One-time / forced Doco-CD GitOps stamp |
| `cold-start-doco-cd.sh` | Start Doco-CD before first GitOps deploy |
| `apply-keeper-post-deploy.sh` | Host hardening + OpenBao file audit + auditd check |
| `harden-host.sh` | Unattended upgrades, permissions, Docker/sysctl/auditd |
| `healthcheck.sh` | Container + HTTPS smoke checks (exit non-zero on failure) |
| `backup.sh` | Postgres dumps + data tarballs; S3 upload when configured |
| `restore.sh` | Restore from local backup dir or S3 stamp |
| `BACKUP-RESTORE.md` | Backup contents, S3 layout, restore procedures |
| `install-cron.sh` | Cron: backup 03:00 UTC, health hourly, gitops verify :15 |
| `fix-blueprints.sh` | Orphan blueprint cleanup |

### Cron (keeper)

Installed by **`install-cron.sh`** → `/etc/cron.d/hcloud-security-cluster`:

| Schedule | Job | Log |
|----------|-----|-----|
| `0 3 * * *` | `backup.sh` | `/var/log/hcloud-backup.log` |
| `0 * * * *` | `healthcheck.sh` | `/var/log/hcloud-health.log` |
| `15 * * * *` | `verify-gitops.sh` | `/var/log/hcloud-gitops.log` |

Run manually after changes:

```bash
sudo /opt/hcloud-security-cluster/stacks/ops/apply-keeper-post-deploy.sh
sudo /opt/hcloud-security-cluster/stacks/ops/healthcheck.sh
sudo /opt/hcloud-security-cluster/stacks/ops/verify-gitops.sh
```

### Hardening and audit

**`apply-keeper-post-deploy.sh`** runs:

- **`harden-host.sh`** — unattended security upgrades, secret file modes, Docker `daemon.json`, sysctl, **Linux auditd** rules on sensitive paths
- **`bao/enable-audit.sh`** — adds **`audit "file"`** stanza to **`/opt/stacks/openbao/config/openbao.hcl`** and restarts OpenBao (no root token; OpenBao >= 2.3.2 blocks API audit enable)

### Off-site backups

Postgres dumps upload via **IAM Roles Anywhere** (see **`backup.env`** on keeper, **`backup.env.example`**). AWS CLI uses `credential_process` with `aws_signing_helper` and **`stacks/ops/aws/keeper.crt`**. CA private key stays in **`/opt/stack-secrets/keeper-ra-ca.key`**.

Full backup/restore guide: **[stacks/ops/BACKUP-RESTORE.md](ops/BACKUP-RESTORE.md)**.

### Grafana Alloy (collector only)

**`stacks/alloy`** runs [Grafana Alloy](https://grafana.com/docs/alloy/) on the `traefik` network. It does **not** run Grafana, Loki, or Prometheus on keeper.

- Host metrics (`prometheus.exporter.unix`)
- Traefik Prometheus metrics (`traefik:8082`, requires Traefik `metrics` entrypoint)
- Docker container logs → **Loki push URL**
- Metrics → **Prometheus remote_write URL**

Configure endpoints in **`stacks/alloy/secrets.enc.env`** (from **`stacks/alloy/.env.example`**). Typical destination: **Grafana Cloud** (separate Prometheus and Loki endpoints + API tokens).

```bash
sudo mkdir -p /opt/stacks/alloy
sudo cp stacks/alloy/.env.example /opt/stacks/alloy/.env
# edit with Grafana Cloud (or self-hosted) URLs and credentials
sudo stacks/ops/encrypt-stack-secrets.sh
```

Alloy UI listens on **127.0.0.1:12345** inside the container only (not exposed via Traefik).

## Security notes

- Authentik **worker** uses **`DOCKER_HOST=tcp://socket-proxy:2375`** (no raw docker.sock).
- OpenBao mounts **`OPENBAO_AWS_CREDS_DIR`** at **`/aws`** for KMS unseal.
- Traefik dashboard and Doco-CD UI: Authentik forward auth (`platform-admin`); webhook path rate-limited only.
- OpenBao ingress: Traefik rate limiting.
- **`stacks/ops/fix-fail2ban-ssh.sh`** — avoid SSH lockout; maintain **`admin-ips.txt`**.

- **Alloy** mounts **docker.sock** read-only for log discovery (same class of access as Doco-CD; no public UI).

OpenBao policy and OIDC files: repo root **`bao/`**.

## Dependency updates (Renovate)

[`renovate.json`](../renovate.json) — SHA-pinned images, grouped stack PRs, automerge on minor/patch. Restrict production webhooks to **`main`** so Renovate branch pushes do not repoint the deploy clone.
