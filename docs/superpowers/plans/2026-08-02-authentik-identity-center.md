# Authentik IAM Identity Center IdP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage Authentik SAML+SCIM for AWS IAM Identity Center and IC permission sets/assignments from the existing `infra/aws` Pulumi stack, with Authentik/SCIM tokens from OpenBao.

**Architecture:** Dual providers in one stack — default AWS (workload) for existing Route53/OIDC; assumed-role AWS provider (org management) for SSO Admin / Identity Store; `@pulumi/authentik` for groups, SAML app, and SCIM. Identity-source switch + SCIM enablement are a one-time console bootstrap that feeds ACS/audience/SCIM URL into Pulumi config and tokens into OpenBao. Account assignments are two-phase (skip until SCIM groups exist).

**Tech Stack:** Pulumi TypeScript, `@pulumi/aws`, `@pulumi/authentik`, OpenBao JWT auth for GHA, existing `.github/workflows/aws-infra.yml`

**Spec:** `docs/superpowers/specs/2026-08-02-authentik-identity-center-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `infra/aws/package.json` | Add `@pulumi/authentik`; optional `tsx`/`node:test` scripts |
| `infra/aws/identityCenterAuthentik.ts` | Factory: Authentik groups/SAML/SCIM + IC permission sets/assignments |
| `infra/aws/identityCenterHelpers.ts` | Pure helpers (SCIM expression, assignment pending logic) — unit-tested |
| `infra/aws/identityCenterHelpers.test.ts` | Node test runner tests for helpers |
| `infra/aws/index.ts` | Wire module + exports |
| `infra/aws/githubOidc.ts` | Extend deploy role policy: `sts:AssumeRole` to management IC role |
| `infra/aws/Pulumi.prod.yaml` | Non-secret config keys + comments |
| `bao/policies/ci-aws-infra.hcl` | Read KV paths for Authentik API + SCIM tokens |
| `bao/jwt/github-actions-aws-infra.json` | JWT role for aws-infra workflow |
| `bao/setup-github-jwt.sh` | Optionally register the new role (or document manual `bao write`) |
| `.github/workflows/aws-infra.yml` | Bao JWT login + export `AUTHENTIK_*` / SCIM env before Pulumi |
| `README.md` / `stacks/README.md` | Short pointer to SSO path + bootstrap |

---

### Task 1: Pure helpers + unit tests

**Files:**
- Create: `infra/aws/identityCenterHelpers.ts`
- Create: `infra/aws/identityCenterHelpers.test.ts`
- Modify: `infra/aws/package.json` (add `"test": "node --import tsx --test identityCenterHelpers.test.ts"` and `tsx` as devDependency)

- [ ] **Step 1: Write failing tests**

```typescript
// infra/aws/identityCenterHelpers.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  awsScimUserMappingExpression,
  resolveAssignmentsPending,
} from "./identityCenterHelpers";

describe("awsScimUserMappingExpression", () => {
  it("maps userName to email and clears photos", () => {
    const expr = awsScimUserMappingExpression();
    assert.match(expr, /userName.*request\.user\.email/s);
    assert.match(expr, /photos.*None/s);
  });
});

