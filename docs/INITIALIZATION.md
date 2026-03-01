# AWS Infrastructure Initialization Guide

This guide covers deploying and initializing the restructured AWS stacks: **core-aws** (shared VPC, ECS cluster, Traefik, NLB) and application stacks (**openbao-aws**, **authentik-aws**) that reference it.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/) (v3.x)
- Node.js 18+
- AWS CLI configured (or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`)
- A **Route53 hosted zone** for your domain (for Traefik ACME DNS-01)
- Pulumi backend: `s3://pulumi-state-2e089842` (self-managed; StackReference org must be `organization`)

## Deploy Order

Deploy in this order; each step must succeed before the next:

1. **core-aws** – VPC, ECS cluster, Traefik, NLB
2. **openbao-aws** – OpenBao (and optional restore from snapshot)
3. **authentik-aws** – Authentik (and optional restore from snapshot)
4. Any additional application stacks

---

## 1. core-aws

### Config (required)

```bash
cd core-aws
pulumi stack init prod   # or use existing stack (prod/dev)
pulumi config set hostedZoneId Z0123456789ABC   # your Route53 hosted zone ID
pulumi config set acmeEmail admin@example.com  # Let's Encrypt / ACME email
```

Optional (recommended for dashboard):

```bash
pulumi config set domain example.com   # Enables read-only dashboard at traefik.example.com
pulumi config set vpcCidr 172.16.0.0/20
pulumi config set enableSpot true
pulumi config set traefikDesiredCount 2
```

### Deploy

```bash
npm install
pulumi preview
pulumi up
```

### Outputs

After deploy, note:

- **nlbDnsName** – NLB DNS name; point your app domains (CNAME or A/alias) here
- If `domain` is set, the **read-only Traefik dashboard** is at `https://traefik.${domain}`; point `traefik.${domain}` DNS to the NLB
- **clusterArn**, **vpcId**, **privateSubnetIds**, **traefikSecurityGroupId** – used by app stacks via StackReference
- **EFS** – Traefik uses a shared EFS volume at `/data` for acme.json; certificates persist across deployments and task replacements

---

## 2. openbao-aws

Depends on **core-aws** being deployed (same stack name: e.g. `prod` or `dev`).

### Config (required)

```bash
cd openbao-aws
pulumi stack init prod
pulumi config set openbaoDomain openbao.example.com   # domain for OpenBao; point DNS to core NLB
```

Optional (Aurora, scaling, spot):

```bash
pulumi config set desiredCount 2
pulumi config set auroraMinAcu 0.5
pulumi config set auroraMaxAcu 2
pulumi config set enableSpot true
```

### Disaster recovery (restore from snapshot)

If you have an Aurora cluster snapshot to restore from:

```bash
pulumi config set auroraSnapshotIdentifier rds:cluster-snapshot-id-or-arn
```

Then deploy. The stack will create a new cluster from the snapshot instead of a fresh DB. After restore, ensure the DB connection secret is updated with the new endpoint and password from the snapshot.

### Deploy

```bash
npm install
pulumi preview
pulumi up
```

### DNS

The stack creates a **Route53 A record** for **openbaoDomain** pointing to the core NLB (alias record). Ensure the core stack's hosted zone contains your domain. Traefik will route by Host and obtain a certificate via ACME.

### First-time init

The OpenBao init Lambda runs on a schedule and will initialize the server and store the root token in Secrets Manager. To read the root token:

```bash
aws secretsmanager get-secret-value --secret-id openbao-root-token-prod --query SecretString --output text
```

---

## 3. authentik-aws

Depends on **core-aws** (same stack name).

### Config (required)

```bash
cd authentik-aws
pulumi stack init prod
pulumi config set authentikDomain auth.example.com   # domain for Authentik; point DNS to core NLB
```

Optional:

```bash
pulumi config set authentikServerDesiredCount 2
pulumi config set authentikWorkerDesiredCount 2
pulumi config set enableSpot true
```

### Disaster recovery (restore from snapshot)

```bash
pulumi config set auroraSnapshotIdentifier rds:cluster-snapshot-id-or-arn
```

Deploy; the stack will restore Aurora from the snapshot. After restore, update the DB secret with the snapshot’s password if needed.

### Deploy

```bash
npm install
pulumi preview
pulumi up
```

### DNS

The stack creates a **Route53 A record** for **authentikDomain** pointing to the core NLB (alias record). Ensure the core stack's hosted zone contains your domain. Traefik will route and manage TLS.

---

## Traefik and Route53 IAM

Traefik runs in **core-aws** and:

- Discovers ECS services in the core cluster via the ECS provider (only tasks with `traefik.enable=true` are exposed).
- Obtains TLS certificates via Let’s Encrypt using the **DNS-01** challenge with Route53.

The Traefik task role in core-aws has:

- **ECS**: `ListClusters`, `DescribeClusters`, `ListTasks`, `DescribeTasks`, `DescribeTaskDefinition`, etc.
- **Route53**: `GetChange`, `ListHostedZones`, `ListResourceRecordSets`, `ChangeResourceRecordSets` (for ACME TXT records).

Ensure the **hosted zone** you pass to core-aws is the one used for the domains you assign to OpenBao and Authentik (e.g. `openbao.example.com`, `auth.example.com`).

---

## Disaster Recovery (Aurora)

For both **openbao-aws** and **authentik-aws**:

1. **If backups exist**: Set `auroraSnapshotIdentifier` to the cluster snapshot ID or ARN, then run `pulumi up`. A new cluster is created from the snapshot; app data (OpenBao/Authentik) is restored with it.
2. **If no backup**: Do not set `auroraSnapshotIdentifier`; the stack creates a new Aurora cluster and you configure the app from scratch.

After a restore, update any Secrets Manager secrets that hold DB connection details with the new cluster endpoint and password from the snapshot if they are not already correct.

---

## Adding a New Application Stack

1. Create a new Pulumi project (e.g. `myapp-aws`) in its own directory.
2. Add a **core** module that uses `StackReference("organization/core-aws/<stack>")` and exports `clusterArn`, `vpcId`, `privateSubnetIds`, `traefikSecurityGroupId`, `nlbDnsName`, `nlbZoneId`, `hostedZoneId`.
3. Define your ECS task with **Traefik labels** so Traefik discovers it:
   - `traefik.enable: "true"`
   - `traefik.http.routers.<name>.rule`: e.g. `Host(\`myapp.example.com\`)`
   - `traefik.http.services.<name>.loadbalancer.server.port`: your container port
4. Deploy the ECS service into the core cluster and subnets, using the core Traefik security group for ingress from Traefik to your app.
5. Add a **Route53 record** for your app’s domain pointing to the NLB (A record with alias target). Use the core stack's `hostedZoneId`, `nlbDnsName`, and `nlbZoneId`. See `openbao-aws/route53/record.ts` or `authentik-aws/route53/record.ts` for the pattern.

Use **openbao-aws** or **authentik-aws** as a reference for structure, StackReference usage, and Route53 record creation.
