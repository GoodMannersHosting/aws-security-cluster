# Hcloud Security Cluster – Usage

This repo provisions a **Talos Kubernetes cluster on Hetzner Cloud** using **Pulumi (TypeScript)**. It is a port of the [terraform-hcloud-talos](https://github.com/hcloud-talos/terraform-hcloud-talos) module.

## Prerequisites

- **Node.js** ≥ 20
- **Bun**
- **Pulumi CLI** ([install](https://www.pulumi.com/docs/install/))
- **Hetzner Cloud API token** ([create in console](https://console.hetzner.cloud))

## Quick start

### Creating and Uploading the Talos Image to Hetzner Cloud

```bash
#!/usr/bin/env bash
export TALOS_IMAGE_VERSION=v1.12.4 # You can change to the current version
export TALOS_IMAGE_ARCH=amd64 # You can change to arm architecture
export HCLOUD_SERVER_ARCH=x86 # HCloud server architecture can be x86 or arm
export HCLOUD_TOKEN=$(cat ~/.config/hetzner/token)
hcloud-upload-image upload \
--image-url "https://factory.talos.dev/image/ce4c980550dd2ab1b17bbf2b08801c7eb59418eafe8f279833297925d67c7515/$TALOS_IMAGE_VERSION/hcloud-$TALOS_IMAGE_ARCH.raw.xz" \
--compression xz \
--location ash \
--server-type cpx21
```

This installs the following extensions:

```yaml
customization:
    systemExtensions:
        officialExtensions:
            - siderolabs/qemu-guest-agent
```

### Install dependencies

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

All settings are under the `**hcloud-security-cluster**` config namespace.


| Config key                                                                           | Required     | Description                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hcloudToken`                                                                        | Yes (secret) | Hetzner Cloud API token. Prefer `pulumi config set ... --secret` or `HCLOUD_TOKEN` env.                                                                     |
| `clusterName`                                                                        | Yes          | Cluster name (e.g. `mycluster.example.com`).                                                                                                                |
| `kubernetesVersion`                                                                  | Yes          | Kubernetes version (e.g. `1.35.0`). Must match [Talos support matrix](https://docs.siderolabs.com/talos/latest/getting-started/support-matrix/).            |
| `talosVersion`                                                                       | Yes          | Talos version (e.g. `v1.12.2`).                                                                                                                             |
| `locationName`                                                                       | No           | Default Hetzner location (`fsn1`, `nbg1`, `hel1`, `ash`, `hil`, `sin`). Default: `fsn1`. All nodes must be in the same **network zone** (see below).        |
| `clusterDomain`                                                                      | No           | Cluster DNS domain. Default: `cluster.local`.                                                                                                               |
| `clusterPrefix`                                                                      | No           | Use cluster name as resource name prefix. Default: `false`.                                                                                                 |
| `controlPlaneNodes`                                                                  | Yes          | JSON array of `{ id, type, location?, labels?, taints? }`. `id` 1..N, `type` e.g. `cax11`, `cx22`.                                                          |
| `workerNodes`                                                                        | No           | JSON array of same shape. Default: `[]`.                                                                                                                    |
| **Firewall**                                                                         |              |                                                                                                                                                             |
| `firewallId`                                                                         | No           | Use existing Hetzner firewall ID instead of creating one.                                                                                                   |
| `firewallUseCurrentIp`                                                               | No           | If `true`, allow Kube API (6443) and Talos API (50000) from your current public IP. Default: `false`.                                                       |
| `firewallKubeApiSource`                                                              | No           | JSON array of CIDRs for Kube API (e.g. `["1.2.3.4/32"]`). Overrides current-IP when set.                                                                    |
| `firewallTalosApiSource`                                                             | No           | JSON array of CIDRs for Talos API.                                                                                                                          |
| `extraFirewallRules`                                                                 | No           | JSON array of `{ direction, protocol, port?, sourceIps?, destinationIps? }`. `direction`: `in`                                                              |
| **API / endpoints**                                                                  |              |                                                                                                                                                             |
| `enableFloatingIp`                                                                   | No           | Assign a floating IP to the first control plane. Default: `false`.                                                                                          |
| `floatingIpId`                                                                       | No           | Use existing floating IP by ID instead of creating one.                                                                                                     |
| `enableAliasIp`                                                                      | No           | Use private alias IP (VIP) for internal API. Default: `true`.                                                                                               |
| `clusterApiHost`                                                                     | No           | Public DNS name for the Kubernetes API (e.g. `kube.example.com`).                                                                                           |
| `clusterApiHostPrivate`                                                              | No           | Private DNS name for the API (e.g. over VPN).                                                                                                               |
| `kubeconfigEndpointMode`                                                             | No           | `public_ip`                                                                                                                                                 |
| `talosconfigEndpointsMode`                                                           | No           | `public_ip`                                                                                                                                                 |
| **Network**                                                                          |              |                                                                                                                                                             |
| `networkIpv4Cidr`                                                                    | No           | Network CIDR. Default: `10.0.0.0/16`.                                                                                                                       |
| `nodeIpv4Cidr`                                                                       | No           | Node subnet. Default: `10.0.1.0/24`.                                                                                                                        |
| `podIpv4Cidr`                                                                        | No           | Pod CIDR. Default: `10.0.16.0/20`.                                                                                                                          |
| `serviceIpv4Cidr`                                                                    | No           | Service CIDR. Default: `10.0.8.0/21`.                                                                                                                       |
| `enableIpv6`                                                                         | No           | Enable dual-stack (IPv6 pod/service CIDRs). Default: `false`.                                                                                               |
| `podIpv6Cidr`                                                                        | No           | IPv6 pod CIDR (e.g. `fd00:10:16::/56`). Used when `enableIpv6` is true.                                                                                     |
| `serviceIpv6Cidr`                                                                    | No           | IPv6 service CIDR (e.g. `fd00:10:8::/56`).                                                                                                                  |
| `enableKubeSpan`                                                                     | No           | Enable Talos KubeSpan (wireguard mesh). Default: `false`.                                                                                                   |
| **Nodes / Talos**                                                                    |              |                                                                                                                                                             |
| `sshPublicKey`                                                                       | No           | SSH public key for rescue/console. If unset, a temporary key is generated.                                                                                  |
| `controlPlaneAllowSchedule`                                                          | No           | Allow workloads on control plane nodes. Default: `false`.                                                                                                   |
| `disableX86`                                                                         | No           | Do not create x86 node types. Default: `false`.                                                                                                             |
| `disableArm`                                                                         | No           | Do not create ARM node types. Default: `false`.                                                                                                             |
| `talosImageIdX86` / `talosImageIdArm`                                                | No           | Hetzner image ID for Talos (overrides default image selector).                                                                                              |
| `talosIsoIdX86` / `talosIsoIdArm`                                                    | No           | Hetzner ISO ID for Talos (install from ISO).                                                                                                                |
| `talosSchematicExtensions`                                                           | No           | JSON array of Talos schematic extension names (all nodes).                                                                                                  |
| `talosSchematicExtraKernelArgs`                                                      | No           | JSON array of kernel args (all nodes).                                                                                                                      |
| `talosSchematicExtensionsControlPlane` / `talosSchematicExtraKernelArgsControlPlane` | No           | Same, control plane only.                                                                                                                                   |
| `talosSchematicExtensionsWorker` / `talosSchematicExtraKernelArgsWorker`             | No           | Same, workers only.                                                                                                                                         |
| `kubeletExtraArgs`                                                                   | No           | JSON object of kubelet args (e.g. `{"key":"value"}`).                                                                                                       |
| `kubeApiExtraArgs`                                                                   | No           | JSON object of kube-apiserver args.                                                                                                                         |
| `sysctlsExtraArgs`                                                                   | No           | JSON object of sysctls.                                                                                                                                     |
| `kernelModulesToLoad`                                                                | No           | JSON array of `{ name, parameters? }` for kernel modules.                                                                                                   |
| `talosControlPlaneExtraConfigPatches`                                                | No           | JSON array of Talos config patch strings (control plane).                                                                                                   |
| `talosWorkerExtraConfigPatches`                                                      | No           | JSON array of Talos config patch strings (workers).                                                                                                         |
| `registries`                                                                         | No           | JSON object for container registry config.                                                                                                                  |
| `extraManifests`                                                                     | No           | JSON array of manifest URLs or inline content.                                                                                                              |
| `disableTalosCoredns`                                                                | No           | Disable Talos in-cluster CoreDNS. Default: `false`.                                                                                                         |
| **Bootstrap / add-ons (Pulumi stack)**                                               |              |                                                                                                                                                             |
| `deployCilium`                                                                       | No           | Deploy Cilium from this stack. Default: `true` (stack may install; bootstrap also can).                                                                     |
| `ciliumVersion`                                                                      | No           | Cilium version when deployed by stack. Default: `1.16.2`.                                                                                                   |
| `ciliumValues`                                                                       | No           | Inline Helm values YAML for Cilium.                                                                                                                         |
| `ciliumEnableEncryption`                                                             | No           | Enable Cilium wireguard. Default: `false`.                                                                                                                  |
| `ciliumEnableServiceMonitors`                                                        | No           | Enable Cilium ServiceMonitors. Default: `false`.                                                                                                            |
| `deployPrometheusOperatorCrds`                                                       | No           | Deploy Prometheus Operator CRDs from stack. Default: `false`.                                                                                               |
| `prometheusOperatorCrdsVersion`                                                      | No           | Version for Prometheus Operator CRDs.                                                                                                                       |
| `deployHcloudCcm`                                                                    | No           | Deploy hcloud CCM from this stack. Default: `true`.                                                                                                         |
| `hcloudCcmVersion`                                                                   | No           | hcloud CCM version when deployed by stack.                                                                                                                  |
| `workerAutoscaling`                                                                  | No           | JSON: `{ "enabled": true, "min": 0, "max": 5, "serverType": "cax21", "location": "fsn1" }`. When enabled, use bootstrap Cluster Autoscaler (see Bootstrap). |


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


| Output             | Description                             |
| ------------------ | --------------------------------------- |
| `kubeconfig`       | Kubeconfig for the cluster (sensitive). |
| `talosconfig`      | Talos client config (sensitive).        |
| `publicIpv4List`   | Public IPv4s of control plane nodes.    |
| `hetznerNetworkId` | Hetzner network ID.                     |
| `firewallId`       | Firewall ID (if created).               |
| `talosWorkerIds`   | Map of worker index → server ID.        |


## Commands


| Command                      | Description                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `yarn` / `yarn install`      | Install dependencies.                                              |
| `yarn build`                 | Compile TypeScript.                                                |
| `pulumi preview`             | Show planned changes.                                              |
| `pulumi up`                  | Create or update the cluster.                                      |
| `pulumi destroy`             | Tear down all resources.                                           |
| `pulumi stack output <name>` | Print an output (use `--show-secrets` for kubeconfig/talosconfig). |


## Notes

- **Talos images**: By default the stack uses Hetzner images with selector `os=talos`. You can set `talosImageIdX86` / `talosImageIdArm` or `talosIsoIdX86` / `talosIsoIdArm` to use custom images or ISOs.
- **Firewall**: With `firewallUseCurrentIp: true`, your current public IP is fetched at run time and allowed to ports 6443 and 50000. For CI or fixed IPs, set `firewallKubeApiSource` and `firewallTalosApiSource` instead.
- **Cilium / hcloud CCM**: The Terraform module can deploy Cilium and the Hetzner Cloud Controller Manager via Helm/kubectl; this Pulumi port currently provisions the cluster only. You can deploy Cilium and hcloud-CCM yourself after the first `pulumi up` (e.g. with Helm or another Pulumi stack).

