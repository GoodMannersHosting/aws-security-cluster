# AWS Security Cluster

Pulumi (TypeScript) stacks that provision shared AWS infrastructure and security-focused applications: **core-aws** (VPC, ECS cluster, Traefik, NLB), **openbao-aws** (OpenBao secrets manager), **authentik-aws** (identity provider), and **emergency-bastion** (emergency RDS access).

## Architecture

- **core-aws** – Shared VPC, ECS cluster, Traefik (ACME + Route53), NLB, EFS. Application stacks reference it via `StackReference` and deploy into the same cluster; Traefik discovers services via ECS and routes by hostname.
- **openbao-aws** – OpenBao on ECS Fargate with Aurora Serverless v2 (PostgreSQL) and AWS KMS auto-unseal. Runs behind Traefik; TLS via ACME/Route53.
- **authentik-aws** – Authentik server and workers on ECS, Aurora PostgreSQL. Routes via Traefik.
- **emergency-bastion** – Bastion EC2 host for emergency access to the OpenBao RDS instance (SSH + psql). Optional.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- Node.js 20+
- AWS CLI configured
- Route53 hosted zone for your domain
- Backend: `s3://pulumi-state-2e089842` (StackReference org: **organization**)

## Deploy order

1. **core-aws** – VPC, ECS, Traefik, NLB
2. **openbao-aws** – OpenBao
3. **authentik-aws** – Authentik
4. **emergency-bastion** (optional)

See [docs/INITIALIZATION.md](../docs/INITIALIZATION.md) for step-by-step config and deployment.

## Stack READMEs


| Stack                                                         | Description                                   |
| ------------------------------------------------------------- | --------------------------------------------- |
| [core-aws/README.md](../core-aws/README.md)                   | VPC, ECS cluster, Traefik (ACME/Route53), NLB |
| [openbao-aws/README.md](../openbao-aws/README.md)             | OpenBao on ECS with Aurora, KMS auto-unseal   |
| [emergency-bastion/README.md](../emergency-bastion/README.md) | Emergency bastion for RDS access              |


## Commands

```bash
cd <stack>                # core-aws, openbao-aws, authentik-aws, emergency-bastion
pulumi install
pulumi stack init prod    # or dev
                          # Set required config, see stack README
pulumi preview            # Confirm expected output
pulumi up
```

