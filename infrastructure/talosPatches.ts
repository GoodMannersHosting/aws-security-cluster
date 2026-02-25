/**
 * Build Talos machine config patches (control plane and worker).
 */

import type { ClusterConfig } from "./config";

const TALOS_CCM_MANIFEST_URL =
  "https://raw.githubusercontent.com/siderolabs/talos-cloud-controller-manager/v1.6.0/docs/deploy/cloud-controller-manager-daemonset.yml";

export interface PatchRuntime {
  floatingIpAddress: string | null;
  privateVipAddress: string;
  nodeIpv4Cidr: string;
  nodeIpv4CidrMaskSize: string;
  certSANs: string[];
  extraHostEntries: Array<{ ip: string; aliases: string[] }>;
  hcloudToken: string;
  networkId: string;
  workerCount: number;
}

function baseKubelet(
  config: ClusterConfig,
  taints: Array<{ key: string; value: string; effect: string }>,
) {
  const extra: Record<string, unknown> = {
    "cloud-provider": "external",
    "rotate-server-certificates": true,
    ...config.kubeletExtraArgs,
  };
  const validSubnets: string[] = [config.nodeIpv4Cidr];
  if (config.enableIpv6 && config.podIpv6Cidr) {
    validSubnets.push("::/0");
  }
  const block: Record<string, unknown> = {
    extraArgs: extra,
    nodeIP: { validSubnets },
  };
  if (taints.length > 0) {
    block.extraConfig = {
      registerWithTaints: taints.map((t) => ({
        key: t.key,
        value: t.value,
        effect: t.effect,
      })),
    };
  }
  return block;
}

function baseSysctls(config: ClusterConfig): Record<string, string> {
  return {
    "net.core.somaxconn": "65535",
    "net.core.netdev_max_backlog": "4096",
    ...config.sysctlsExtraArgs,
  };
}

function baseTime(): Record<string, unknown> {
  return {
    servers: [
      "ntp1.hetzner.de",
      "ntp2.hetzner.com",
      "ntp3.hetzner.net",
      "time.cloudflare.com",
    ],
  };
}

