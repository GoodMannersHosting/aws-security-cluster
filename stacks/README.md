Single-node Compose for Traefik, Authentik, and OpenBao on **keeper.goodmanners.services**.

Production secrets and bind-mount paths live under **`/opt/stacks/<stack>/`**. Doco-CD clones this repo to **`/opt/hcloud-security-cluster`** and applies **`.doco-cd.yml`** on push to `main`.

## Production layout

| Path | Purpose |
|------|---------|
| `/opt/stacks/traefik/` | Ingress, ACME (`acme.json`), dynamic middlewares |
| `/opt/stacks/authentik/` | Compose + `.env` |
| `/opt/stacks/openbao/` | Compose, `config/`, `aws/` (KMS seal credentials) |
| `/opt/stacks/doco-cd/` | Doco-CD `.env` only |
| `/opt/hcloud-security-cluster/` | Git clone (Doco-CD working tree) |
| `/opt/stack-secrets/` | age key + SOPS-encrypted `.env` backups |
| `/opt/backups/keeper/` | Nightly backup archives |
| `/mnt/sec-hil-1-authentik/` | Authentik Postgres + app data |
| `/mnt/data/openbao/` | OpenBao data volume |

Install or refresh GitOps on the VPS:

```bash
sudo bash /opt/hcloud-security-cluster/stacks/doco-cd/install-prod.sh
```

## Prerequisites

- Docker Engine and Docker Compose v2
- DNS A/AAAA for `auth`, `keeper`, `traefik`, and `doco-cd` hostnames
- External `traefik` Docker network (created by the traefik stack on first boot)

```bash
sudo mkdir -p /mnt/data/postgres/openbao /mnt/data/openbao /var/log/traefik
sudo touch /var/log/traefik/access.log
```

## Deploy order

Doco-CD applies stacks in this order (see `.doco-cd.yml`):

1. **traefik** — ingress, ACME resolver `letsencrypt`
2. **authentik** — Postgres, server, worker (via socket-proxy), embedded outpost routes
3. **openbao** — Postgres, AWS KMS auto-unseal
4. **doco-cd** — self-managed GitOps controller

Manual one-off (before Doco-CD is running):

```bash
cd /opt/stacks/traefik && docker compose -f docker-compose.yaml up -d
cd /opt/hcloud-security-cluster/stacks/authentik && docker compose up -d
cd /opt/hcloud-security-cluster/stacks/openbao && docker compose up -d
```

Host `.env` files are symlinked into the clone (`stacks/*/.env` → `/opt/stacks/*/.env`) so secrets and absolute mount paths survive git-based deploys.

## Doco-CD (Compose GitOps)

[Doco-CD](https://github.com/kimdre/doco-cd) runs `docker compose` per stack when GitHub sends a webhook.

1. Run **`stacks/doco-cd/install-prod.sh`** (clone, Doco-CD, env stubs, ops cron).
2. Set **`GIT_ACCESS_TOKEN`** in **`/opt/stacks/doco-cd/.env`** if the repo is private.
3. Configure the GitHub webhook on **`GoodMannersHosting/aws-security-cluster`**:
   - URL: `https://doco-cd.goodmanners.services/v1/webhook`
   - Secret: value of **`WEBHOOK_SECRET`** in `/opt/stacks/doco-cd/.env`
   - Content type: `application/json`
   - Events: **push** on branch **main**
4. Set **`MAX_CONCURRENT_DEPLOYMENTS=1`** in Doco-CD env so stacks deploy serially.

The UI at `https://doco-cd.goodmanners.services` is protected by Authentik forward auth. **`/v1/webhook` is excluded** from forward auth (Traefik router `doco-cd-webhook`) so GitHub can deliver payloads without SSO.

For a greenfield VPS with no existing `/opt/stacks`, use **`stacks/doco-cd/bootstrap.sh`** instead.

## Authentik blueprints

Git-managed blueprints in **`authentik/blueprints/`** mount into the worker at **`/blueprints/custom`**.

| Blueprint | Purpose |
|-----------|---------|
| `010-platform-groups.yaml` | `platform-admin` group + policy |
| `020-keeper-openbao.yaml` | Keeper OIDC app, groups scope |
| `030-doco-cd-forward-auth.yaml` | Doco-CD forward auth provider + outpost |
| `040-brand-goodmanners.yaml` | Brand for auth hostname |

After blueprints apply, in the Authentik admin UI:

- Add your user to **`platform-admin`** (Doco-CD UI access)
- Add your user to **`keeper-admin`** (OpenBao OIDC admin role)

Then configure OpenBao OIDC:

```bash
cd /opt/hcloud-security-cluster/bao
cp config.env.example config.env   # fill AUTHENTIK_CLIENT_ID/SECRET from Keeper app
./setup.sh
```

If blueprint discovery logs show duplicate-name errors, run **`stacks/ops/fix-blueprints.sh`**.

## Operations (`stacks/ops/`)

| Script | Purpose |
|--------|---------|
| `fix-blueprints.sh` | Remove orphan blueprint rows, delete macOS `._*` junk |
| `setup-sops.sh` | age key at `/opt/stack-secrets`, encrypt host `.env` files |
| `backup.sh` | Postgres dumps + data tarballs to `/opt/backups/keeper/` |
| `healthcheck.sh` | Container + HTTPS smoke checks (exit non-zero on failure) |
| `install-cron.sh` | Installs `/etc/cron.d/hcloud-security-cluster` (backup 03:00 UTC, health hourly) |

Requires **`age`** and **`sops`** on the host for encrypted env backups. Doco-CD merges **`compose.sops.yaml`** when `stacks/doco-cd/sops_age_key.txt` exists (created by `setup-sops.sh`).

## Security notes

- Authentik **worker** uses **`DOCKER_HOST=tcp://socket-proxy:2375`** instead of mounting `/var/run/docker.sock`.
- OpenBao mounts **`OPENBAO_AWS_CREDS_DIR`** (default `/opt/stacks/openbao/aws`) at **`/aws`** for KMS unseal.
- Never commit **`stacks/*/.env`**, **`bao/config.env`**, or **`stacks/doco-cd/sops_age_key.txt`**.

## Legacy AWS automation

Pulumi under **`infrastructure/`** is reference only for the Hetzner deployment. See [`.github/readme.md`](../.github/readme.md) for the AWS stack overview.

OpenBao policy and OIDC files: repo root **`bao/`**.
