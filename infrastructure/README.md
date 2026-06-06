# Legacy AWS infrastructure (Pulumi)

These TypeScript Pulumi projects provisioned Traefik, Authentik, and OpenBao on **AWS** (VPC, ECS Fargate, Aurora, NLB, Route53 ACME).

The active deployment path for this repository is **Hetzner + Docker** under [`../stacks`](../stacks). Keep these stacks only if you still operate or migrate from AWS.

See each subfolder README and [docs/INITIALIZATION.md](docs/INITIALIZATION.md) for AWS-specific steps.