describe("resolveAssignmentsPending", () => {
  it("is pending when either group id is missing", () => {
    assert.equal(resolveAssignmentsPending(undefined, "g2"), true);
    assert.equal(resolveAssignmentsPending("g1", undefined), true);
  });
  it("is not pending when both ids exist", () => {
    assert.equal(resolveAssignmentsPending("g1", "g2"), false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

Run: `cd infra/aws && npm install && npm test`  
Expected: FAIL cannot find module `./identityCenterHelpers`

- [ ] **Step 3: Implement helpers**

```typescript
// infra/aws/identityCenterHelpers.ts
/** Authentik SCIM mapping: IC username = email (matches SAML NameID email). */
export function awsScimUserMappingExpression(): string {
  return [
    "return {",
    '    "photos": None,',
    '    "userName": request.user.email,',
    "}",
  ].join("\n");
}

/** True when Identity Store group ids are not both available yet. */
export function resolveAssignmentsPending(
  adminGroupId: string | undefined,
  viewerGroupId: string | undefined,
): boolean {
  return !adminGroupId || !viewerGroupId;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd infra/aws && npm test`  
Expected: PASS (2 describe blocks)

- [ ] **Step 5: Commit**

```bash
git add infra/aws/identityCenterHelpers.ts infra/aws/identityCenterHelpers.test.ts infra/aws/package.json infra/aws/package-lock.json
git commit -m "feat(aws-infra): add Identity Center helper unit tests"
```

---

### Task 2: Dependencies and config knobs

**Files:**
- Modify: `infra/aws/package.json`
- Modify: `infra/aws/Pulumi.prod.yaml`

- [ ] **Step 1: Add Authentik provider package**

Run:

```bash
cd infra/aws && npm install @pulumi/authentik
```

Expected: `package.json` / lockfile include `@pulumi/authentik`.

- [ ] **Step 2: Document config in `Pulumi.prod.yaml`**

Append (replace ACCOUNT placeholders when known; do not commit secrets):

```yaml
  # Authentik + IAM Identity Center (see docs/superpowers/specs/2026-08-02-authentik-identity-center-design.md)
  # One-time bootstrap: change IC identity source to external IdP; enable SCIM; put tokens in OpenBao.
  # keeper-aws-infra:authentikUrl: https://auth.goodmanners.services
  # keeper-aws-infra:icManagementRoleArn: arn:aws:iam::MGMT_ACCOUNT:role/keeper-ic-pulumi
  # keeper-aws-infra:workloadAccountId: "WORKLOAD_ACCOUNT_ID"
  # keeper-aws-infra:icAcsUrl: https://portal.sso.us-east-1.amazonaws.com/saml/assertion/EXAMPLE
  # keeper-aws-infra:icAudience: https://portal.sso.us-east-1.amazonaws.com/saml/assertion/EXAMPLE
  # keeper-aws-infra:icScimUrl: https://scim.us-east-1.amazonaws.com/EXAMPLE/scim/v2/
  # Optional: keeper-aws-infra:icInstanceArn: arn:aws:sso:::instance/ssoins-...
  # Tokens: AUTHENTIK_TOKEN + AUTHENTIK_SCIM_TOKEN via env (from OpenBao in CI); never commit.
```

- [ ] **Step 3: Commit**

```bash
git add infra/aws/package.json infra/aws/package-lock.json infra/aws/Pulumi.prod.yaml
git commit -m "build(aws-infra): add @pulumi/authentik and IC config stubs"
```

---

### Task 3: OpenBao policy + JWT role for aws-infra CI

**Files:**
- Create: `bao/policies/ci-aws-infra.hcl`
- Create: `bao/jwt/github-actions-aws-infra.json`
- Modify: `bao/setup-github-jwt.sh` (add optional second role write) OR document one-shot `bao` commands in commit message / script comment

KV path convention (adjust if your mount differs; use `secret` KV v2):

- `secret/data/pulumi/authentik` → keys `api_token`, `scim_token`

- [ ] **Step 1: Write policy**

```hcl
# bao/policies/ci-aws-infra.hcl
# GitHub Actions aws-infra: read Authentik API + IC SCIM tokens for Pulumi.
path "secret/data/pulumi/authentik" {
  capabilities = ["read"]
}

path "secret/metadata/pulumi/authentik" {
  capabilities = ["read"]
}
```

- [ ] **Step 2: Write JWT role JSON**

```json
{
  "role_type": "jwt",
  "user_claim": "sub",
  "bound_audiences": ["https://github.com/GoodMannersHosting"],
  "bound_subject": "repo:GoodMannersHosting/cloud-security-cluster:ref:refs/heads/main",
  "bound_claims": {
    "repository": "GoodMannersHosting/cloud-security-cluster",
    "ref": "refs/heads/main"
  },
  "bound_claims_type": "string",
  "token_policies": ["ci-aws-infra"],
  "token_ttl": 600,
  "token_max_ttl": 600
}
```

- [ ] **Step 3: Extend `bao/setup-github-jwt.sh` to also write `ci-aws-infra` policy and `github-actions-aws-infra` role**

Mirror existing `write_ci_policy` / `write_ci_role` with:

- policy file `policies/ci-aws-infra.hcl`
- role name default `github-actions-aws-infra`
- role template `jwt/github-actions-aws-infra.json`

Keep existing `ci-sync` role unchanged.

- [ ] **Step 4: Commit**

```bash
git add bao/policies/ci-aws-infra.hcl bao/jwt/github-actions-aws-infra.json bao/setup-github-jwt.sh
git commit -m "feat(bao): add aws-infra JWT role to read Authentik Pulumi tokens"
```

---

### Task 4: Management-account assume-role IAM on deploy role

**Files:**
- Modify: `infra/aws/githubOidc.ts`

The deploy role lives in the **workload** account. It must be allowed to `sts:AssumeRole` into `icManagementRoleArn` in the org management account. The management role itself (trust + SSO Admin permissions) is created once out-of-band or in a follow-up; this task only grants AssumeRole from the GHA role when config is set.

- [ ] **Step 1: Extend `createGithubOidc` / `attachDeployPolicy` to accept optional `icManagementRoleArn`**

In `GithubOidcArgs` add:

```typescript
  /** Org management role Pulumi assumes for Identity Center APIs. */
  icManagementRoleArn?: string;
```

In `deployPolicyDocument`, if `icManagementRoleArn` is set, append statement:

```typescript
{
  Sid: "AssumeIdentityCenterManagementRole",
  Effect: "Allow",
  Action: ["sts:AssumeRole"],
  Resource: [icManagementRoleArn],
}
```

Pass the ARN into `deployPolicyDocument` from args (change signature from `(): string` to `(icManagementRoleArn?: string): string`).

- [ ] **Step 2: Wire from `index.ts` later (Task 6); for now unit-compile**

Run: `cd infra/aws && npx tsc --noEmit`  
Expected: PASS (or only unused-export noise if any)

- [ ] **Step 3: Commit**

```bash
git add infra/aws/githubOidc.ts
git commit -m "feat(aws-infra): allow deploy role to AssumeRole into IC management"
```

---

### Task 5: `identityCenterAuthentik` module (Authentik + IC resources)

**Files:**
- Create: `infra/aws/identityCenterAuthentik.ts`

- [ ] **Step 1: Define types and factory skeleton**

```typescript
import * as aws from "@pulumi/aws";
import * as authentik from "@pulumi/authentik";
import * as pulumi from "@pulumi/pulumi";
import {
  awsScimUserMappingExpression,
  resolveAssignmentsPending,
} from "./identityCenterHelpers";

export type IdentityCenterAuthentikArgs = {
  authentikUrl: string;
  /** From OpenBao / env; mark secret when passing through config. */
  scimToken: pulumi.Input<string>;
  icAcsUrl: string;
  icAudience: string;
  icScimUrl: string;
  workloadAccountId: string;
  /** Provider that talks to the org management account. */
  managementProvider: aws.Provider;
  /** Optional explicit IC instance ARN; otherwise discover. */
  icInstanceArn?: string;
  adminGroupName?: string; // default aws-admins
  viewerGroupName?: string; // default aws-viewers
};

export type IdentityCenterAuthentikResult = {
  assignmentsPending: pulumi.Output<boolean>;
  adminPermissionSetArn: pulumi.Output<string>;
  viewerPermissionSetArn: pulumi.Output<string>;
  authentikApplicationSlug: string;
};
```

Keep each function under 60 lines; split: `createAuthentikSide`, `createPermissionSets`, `createAssignments`.

- [ ] **Step 2: Authentik side**

Use:

- `authentik.Group` for `aws-admins` / `aws-viewers`
- `authentik.getFlow` — authorization: `default-provider-authorization-implicit-consent` (per Authentik AWS integration); invalidation: `default-provider-invalidation-flow`
- `authentik.getPropertyMappingProviderSaml` — managed email NameID mapping (`goauthentik.io/providers/saml/email` or name lookup for “authentik default SAML Mapping: Email” — verify against live Authentik; prefer `managed` id from docs)
- `authentik.ProviderSaml` — `acsUrl`, `audience`, `nameIdMapping`, signing certificate via `authentik.getCertificateKeyPair` name `authentik Self-signed Certificate` (same as existing blueprints) or a dedicated cert
- `authentik.Application` — slug `aws-iam-identity-center`, `protocolProvider` = SAML provider id, `metaLaunchUrl` = AWS access portal URL if known (optional config)
- `authentik.PropertyMappingProviderScim` — name sorts after default (`zz AWS SCIM User`), expression from `awsScimUserMappingExpression()`
- `authentik.getPropertyMappingProviderScim` — managed user + group defaults
- `authentik.ProviderScim` — `url`, `token` (secret), `compatibilityMode: "aws"`, property mappings; optionally `filterGroup` later
- Set application `backchannelProviders` to include SCIM provider id

Provider config: rely on env `AUTHENTIK_URL` + `AUTHENTIK_TOKEN` (set in CI). Do not hardcode the token.

- [ ] **Step 3: AWS permission sets (management provider)**

```typescript
const instances = aws.ssoadmin.getInstancesOutput({}, { provider: managementProvider });
const instanceArn = args.icInstanceArn
  ? pulumi.output(args.icInstanceArn)
  : instances.arns.apply((arns) => arns[0]);
const identityStoreId = instances.identityStoreIds.apply((ids) => ids[0]);

const adminPs = new aws.ssoadmin.PermissionSet(
  "ic-aws-admins",
  {
    name: "aws-admins",
    instanceArn,
    sessionDuration: "PT8H",
  },
  { provider: managementProvider },
);
new aws.ssoadmin.ManagedPolicyAttachment(
  "ic-aws-admins-admin",
  {
    instanceArn,
    permissionSetArn: adminPs.arn,
    managedPolicyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
  },
  { provider: managementProvider },
);
// Same pattern for aws-viewers + ReadOnlyAccess
```

- [ ] **Step 4: Two-phase assignments**

Look up groups:

```typescript
const adminGroup = aws.identitystore.getGroupOutput(
  {
    identityStoreId,
    alternateIdentifier: {
      uniqueAttribute: {
        attributePath: "DisplayName",
        attributeValue: adminGroupName,
      },
    },
  },
  { provider: managementProvider },
);
```

Because missing groups fail the data source, use a safer pattern for v1:

**v1 approach (explicit):** config flag `keeper-aws-infra:icAssignmentsEnabled` (boolean, default `false`). After operator confirms SCIM synced `aws-admins`/`aws-viewers` in Identity Store, set `true` and re-apply. Export `assignmentsPending = !icAssignmentsEnabled` until enabled; when enabled, create `aws.ssoadmin.AccountAssignment` for each group → permission set → `workloadAccountId` with `principalType: "GROUP"`.

This avoids flaky preview failures from missing Identity Store groups and matches the design’s two-phase intent more reliably than try/catch in Pulumi.

```typescript
new aws.ssoadmin.AccountAssignment(
  "ic-assign-admins",
  {
    instanceArn,
    permissionSetArn: adminPs.arn,
    principalId: adminGroup.groupId,
    principalType: "GROUP",
    targetId: args.workloadAccountId,
    targetType: "AWS_ACCOUNT",
  },
  { provider: managementProvider },
);
```

- [ ] **Step 5: `tsc --noEmit`**

Run: `cd infra/aws && npx tsc --noEmit`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add infra/aws/identityCenterAuthentik.ts
git commit -m "feat(aws-infra): add Authentik + Identity Center Pulumi module"
```

---

### Task 6: Wire `index.ts` + gate on config

**Files:**
- Modify: `infra/aws/index.ts`
- Modify: `infra/aws/githubOidc.ts` call site

- [ ] **Step 1: Read config and create management provider only when required keys exist**

```typescript
const authentikUrl = config.get("authentikUrl");
const icManagementRoleArn = config.get("icManagementRoleArn");
const workloadAccountId = config.get("workloadAccountId");
const icAcsUrl = config.get("icAcsUrl");
const icAudience = config.get("icAudience");
const icScimUrl = config.get("icScimUrl");
const icAssignmentsEnabled = config.getBoolean("icAssignmentsEnabled") ?? false;

const oidc = createGithubOidc({
  githubOrg,
  githubRepo,
  allowedRefs,
  existingProviderArn: existingOidcProviderArn,
  icManagementRoleArn,
});

let icResult: IdentityCenterAuthentikResult | undefined;
if (
  authentikUrl &&
  icManagementRoleArn &&
  workloadAccountId &&
  icAcsUrl &&
  icAudience &&
  icScimUrl
) {
  const managementProvider = new aws.Provider("ic-management", {
    region: awsConfig.get("region") ?? "us-east-1",
    assumeRoles: [{ roleArn: icManagementRoleArn }],
  });
  const scimToken = config.requireSecret("icScimToken"); // or process.env.AUTHENTIK_SCIM_TOKEN via pulumi.secret
  icResult = createIdentityCenterAuthentik({
    authentikUrl,
    scimToken,
    icAcsUrl,
    icAudience,
    icScimUrl,
    workloadAccountId,
    managementProvider,
    icInstanceArn: config.get("icInstanceArn"),
    assignmentsEnabled: icAssignmentsEnabled,
  });
}
```

Prefer env for SCIM token in CI (`process.env.AUTHENTIK_SCIM_TOKEN`) wrapped with `pulumi.secret(...)`, falling back to `config.getSecret("icScimToken")` for local use — never commit the secret value.

Export `assignmentsPending`, permission set ARNs when present.

- [ ] **Step 2: Preview without IC config still works**

Run: `cd infra/aws && pulumi preview` (local creds)  
Expected: no Authentik/IC resources if config unset; existing resources unchanged.

- [ ] **Step 3: Commit**

```bash
git add infra/aws/index.ts
git commit -m "feat(aws-infra): wire Identity Center Authentik module behind config"
```

---

### Task 7: GitHub Actions — OpenBao JWT + env for Pulumi

**Files:**
- Modify: `.github/workflows/aws-infra.yml`

- [ ] **Step 1: After AWS OIDC credentials, add OpenBao login + secret fetch**

Pattern (mask secrets):

```yaml
      - name: Fetch Authentik tokens from OpenBao
        env:
          BAO_ADDR: https://keeper.goodmanners.services
          BAO_AUTH_MOUNT: jwt
          BAO_ROLE: github-actions-aws-infra
          BAO_OIDC_AUDIENCE: https://github.com/GoodMannersHosting
        run: |
          set -euo pipefail
          OIDC_JWT="$(curl -sS -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
            "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${BAO_OIDC_AUDIENCE}" | jq -r .value)"
          BAO_TOKEN="$(curl -sS --request POST \
            --data "{\"role\":\"${BAO_ROLE}\",\"jwt\":\"${OIDC_JWT}\"}" \
            "${BAO_ADDR}/v1/auth/${BAO_AUTH_MOUNT}/login" | jq -r .auth.client_token)"
          SECRET="$(curl -sS -H "X-Vault-Token: ${BAO_TOKEN}" \
            "${BAO_ADDR}/v1/secret/data/pulumi/authentik")"
          API_TOKEN="$(echo "${SECRET}" | jq -r .data.data.api_token)"
          SCIM_TOKEN="$(echo "${SECRET}" | jq -r .data.data.scim_token)"
          echo "::add-mask::${API_TOKEN}"
          echo "::add-mask::${SCIM_TOKEN}"
          echo "AUTHENTIK_TOKEN=${API_TOKEN}" >> "${GITHUB_ENV}"
          echo "AUTHENTIK_SCIM_TOKEN=${SCIM_TOKEN}" >> "${GITHUB_ENV}"
          echo "AUTHENTIK_URL=https://auth.goodmanners.services" >> "${GITHUB_ENV}"
```

Ensure job `permissions` already has `id-token: write` (it does).

Only run this step when IC config is intended — or always, once secrets exist in Bao (fail closed if missing when IC keys are set).

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/aws-infra.yml
git commit -m "ci(aws-infra): fetch Authentik tokens from OpenBao via JWT"
```

---

### Task 8: Bootstrap runbook + README pointers

**Files:**
- Modify: `README.md` (short section) and/or `stacks/README.md`
- Amend committed design is already updated for AWS API limits

- [ ] **Step 1: Add operator bootstrap checklist to README (concise)**

1. Create management IAM role `keeper-ic-pulumi` trusted by workload deploy role ARN; attach SSO Admin + Identity Store read/write needed for permission sets and assignments.
2. Console: IC → change identity source → External IdP → download SP metadata → note ACS + audience.
3. Set Pulumi config (`authentikUrl`, ACS, audience, `icScimUrl` after step 6, management role ARN, workload account id).
4. `pulumi up` (Authentik SAML+SCIM + permission sets; assignments off).
5. Download Authentik IdP metadata for the new app; upload to IC; confirm `ACCEPT`.
6. Enable SCIM; put SCIM URL in config; put `api_token` + `scim_token` in OpenBao `secret/data/pulumi/authentik`.
7. Re-run `pulumi up` so SCIM provider has the real token; trigger Authentik SCIM sync.
8. Confirm Identity Store groups `aws-admins` / `aws-viewers`; set `icAssignmentsEnabled=true`; `pulumi up` again.
9. Smoke SSO with a user in each group.

- [ ] **Step 2: Commit**

```bash
git add README.md stacks/README.md docs/superpowers/specs/2026-08-02-authentik-identity-center-design.md
git commit -m "docs: Identity Center Authentik bootstrap and design API note"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Local**

```bash
cd infra/aws && npm test && npx tsc --noEmit
```

Expected: tests PASS; compile PASS.

- [ ] **Step 2: Preview with config (operator)**

With AWS SSO profile `gmh-admin` (or equivalent) and env tokens:

```bash
export AUTHENTIK_URL=https://auth.goodmanners.services
export AUTHENTIK_TOKEN=...
export AUTHENTIK_SCIM_TOKEN=...
cd infra/aws && pulumi preview -s prod
```

Expected: creates Authentik + permission set resources; no unexpected deletes of dnsweaver/OIDC.

- [ ] **Step 3: Apply + second apply for assignments**

Follow Task 8 checklist; confirm stack output `assignmentsPending` flips false after `icAssignmentsEnabled=true`.

- [ ] **Step 4: Final commit only if verification fixes were needed**

---

## Spec coverage self-check

| Spec item | Task |
|-----------|------|
| Authentik groups + SAML + SCIM in Pulumi | 5 |
| IC permission sets admin/readonly | 5 |
| Assignments to workload account, two-phase | 5 (`icAssignmentsEnabled`) |
| Same `infra/aws` stack | 6 |
| OpenBao tokens for CI | 3, 7 |
| Dual AWS providers / AssumeRole | 4, 6 |
| Existing blueprints untouched | (no tasks modify `authentik/blueprints/`) |
| Bootstrap identity source (API gap) | 8 + design amend |
| Verification / no secrets in git | 7, 9 |

## Placeholder scan

No TBD/TODO left in steps; OpenBao KV mount path is fixed to `secret/data/pulumi/authentik` (change in Task 3 if the live mount differs — verify with `bao kv get` before CI).

## Type consistency

- `IdentityCenterAuthentikArgs` / `Result` defined in Task 5; `index.ts` (Task 6) uses the same names.
- Helper `resolveAssignmentsPending` used if implementing soft pending; config flag `icAssignmentsEnabled` is the v1 control plane for assignments.
- Package name: `@pulumi/authentik` everywhere (not `@pulumiverse/authentik`).
