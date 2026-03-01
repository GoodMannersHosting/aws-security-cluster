# Emergency Bastion

Bastion host in the core VPC (public subnet) with SSH access and PostgreSQL (5432) ingress to the OpenBao RDS instance. Uses your local `~/.ssh/id_ed25519.pub`.

**Use the same stack name** as `core-aws` and `openbao-aws` (e.g. `prod`).

## Prerequisites

- `~/.ssh/id_ed25519.pub` exists (or create with `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""`).
- `core-aws` and `openbao-aws` stacks already deployed for that stack name.
- **Run `pulumi up` in `openbao-aws` at least once** so it exports `databaseSecurityGroupId` (needed for the RDS ingress rule).

## Deploy

```bash
cd emergency-bastion
npm install
pulumi stack init prod   # if not already created; use same name as core/openbao
pulumi up
```

## Connect and run commands on RDS

1. Get the SSH command: `pulumi stack output sshCommand`
2. SSH in: `ssh -i ~/.ssh/id_ed25519 ec2-user@<bastionPublicIp>`
3. On the bastion, install `psql` if needed (e.g. `sudo dnf install -y postgresql15` on AL2023).
4. Get the DB connection URL from Secrets Manager (from your laptop):
   ```bash
   aws secretsmanager get-secret-value --secret-id openbao-db-connection-prod --query SecretString --output text
   ```
5. From the bastion, connect to RDS using that URL, or use the Aurora endpoint and password from the URL to run:
   ```bash
   psql "$CONNECTION_URL" -c "DROP TABLE IF EXISTS openbao_ha_locks; DROP TABLE IF EXISTS openbao_kv_store;"
   ```

Then force a new OpenBao ECS deployment so it re-initializes; the init Lambda will store the new root token within ~5 minutes.

## Destroy

```bash
pulumi destroy
```

Removes the bastion, key pair, and the RDS ingress rule from the bastion security group.
