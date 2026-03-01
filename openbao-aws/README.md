# OpenBao on AWS (Pulumi)

Pulumi stack that deploys OpenBao on the **core-aws** ECS cluster, behind Traefik:

- **StackReference** to `organization/core-aws/<stack>` for VPC, cluster, and Traefik
- **ECS Fargate** for the OpenBao server (in core cluster)
- **Aurora Serverless v2 (PostgreSQL)** for HA storage
- **AWS KMS** for auto-unseal
- **Traefik** (in core) routes by hostname and handles TLS via ACME/Route53

No ALB in this stack; TLS and routing are handled by Traefik in core-aws. Deploy **core-aws** first, then set `openbaoDomain` and point that domain to the core NLB.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- Node.js 18+
- AWS CLI configured (or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`)

## Config

Requires **core-aws** deployed with the same stack name (e.g. `prod` or `dev`).

```bash
cd openbao-aws
pulumi stack init prod
pulumi config set openbaoDomain openbao.example.com
npm install
```

| Config key | Required | Default | Description |
|------------|----------|---------|-------------|
| `openbaoDomain` | Yes | - | Domain for OpenBao (e.g. openbao.example.com). Point DNS to core-aws NLB. |
| `auroraSnapshotIdentifier` | No | - | If set, restore Aurora from this snapshot (disaster recovery). |
| `domainName` | No | openbao.internal | Legacy/optional. |
| `allowedCidrs` | No | VPC CIDR only | Legacy; NLB is in core. |
| `openbaoImage` | No | openbao/openbao | OpenBao container image. |
| `openbaoVersion` | No | 1.7.1 | OpenBao image tag. |
| `openbaoCpu` | No | 512 | ECS task CPU (Fargate units). |
| `openbaoMemory` | No | 1024 | ECS task memory (MiB). |
| `desiredCount` | No | 2 | Number of OpenBao tasks (for HA). |
| `auroraMinAcu` | No | 0.5 | Aurora Serverless v2 minimum ACU. |
| `auroraMaxAcu` | No | 2 | Aurora Serverless v2 maximum ACU. |
| `dbVersion` | No | 16.4 | Aurora PostgreSQL engine version. |
| `enableSpot` | No | true | Use Fargate Spot for cost savings. |
| `spotOnDemandBase` | No | 1 | Minimum number of on-demand Fargate tasks when Spot is enabled. |

Example (production-style):

```bash
pulumi config set certificateArn arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT_ID
pulumi config set domainName openbao.example.com
pulumi config set allowedCidrs "10.0.0.0/16,203.0.113.0/24"
pulumi config set desiredCount 2
pulumi config set auroraMinAcu 0.5
pulumi config set auroraMaxAcu 4
```

## Deploy

```bash
pulumi preview
pulumi up
```

After a successful run, note the stack outputs:

- `openbaoUrl` – `https://<openbaoDomain>` (point that domain to core NLB)
- `nlbDnsNameForDns` – core NLB DNS (for reference)
- `auroraEndpoint` – RDS cluster endpoint (for reference or DB tools)
- `kmsKeyId` – KMS key used for auto-unseal
- `dbSecretArn` – Secrets Manager ARN for the RDS connection URL
- `rootTokenSecretArn` – Secrets Manager ARN where the init Lambda stores the root token (after first init)

## Post-deploy: first-time init

A **scheduled Lambda** runs every 5 minutes. Once the OpenBao ECS service has a healthy task, the Lambda calls the init API (if the server is still uninitialized), then stores the **root token** in Secrets Manager at `rootTokenSecretArn`. No manual init is required.

To retrieve the root token after init (from repo root or with `STACK=prod`):

```bash
cd openbao-aws && ./scripts/get-root-token.sh
```

Or with the secret name directly (replace `prod` with your stack name):

```bash
aws secretsmanager get-secret-value --secret-id openbao-root-token-prod --query SecretString --output text
```

The OpenBao UI is at `https://<openbaoDomain>/` (log in with the root token).

The Lambda runs in the VPC and reaches OpenBao via the core NLB (Traefik routes by Host to OpenBao). Point `openbaoDomain` DNS to the core NLB. After init, the Lambda continues to run every 5 minutes but exits immediately when the server is already initialized.

The Aurora cluster is created with a database named `openbao` and master user `openbao`. If you need a dedicated DB user for OpenBao (instead of the cluster master), create it in PostgreSQL and store the new connection URL in a secret, then update the ECS task definition to reference that secret for `BAO_PG_CONNECTION_URL`.

## Security

- RDS is in private subnets; security group allows 5432 only from the OpenBao ECS security group.
- Ingress is via core NLB and Traefik; TLS is handled by Traefik (ACME).
- RDS password and connection URL are in Secrets Manager; ECS tasks get them via IAM (execution role).
- KMS access for the seal uses the ECS task role (least-privilege: Decrypt + DescribeKey).
- VPC flow logs are enabled to a CloudWatch log group.
- No credentials in code; TLS is via Traefik (ACME/Route53) in core-aws.

## Destroy

```bash
pulumi destroy
```

RDS has `skipFinalSnapshot: true`; adjust in code if you need a final snapshot. The KMS key has a 30-day deletion window.
