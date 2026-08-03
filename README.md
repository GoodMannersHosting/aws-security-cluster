# aws-security-cluster

Security platform automation for **Good Manners Hosting**. The active deployment is a single Hetzner VPS (**keeper.goodmanners.services**) running Docker Compose: Traefik ingress, Authentik (GitHub SSO), OpenBao (AWS KMS auto-unseal), and [Doco-CD](https://github.com/kimdre/doco-cd) GitOps.

| Hostname | Service |
|----------|---------|
| `auth.goodmanners.services` | Authentik |
| `keeper.goodmanners.services` | OpenBao |
| `pdns.goodmanners.services` | PowerDNS API |
| `poweradmin.goodmanners.services` | Poweradmin UI |
| `traefik.goodmanners.services` | Traefik dashboard |
| `doco-cd.goodmanners.services` | Doco-CD (Authentik forward auth on UI only) |

**Start here:** [stacks/README.md](stacks/README.md)

**GitOps:** [`.doco-cd.yml`](.doco-cd.yml) defines deploy order. Stack secrets live in git as **`stacks/*/secrets.enc.env`** (SOPS + age). [stacks/doco-cd/install-prod.sh](stacks/doco-cd/install-prod.sh) bootstraps the VPS; day-two ops in [stacks/ops/](stacks/ops/).

**OpenBao:** policies, roles, and OIDC in [bao/](bao/). File audit is declarative in [stacks/openbao/config/openbao.hcl.example](stacks/openbao/config/openbao.hcl.example); apply with [bao/enable-audit.sh](bao/enable-audit.sh).

## AWS infra (`infra/aws`)

Pulumi stack **`keeper-aws-infra` / `prod`**: Route53 (dnsweaver), GitHub OIDC deploy role, and (when enabled) Authentik as external IdP for org IAM Identity Center (SAML + SCIM). Applied by [`.github/workflows/aws-infra.yml`](.github/workflows/aws-infra.yml).

Design: [docs/superpowers/specs/2026-08-02-authentik-identity-center-design.md](docs/superpowers/specs/2026-08-02-authentik-identity-center-design.md)  
Plan: [docs/superpowers/plans/2026-08-02-authentik-identity-center.md](docs/superpowers/plans/2026-08-02-authentik-identity-center.md)

Changing IC identity source and enabling SCIM are console-only (no Pulumi resource); the checklist below covers the one-time bootstrap.

**Identity Center bootstrap (operators):**

1. Create management IAM role **`keeper-ic-pulumi`** trusted by the workload deploy role ARN; attach SSO Admin + Identity Store permissions for permission sets and assignments.
2. Console: IC → change identity source → External IdP → download SP metadata → note ACS URL + audience.
3. Set Pulumi config (`authentikUrl`, ACS, audience, management role ARN, workload account id; `icScimUrl` after step 6).
4. `pulumi up` — Authentik SAML+SCIM + permission sets; leave **`icAssignmentsEnabled`** false.
5. Download Authentik IdP metadata for app **`aws-iam-identity-center`**; upload to IC; confirm **ACCEPT**.
6. Enable SCIM; put SCIM URL in config; put **`api_token`** + **`scim_token`** in OpenBao **`secret/data/pulumi/authentik`**.
7. Set GitHub repo variable **`AUTHENTIK_IC_ENABLED=true`**; re-run `pulumi up` / **aws-infra** workflow so the SCIM provider gets the token; trigger Authentik SCIM sync.
8. Confirm Identity Store groups **`aws-admins`** / **`aws-viewers`**; set **`icAssignmentsEnabled=true`**; `pulumi up` again.
9. Smoke SSO with a user in each group.
