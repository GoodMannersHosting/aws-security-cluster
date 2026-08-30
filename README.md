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

Org `o-2j4dlyoocl`: management account **`977656673179`** (Daniel Manners), workload **`417568418531`** (GoodMannersHosting). IC instance `arn:aws:sso:::instance/ssoins-722325f246f3860b`, identity store `d-9067963c52`, `us-east-1`.

> **Destructive step.** Accepting the external IdP (step 5) deletes every Identity Center directory user/group (including the current `Admins` group and the `danmanners` / `tylerwitlin` IC users) and all permission-set assignments. SSO access is gone until SCIM re-provisions and assignments are recreated (steps 7-8). Keep management-account **root** credentials on hand as the break-glass path.

**Identity Center bootstrap (operators):**

1. Create management IAM role **`keeper-ic-pulumi`** in `977656673179`, trusted by `arn:aws:iam::417568418531:role/github-actions-keeper-aws-infra` (and the workload account root for local runs); inline policy grants `sso:*`, `sso-directory:*`, `identitystore:*`, `identitystore-auth:*`.
2. Console (mgmt): IC → Settings → Identity source → **Change** → *External identity provider* → **download the AWS SP metadata** (ACS URL + audience/entityID). Do **not** submit yet — current SSO keeps working until step 5.
3. Set `keeper-aws-infra:icAcsUrl` + `keeper-aws-infra:icAudience` in `infra/aws/Pulumi.prod.yaml`.
4. Create an Authentik API token; `export AUTHENTIK_URL=https://auth.goodmanners.services AUTHENTIK_TOKEN=…`. Run **`pulumi up` #1** (SAML-only): Authentik groups `aws-admins` / `aws-viewers`, SAML provider + application `aws-iam-identity-center`, and IC permission sets `aws-admins` (AdministratorAccess) / `aws-viewers` (ReadOnlyAccess). No SCIM, no assignments.
5. Download the Authentik IdP metadata for provider `aws-iam-identity-center` (`…/api/v3/providers/saml/<pk>/metadata/?download`); back in the console, upload it, type **ACCEPT**, submit. *(destructive — see box above)*
6. Console (mgmt): IC → Settings → **enable automatic provisioning** → copy the SCIM endpoint + access token.
7. Put `api_token` + `scim_token` in OpenBao **`secret/data/pulumi/authentik`**. Set `keeper-aws-infra:icScimUrl` in `Pulumi.prod.yaml`. Run **`pulumi up` #2** with `AUTHENTIK_SCIM_TOKEN` exported → attaches the SCIM backchannel provider to the app. Trigger the Authentik SCIM sync; add `danmanners` (and yourself) to Authentik group `aws-admins`.
8. Confirm Identity Store has groups **`aws-admins`** / **`aws-viewers`**; set `keeper-aws-infra:icAssignmentsEnabled: "true"`; run **`pulumi up` #3** → account assignments (both groups → workload `417568418531`).
9. Set GitHub repo variable **`AUTHENTIK_IC_ENABLED=true`** so the **aws-infra** workflow fetches the tokens from OpenBao on future runs.
10. Smoke: `danmanners` in `aws-admins` gets AdministratorAccess via the Authentik tile; a member of neither group is denied. Management-account admin is via root or a re-added assignment on the legacy `Admins` permission set.