export function buildControlPlanePatch(
  config: ClusterConfig,
  runtime: PatchRuntime,
  nodeLabels: Record<string, string>,
  taints: Array<{ key: string; value: string; effect: string }>,
): Record<string, unknown> {
  const machine: Record<string, unknown> = {
    install: { image: `ghcr.io/siderolabs/installer:${config.talosVersion}` },
    certSANs: runtime.certSANs,
    kubelet: baseKubelet(config, taints),
    nodeLabels:
      config.workerNodes.length === 0
        ? {
            ...nodeLabels,
            "node.kubernetes.io/exclude-from-external-load-balancers": {
              $patch: "delete",
            },
          }
        : nodeLabels,
    network: {
      interfaces: [
        {
          interface: "eth0",
          dhcp: true,
          vip: runtime.floatingIpAddress
            ? {
                ip: runtime.floatingIpAddress,
                hcloud: { apiToken: config.hcloudToken },
              }
            : null,
        },
        {
          interface: "eth1",
          dhcp: true,
          vip: config.enableAliasIp
            ? {
                ip: runtime.privateVipAddress,
                hcloud: { apiToken: config.hcloudToken },
              }
            : null,
        },
      ],
      extraHostEntries: runtime.extraHostEntries,
      kubespan: {
        enabled: config.enableKubeSpan,
        advertiseKubernetesNetworks: false,
        mtu: 1370,
      },
    },
    kernel: { modules: config.kernelModulesToLoad },
    sysctls: baseSysctls(config),
    features: {
      kubernetesTalosAPIAccess: {
        enabled: true,
        allowedRoles: ["os:reader"],
        allowedKubernetesNamespaces: ["kube-system"],
      },
      hostDNS: {
        enabled: true,
        forwardKubeDNSToHost: true,
        resolveMemberNames: true,
      },
    },
    time: baseTime(),
    registries: config.registries ?? undefined,
  };

  const podSubnets =
    config.enableIpv6 && config.podIpv6Cidr
      ? [config.podIpv4Cidr, config.podIpv6Cidr]
      : [config.podIpv4Cidr];
  const serviceSubnets =
    config.enableIpv6 && config.serviceIpv6Cidr
      ? [config.serviceIpv4Cidr, config.serviceIpv6Cidr]
      : [config.serviceIpv4Cidr];
  const cluster: Record<string, unknown> = {
    allowSchedulingOnControlPlanes:
      config.controlPlaneAllowSchedule || runtime.workerCount === 0,
    network: {
      dnsDomain: config.clusterDomain,
      podSubnets,
      serviceSubnets,
      cni: { name: "none" },
    },
    coreDNS: { disabled: config.disableTalosCoredns },
    proxy: { disabled: true },
    apiServer: {
      certSANs: runtime.certSANs,
      extraArgs: config.kubeApiExtraArgs,
    },
    controllerManager: {
      extraArgs: {
        "cloud-provider": "external",
        "node-cidr-mask-size-ipv4": runtime.nodeIpv4CidrMaskSize,
        "bind-address": "0.0.0.0",
      },
    },
    etcd: {
      advertisedSubnets: [runtime.nodeIpv4Cidr],
      extraArgs: { "listen-metrics-urls": "http://0.0.0.0:2381" },
    },
    scheduler: { extraArgs: { "bind-address": "0.0.0.0" } },
    extraManifests: config.extraManifests ?? [],
    inlineManifests: [
      {
        name: "hcloud-secret",
        contents: `apiVersion: v1
kind: Secret
type: Opaque
metadata:
  name: hcloud
  namespace: kube-system
data:
  network: ${Buffer.from(runtime.networkId).toString("base64")}
  token: ${Buffer.from(runtime.hcloudToken).toString("base64")}
`,
      },
    ],
    externalCloudProvider: {
      enabled: true,
      manifests: [TALOS_CCM_MANIFEST_URL],
    },
  };

  return { machine, cluster };
}

export function buildWorkerPatch(
  config: ClusterConfig,
  runtime: PatchRuntime,
  nodeLabels: Record<string, string>,
  taints: Array<{ key: string; value: string; effect: string }>,
): Record<string, unknown> {
  const machine: Record<string, unknown> = {
    install: { image: `ghcr.io/siderolabs/installer:${config.talosVersion}` },
    certSANs: runtime.certSANs,
    kubelet: baseKubelet(config, taints),
    nodeLabels,
    network: {
      extraHostEntries: runtime.extraHostEntries,
      kubespan: {
        enabled: config.enableKubeSpan,
        advertiseKubernetesNetworks: false,
        mtu: 1370,
      },
    },
    kernel: { modules: config.kernelModulesToLoad },
    sysctls: baseSysctls(config),
    features: {
      hostDNS: {
        enabled: true,
        forwardKubeDNSToHost: true,
        resolveMemberNames: true,
      },
    },
    time: baseTime(),
    registries: config.registries ?? undefined,
  };

  const podSubnetsWorker =
    config.enableIpv6 && config.podIpv6Cidr
      ? [config.podIpv4Cidr, config.podIpv6Cidr]
      : [config.podIpv4Cidr];
  const serviceSubnetsWorker =
    config.enableIpv6 && config.serviceIpv6Cidr
      ? [config.serviceIpv4Cidr, config.serviceIpv6Cidr]
      : [config.serviceIpv4Cidr];
  const cluster: Record<string, unknown> = {
    network: {
      dnsDomain: config.clusterDomain,
      podSubnets: podSubnetsWorker,
      serviceSubnets: serviceSubnetsWorker,
      cni: { name: "none" },
    },
  };

  return { machine, cluster };
}
