# dnsweaver IAM Roles Anywhere (greenfield)

Date: 2026-08-01  
Status: approved for planning  
Scope: dnsweaver Route53 webhook credentials only. Backup/OpenBao RA, Authentik, and IAM Identity Center are out of scope.

## Problem

`route53-dnsweaver-webhook` is distroless and today is documented to consume either static IAM keys or a mounted `credential_process` profile. Host-path `credential_process` (as used by keeper backups) does not work inside that container: it cannot exec `aws_signing_helper` at host paths. We want short-lived credentials via IAM Roles Anywhere with no long-lived access keys in the dnsweaver stack.

## Goals

- Dedicated IAM role and Roles Anywhere trust path for dnsweaver only.
- Certificate material created with `@pulumi/tls` in `infra/aws`.
- Temporary credentials delivered to the webhook via `aws_signing_helper serve` sidecar + `AWS_EC2_METADATA_SERVICE_ENDPOINT`.
- Zone-scoped Route53 permissions only (`goodmanners.services`).

## Non-goals

- Reusing or modifying existing keeper backup / OpenBao Roles Anywhere CA, trust anchor, or roles.
- Authentik config in Pulumi; AWS IAM Identity Center federation.
- Changing dnsweaver record selection, ownership TXT, or dry-run semantics beyond credential wiring.

## Architecture

```text
Pulumi (infra/aws)
  tls CA + leaf  -->  Roles Anywhere trust anchor + profile
                 -->  IAM role keeper-dnsweaver-route53-ra + zone policy
                 -->  secret outputs (leaf cert/key, ARNs, zone id)

keeper host
  install script writes /opt/stacks/dnsweaver/aws/{dnsweaver.crt,dnsweaver.key}

compose (stacks/dnsweaver)
  ra-creds (serve on 127.0.0.1:9911)
       ^
       | network_mode share
  route53-webhook (AWS SDK via AWS_EC2_METADATA_SERVICE_ENDPOINT)
       ^
  dnsweaver --> HTTP webhook --> Route53 API
```

## Pulumi (`infra/aws`, stack `prod`)

1. **TLS (`@pulumi/tls`)**
   - CA private key + self-signed CA certificate.
   - Leaf private key, CSR, and `LocallySignedCert` for dnsweaver.
   - Leaf allowed uses: `digitalSignature`, `clientAuth`.
   - Reasonable validity with `earlyRenewalHours` so `pulumi up` can rotate before expiry.

2. **Roles Anywhere**
   - Trust anchor whose source is the new CA certificate PEM.
   - Profile that permits assuming the dnsweaver RA role.

3. **IAM**
   - Keep the existing zone-scoped managed policy pattern (`ChangeResourceRecordSets`, `ListResourceRecordSets`, `GetHostedZone` on the zone ARN; `ListHostedZones*` for SDK discovery).
   - Role `keeper-dnsweaver-route53-ra` with trust principal `rolesanywhere.amazonaws.com`, conditioned on `aws:SourceArn` equal to **this** trust anchor.
   - Attach the zone policy to that role.

4. **Static IAM user / access key**
   - Do not create by default when the RA path is enabled (config gate or remove from the happy path). RA is the primary credential mode.

5. **Outputs**
   - Non-secret: trust-anchor ARN, profile ARN, role ARN, hosted zone id, CA cert PEM (public).
   - Secret: leaf certificate PEM, leaf private key PEM.

No references to existing backup/OpenBao RA ARNs or host paths under `stacks/ops/aws/keeper.*`.

## Host layout

Directory: `/opt/stacks/dnsweaver/aws/` (mode `0700`, not committed).

| Path | Content |
|------|---------|
| `dnsweaver.crt` | Leaf certificate from Pulumi |
| `dnsweaver.key` | Leaf private key from Pulumi |

Optional: retain CA cert on host for inspection only; AWS already has it as the trust anchor.

Provide `stacks/ops/install-dnsweaver-ra.sh` (or equivalent) that:

1. Reads Pulumi stack outputs (including secrets).
2. Writes PEMs with restrictive permissions.
3. Reminds/ensures stack env has ARNs + `ROUTE53_HOSTED_ZONE_ID` and **empty** `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.

`aws_signing_helper` runs from a pinned official helper image or a host-mounted binary; prefer the official image for the sidecar.

## Compose (`stacks/dnsweaver`)

- Add service `ra-creds`:
  - Runs `aws_signing_helper serve` with mounted cert/key and env for role / trust-anchor / profile ARNs and region.
  - Listens on `127.0.0.1:9911` (default).
- Share network namespace with `route53-webhook` (`network_mode: service:ra-creds` or equivalent) so the webhook can reach loopback IMDS.
- On `route53-webhook`:
  - `AWS_EC2_METADATA_SERVICE_ENDPOINT=http://127.0.0.1:9911` (no trailing slash).
  - `AWS_REGION` set.
  - Leave static key env vars unset/empty.
  - Shared credentials file mount is not required for the RA path.
- Keep webhook on the `dns` network for Route53 egress; no Traefik labels; no published ports.
- ARNs and zone id belong in SOPS-encrypted stack env; private key stays only on the host PEM files.

## Rollout

1. Implement Pulumi resources; `pulumi up`.
2. Run install script on keeper; update and re-encrypt dnsweaver secrets (ARNs, zone id; no static keys).
3. Deploy compose via Doco-CD.
4. Leave `DNSWEAVER_DRY_RUN=true` until dnsweaver logs match intent; then set `false` and re-encrypt.

## Failure modes

| Symptom | Likely cause |
|---------|----------------|
| SDK / IMDS errors in webhook logs | Sidecar down or network namespace not shared |
| CreateSession / untrusted certificate | Wrong cert, expired leaf, or trust anchor mismatch |
| AccessDenied on Route53 | Policy/zone id mismatch |
| Unexpected use of long-lived keys | Static `AWS_*` still set (they take precedence) |

Leaf renewal: `pulumi up` (early renewal) + re-run install script; document as an ops step (optional later automation).

## Verification

- `pulumi stack output` for ARNs and zone id.
- With IMDS endpoint pointed at the sidecar: `aws sts get-caller-identity` shows `keeper-dnsweaver-route53-ra`.
- Webhook/dnsweaver logs show successful reconcile after dry-run is disabled.
- Decrypted stack env has no `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.

## Documentation updates (implementation)

- `stacks/README.md` dnsweaver IAM section: replace `credential_process`-in-container guidance with sidecar + Pulumi TLS flow.
- `stacks/dnsweaver/.env.example`: ARN placeholders; static keys optional/empty.
- `infra/aws/Pulumi.prod.yaml` comments for RA-by-default path.

## Deferred

- Authentik configuration via Pulumi.
- AWS IAM Identity Center federation with Authentik.
- Any shared CA with backup/OpenBao RA.
