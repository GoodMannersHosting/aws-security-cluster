# Hcloud Security Cluster – Usage

This repo provisions a **Talos Kubernetes cluster on Hetzner Cloud** using **Pulumi (TypeScript)**. It is a port of the [terraform-hcloud-talos](https://github.com/hcloud-talos/terraform-hcloud-talos) module.

## Prerequisites

- **Node.js** ≥ 20
- **Yarn**
- **Pulumi CLI** ([install](https://www.pulumi.com/docs/install/))
- **Hetzner Cloud API token** ([create in console](https://console.hetzner.cloud))

## Quick start

```bash
cd infrastructure
yarn install
```

Create a Pulumi stack (if you don’t have one) and set required config:

```bash
pulumi stack init dev   # or use existing stack
pulumi config set hcloud-security-cluster:hcloudToken --secret YOUR_HCLOUD_TOKEN
pulumi config set hcloud-security-cluster:clusterName mycluster.example.com
pulumi config set hcloud-security-cluster:locationName fsn1
pulumi config set hcloud-security-cluster:talosVersion "v1.12.2"
pulumi config set hcloud-security-cluster:kubernetesVersion "1.35.0"
```

Set node layout (one control plane, no workers):

```bash
pulumi config set hcloud-security-cluster:controlPlaneNodes '[{"id":1,"type":"cax11"}]'
pulumi config set hcloud-security-cluster:workerNodes '[]'
```

Allow your current IP on the firewall (so `pulumi up` and bootstrap can reach the nodes):

```bash
pulumi config set hcloud-security-cluster:firewallUseCurrentIp true
```

Preview and deploy:

```bash
pulumi preview
pulumi up
```

After a successful run, save kubeconfig and talosconfig:

```bash
pulumi stack output kubeconfig --show-secrets > kubeconfig
pulumi stack output talosconfig --show-secrets > talosconfig
chmod 600 kubeconfig talosconfig
export KUBECONFIG=$PWD/kubeconfig
kubectl get nodes
```

## Configuration

All settings are under the **`hcloud-security-cluster`** config namespace.

| Config key | Required | Description |
|------------|----------|-------------|
| `hcloudToken` | Yes (secret) | Hetzner Cloud API token. Prefer `pulumi config set ... --secret` or `HCLOUD_TOKEN` env. |
| `clusterName` | Yes | Cluster name (e.g. `mycluster.example.com`). |
| `kubernetesVersion` | Yes | Kubernetes version (e.g. `1.35.0`). Must match [Talos support matrix](https://docs.siderolabs.com/talos/latest/getting-started/support-matrix/). |
| `talosVersion` | Yes | Talos version (e.g. `v1.12.2`). |
| `locationName` | No | Hetzner location (`fsn1`, `nbg1`, `hel1`, etc.). Default: `fsn1`. |
| `clusterDomain` | No | Cluster DNS domain. Default: `cluster.local`. |
| `controlPlaneNodes` | Yes | JSON array of `{ id, type, labels?, taints? }`. `id` 1..N, `type` e.g. `cax11`, `cx22`. |
| `workerNodes` | No | JSON array of same shape. Default: `[]`. |
| `firewallUseCurrentIp` | No | If `true`, allow Kube API (6443) and Talos API (50000) from your current public IP. Default: `false`. |
| `firewallKubeApiSource` | No | JSON array of CIDRs for Kube API (overrides current-IP). |
| `firewallTalosApiSource` | No | JSON array of CIDRs for Talos API. |
| `enableFloatingIp` | No | Assign a floating IP to the first control plane. Default: `false`. |
| `enableAliasIp` | No | Use private alias IP (VIP) for internal API. Default: `true`. |
| `clusterApiHost` | No | Public DNS name for the Kubernetes API (e.g. `kube.example.com`). |
| `clusterApiHostPrivate` | No | Private DNS name for the API (e.g. over VPN). |
| `kubeconfigEndpointMode` | No | `public_ip` \| `private_ip` \| `public_endpoint` \| `private_endpoint`. Default: `public_ip`. |
| `talosconfigEndpointsMode` | No | `public_ip` \| `private_ip`. Default: `public_ip`. |
| `networkIpv4Cidr` | No | Network CIDR. Default: `10.0.0.0/16`. |
| `nodeIpv4Cidr` | No | Node subnet. Default: `10.0.1.0/24`. |
| `podIpv4Cidr` | No | Pod CIDR. Default: `10.0.16.0/20`. |
| `serviceIpv4Cidr` | No | Service CIDR. Default: `10.0.8.0/21`. |
| `sshPublicKey` | No | SSH public key for rescue/console. If unset, a temporary key is generated. |
| `controlPlaneAllowSchedule` | No | Allow workloads on control plane nodes. Default: `false`. |

### Node layout examples

Single control plane (ARM), no workers:

```bash
pulumi config set hcloud-security-cluster:controlPlaneNodes '[{"id":1,"type":"cax11"}]'
pulumi config set hcloud-security-cluster:workerNodes '[]'
```

Three control planes + three workers:

```bash
pulumi config set hcloud-security-cluster:controlPlaneNodes '[{"id":1,"type":"cax11"},{"id":2,"type":"cax11"},{"id":3,"type":"cax11"}]'
pulumi config set hcloud-security-cluster:workerNodes '[{"id":1,"type":"cax21"},{"id":2,"type":"cax21"},{"id":3,"type":"cax21"}]'
```

Mixed workers with labels and taints:

```bash
pulumi config set hcloud-security-cluster:workerNodes '[{"id":1,"type":"cx22"},{"id":2,"type":"cax21","labels":{"node.kubernetes.io/arch":"arm64"},"taints":[{"key":"arm64-only","value":"true","effect":"NoSchedule"}]}]'
```

## Outputs

| Output | Description |
|--------|-------------|
| `kubeconfig` | Kubeconfig for the cluster (sensitive). |
| `talosconfig` | Talos client config (sensitive). |
| `publicIpv4List` | Public IPv4s of control plane nodes. |
| `hetznerNetworkId` | Hetzner network ID. |
| `firewallId` | Firewall ID (if created). |
| `talosWorkerIds` | Map of worker index → server ID. |

## Commands

| Command | Description |
|---------|-------------|
| `yarn` / `yarn install` | Install dependencies. |
| `yarn build` | Compile TypeScript. |
| `pulumi preview` | Show planned changes. |
| `pulumi up` | Create or update the cluster. |
| `pulumi destroy` | Tear down all resources. |
| `pulumi stack output <name>` | Print an output (use `--show-secrets` for kubeconfig/talosconfig). |

## Notes

- **Talos images**: By default the stack uses Hetzner images with selector `os=talos`. You can set `talosImageIdX86` / `talosImageIdArm` or `talosIsoIdX86` / `talosIsoIdArm` to use custom images or ISOs.
- **Firewall**: With `firewallUseCurrentIp: true`, your current public IP is fetched at run time and allowed to ports 6443 and 50000. For CI or fixed IPs, set `firewallKubeApiSource` and `firewallTalosApiSource` instead.
- **Cilium / hcloud CCM**: The Terraform module can deploy Cilium and the Hetzner Cloud Controller Manager via Helm/kubectl; this Pulumi port currently provisions the cluster only. You can deploy Cilium and hcloud-CCM yourself after the first `pulumi up` (e.g. with Helm or another Pulumi stack).
