# core-aws

Shared AWS infrastructure: VPC (172.16.0.0/20), ECS cluster, Traefik (ACME + Route53 DNS-01), NLB, and EFS for Traefik certificate persistence. Application stacks (openbao-aws, authentik-aws, etc.) reference this stack and deploy services into the same cluster; Traefik discovers them via ECS and routes by hostname.

## Prerequisites

- Pulumi CLI, Node.js 20+, AWS CLI
- Route53 hosted zone for your domain
- Backend: `s3://pulumi-state-2e089842` (self-managed; StackReference org: **organization**)

## Config

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `hostedZoneId` | Yes | - | Route53 hosted zone ID for ACME DNS-01 |
| `acmeEmail` | Yes | - | Email for Let's Encrypt ACME |
| `domain` | No | - | Base domain. When set, read-only Traefik dashboard at `traefik.${domain}` |
| `vpcCidr` | No | 172.16.0.0/20 | VPC CIDR |
| `enableSpot` | No | true | Use Fargate Spot for Traefik |
| `traefikDesiredCount` | No | 2 | Number of Traefik tasks |
| `traefikCpu` / `traefikMemory` | No | 256 / 512 | Traefik task size |

## Deploy

```bash
pulumi stack init prod
pulumi config set hostedZoneId Z0123456789ABC
pulumi config set acmeEmail admin@example.com
npm install
pulumi up
```

## Outputs

- `clusterArn`, `clusterName` – ECS cluster
- `vpcId`, `privateSubnetIds`, `publicSubnetIds` – Networking (for StackReference)
- `traefikSecurityGroupId` – SG to allow from Traefik to app tasks
- `nlbDnsName`, `nlbZoneId` – NLB; point app domains (CNAME) here

Application stacks use `StackReference("organization/core-aws/<stack>")` with the same stack name (e.g. `prod` or `dev`).
