Single-node Compose definitions for Traefik, Authentik, and OpenBao on **keeper.goodmanners.services**. Production compose and secrets live under **`/opt/stacks/<stack>/`**. Doco-CD clones this repo to **`/opt/hcloud-security-cluster`** and applies **`.doco-cd.yml`**.

## Production layout (keeper)

| Path | Purpose |
|------|---------|
| `/opt/stacks/traefik/` | Ingress, ACME, dynamic middlewares |
| `/opt/stacks/authentik/` | Authentik compose + `.env` |
| `/opt/stacks/openbao/` | OpenBao compose, `config/`, `aws/` (KMS seal) |
| `/opt/stacks/doco-cd/` | Doco-CD `.env` only |
| `/opt/hcloud-security-cluster/` | Git clone (Doco-CD working tree) |
| `/mnt/sec-hil-1-authentik/` | Authentik Postgres + app data |
| `/mnt/data/openbao/` | OpenBao data volume |

Install GitOps on the VPS:

```bash
sudo bash /opt/hcloud-security-cluster/stacks/doco-cd/install-prod.sh
```

## Prerequisites

- Docker Engine and Docker Compose v2
- DNS A/AAAA for `auth`, `keeper`, `traefik`, and `doco-cd` hostnames
- Traefik network exists (created by the traefik stack on first boot)

```bash
sudo mkdir -p /mnt/data/postgres/openbao /mnt/data/openbao /var/log/traefik
sudo touch /var/log/traefik/access.log
```

## Deploy order

1. **traefik** – ingress, ACME resolver `letsencrypt`
2. **authentik** – bundled Postgres, server/worker, socket proxy
3. **openbao** – bundled Postgres, AWS KMS auto-unseal (config on host only)
4. **doco-cd** – GitOps (install-prod.sh)

Manual one-off (before Doco-CD):

```bash
cd /opt/stacks/traefik && docker compose -f docker-compose.yaml up -d
cd /opt/stacks/authentik && docker compose up -d
cd /opt/stacks/openbao && docker compose up -d
```

## Doco-CD (Compose GitOps)

[Doco-CD](https://github.com/kimdre/doco-cd) pulls this repo on webhook and runs `docker compose` per stack in **`.doco-cd.yml`**.

1. Run **`stacks/doco-cd/install-prod.sh`** on the VPS (clone + Doco-CD + host `.env` stubs).
2. Set **`GIT_ACCESS_TOKEN`** in **`/opt/stacks/doco-cd/.env`** if the repo is private.
3. GitHub webhook: **`https://doco-cd.goodmanners.services/v1/webhook`**, secret = **`WEBHOOK_SECRET`**, event **push** on **main**.
4. **`MAX_CONCURRENT_DEPLOYMENTS=1`** keeps stack order deterministic.

Host `.env` files hold secrets and **absolute bind-mount paths** so deploys from the git clone do not move ACME certs or OpenBao config.

For greenfield VPS (no existing `/opt/stacks`), use **`stacks/doco-cd/bootstrap.sh`** instead (creates `/opt/stack-env` layout).

## Authentik blueprints

Git-managed blueprints: **`authentik/blueprints/`** → worker **`/blueprints/custom`**.

| Blueprint | Purpose |
|-----------|---------|
| `010-platform-groups.yaml` | `platform-admin` group + policy |
| `020-keeper-openbao.yaml` | Keeper OIDC app, groups scope |
| `030-doco-cd-forward-auth.yaml` | Doco-CD forward auth |
| `040-brand-goodmanners.yaml` | Brand for auth hostname |

Assign **`platform-admin`** (Doco-CD UI) and **`keeper-admin`** (OpenBao OIDC). Then **`bao/setup.sh`** with Keeper OAuth credentials from Authentik.

## Legacy AWS automation

Pulumi under **`infrastructure/`** is reference only for the Hetzner deployment.

OpenBao policy/OIDC files: repo root **`bao/`**.
