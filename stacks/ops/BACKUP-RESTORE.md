# Keeper backup and restore

Nightly backups run from **`stacks/ops/backup.sh`** (cron `0 3 * * * UTC`). Optional off-site copy uses **IAM Roles Anywhere** and S3.

## What gets backed up

Each run creates a timestamped directory under **`/opt/backups/keeper/`**:

| Artifact | Source | Purpose |
|----------|--------|---------|
| `authentik.dump` | `authentik-postgresql` (`pg_dump -Fc`) | Authentik DB (users, apps, flows, outposts) |
| `openbao.dump` | `openbao-postgresql` (`pg_dump -Fc`) | OpenBao metadata (mounts, policies, audit config in DB) |
| `powerdns.dump` | `powerdns-postgresql` (`pg_dump -Fc`) | PowerDNS zones, records, metadata |
| `authentik-data.tgz` | `/mnt/sec-hil-1-authentik/{data,media,certs}` | Authentik media and file-backed state |
| `openbao-data.tgz` | `/mnt/data/openbao` | OpenBao file audit log and local file data |
| `traefik-acme.tgz` | `/opt/stacks/traefik/acme` | TLS certificates (Let's Encrypt) |
| `stack-secrets.tgz` | `/opt/stack-secrets` | age key backup, encrypted env copies, RA CA key |

**Not in backup:** Git-managed compose and SOPS secrets (`stacks/*/secrets.enc.env` in the repo). Host-only paths: `/opt/stacks/openbao/config/openbao.hcl`, `/opt/stacks/openbao/aws/`, `/opt/stacks/doco-cd/sops_age_key.txt` (partially mirrored in `stack-secrets.tgz` if copied there).

## Local retention

`RETAIN_DAYS` in **`backup.env`** (default **14**) deletes old directories under `/opt/backups/keeper/`.

## S3 layout

When `BACKUP_S3_BUCKET` is set in **`backup.env`**:

```
s3://BUCKET/keeper/YYYYMMDDTHHMMSSZ/authentik.dump
s3://BUCKET/keeper/YYYYMMDDTHHMMSSZ/openbao.dump
s3://BUCKET/keeper/YYYYMMDDTHHMMSSZ/powerdns.dump
s3://BUCKET/keeper/YYYYMMDDTHHMMSSZ/keeper-YYYYMMDDTHHMMSSZ.tar.gz   # optional full bundle
```

Credentials: **`stacks/ops/aws/credentials`** with `credential_process` and **`aws_signing_helper`** (see **`credentials.example`**). CA private key: **`/opt/stack-secrets/keeper-ra-ca.key`**.

Configure from **`backup.env.example`**.

## Manual backup

```bash
sudo /opt/hcloud-security-cluster/stacks/ops/backup.sh
tail -50 /var/log/hcloud-backup.log
```

## Restore (overview)

Restore is destructive for databases and extracted archives. Plan downtime and test on a staging host first.

1. Pick a backup stamp (directory name or S3 prefix).
2. Stop application containers (OpenBao, Authentik, PowerDNS, Traefik, Doco-CD, Alloy) — Postgres keeps running for `pg_restore`.
3. Restore Postgres dumps with **`pg_restore --clean --if-exists`**.
4. Extract tarballs over data paths.
5. Reconcile GitOps and verify health.

### Restore from local directory

```bash
sudo /opt/hcloud-security-cluster/stacks/ops/restore.sh --dry-run \
  /opt/backups/keeper/20260606T030001Z

sudo /opt/hcloud-security-cluster/stacks/ops/restore.sh \
  /opt/backups/keeper/20260606T030001Z

sudo bash /opt/hcloud-security-cluster/stacks/ops/reconcile-gitops.sh
sudo bash /opt/hcloud-security-cluster/stacks/ops/healthcheck.sh
```

### Restore from S3

```bash
sudo /opt/hcloud-security-cluster/stacks/ops/restore.sh --dry-run \
  --from-s3 20260606T030001Z

sudo /opt/hcloud-security-cluster/stacks/ops/restore.sh \
  --from-s3 20260606T030001Z
```

### After restore

- **OpenBao:** AWS KMS auto-unseal should unseal on start; confirm `https://keeper.goodmanners.services/v1/sys/health`.
- **Authentik:** Confirm login at `https://auth.goodmanners.services`; blueprints reload from git mount on worker restart.
- **Traefik:** ACME restore avoids re-issuing certs; confirm HTTPS on all hostnames.
- **SOPS / age:** If `stack-secrets.tgz` included `sops_age_key.txt`, confirm `/opt/stacks/doco-cd/sops_age_key.txt` matches before Doco-CD deploys.
- **GitOps secrets:** Repo `secrets.enc.env` files are authoritative for stack env; host `/opt/stacks/*/.env` only needed for cold-start and encrypt workflow.

### Partial restore

| Need | Restore |
|------|---------|
| Authentik only | `authentik.dump` + optional `authentik-data.tgz` |
| OpenBao only | `openbao.dump` + optional `openbao-data.tgz` |
| PowerDNS only | `powerdns.dump` |
| TLS only | `traefik-acme.tgz` → `/opt/stacks/traefik/` |
| Secrets keys only | `stack-secrets.tgz` → `/` |

Use `pg_restore` manually if you only need one database:

```bash
docker exec -i authentik-postgresql sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < /opt/backups/keeper/STAMP/authentik.dump
```

## Verify backups

```bash
# List local
ls -la /opt/backups/keeper/

# List S3 (with Roles Anywhere creds configured)
aws s3 ls s3://gmh-keeper-backups-prod/keeper/ --profile default

# Inspect dump header
pg_restore -l /opt/backups/keeper/STAMP/authentik.dump | head
```

## Related ops

| Script | Role |
|--------|------|
| `backup.sh` | Create backup + S3 upload |
| `restore.sh` | Restore from local dir or S3 stamp |
| `install-cron.sh` | Schedule backup 03:00 UTC |
| `healthcheck.sh` | Post-restore smoke tests |
