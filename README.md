# aws-security-cluster

Security platform automation for **Good Manners Hosting**. The active deployment is a single Hetzner VPS (**keeper.goodmanners.services**) running Docker Compose: Traefik ingress, Authentik (GitHub SSO), OpenBao (AWS KMS auto-unseal), and [Doco-CD](https://github.com/kimdre/doco-cd) GitOps.

| Hostname | Service |
|----------|---------|
| `auth.goodmanners.services` | Authentik |
| `keeper.goodmanners.services` | OpenBao |
| `traefik.goodmanners.services` | Traefik dashboard |
| `doco-cd.goodmanners.services` | Doco-CD (Authentik forward auth on UI only) |

**Start here:** [stacks/README.md](stacks/README.md)

**GitOps:** [`.doco-cd.yml`](.doco-cd.yml) defines deploy order; [stacks/doco-cd/install-prod.sh](stacks/doco-cd/install-prod.sh) bootstraps the VPS.

**OpenBao:** policies, roles, and OIDC bootstrap in [bao/](bao/).

The `infrastructure/` directory holds legacy **AWS Pulumi** stacks (ECS, Aurora, NLB) for reference; they are not used on keeper.
