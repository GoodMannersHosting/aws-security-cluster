import * as pulumi from "@pulumi/pulumi";

export interface Taint {
  key: string;
  value: string;
  effect: "NoSchedule" | "PreferNoSchedule" | "NoExecute";
}

export interface ClusterNode {
  id: number;
  type: string;
  labels?: Record<string, string>;
  taints?: Taint[];
}

export interface TailscaleConfig {
  enabled: boolean;
  authKey: string;
}

export interface ClusterConfig {
  hcloudToken: string;
  clusterName: string;
  clusterDomain: string;
  clusterPrefix: boolean;
  clusterApiHost: string | undefined;
  clusterApiHostPrivate: string | undefined;
  locationName: string;
  kubeconfigEndpointMode: "public_ip" | "private_ip" | "public_endpoint" | "private_endpoint";
  talosconfigEndpointsMode: "public_ip" | "private_ip";

  firewallId: string | undefined;
  firewallUseCurrentIp: boolean;
  firewallKubeApiSource: string[] | undefined;
  firewallTalosApiSource: string[] | undefined;
  extraFirewallRules: Array<{
    description?: string;
    direction: string;
    protocol: string;
    port?: string;
    sourceIps?: string[];
    destinationIps?: string[];
  }>;

  enableFloatingIp: boolean;
  enableAliasIp: boolean;
  floatingIpId: number | undefined;
  enableIpv6: boolean;
  enableKubeSpan: boolean;

  networkIpv4Cidr: string;
  nodeIpv4Cidr: string;
  podIpv4Cidr: string;
  serviceIpv4Cidr: string;

  talosVersion: string;
  kubernetesVersion: string;
  sshPublicKey: string | undefined;
  controlPlaneNodes: ClusterNode[];
  controlPlaneAllowSchedule: boolean;
  workerNodes: ClusterNode[];

  disableX86: boolean;
  disableArm: boolean;
  talosImageIdX86: string | undefined;
  talosImageIdArm: string | undefined;
  talosIsoIdX86: string | undefined;
  talosIsoIdArm: string | undefined;

  kubeletExtraArgs: Record<string, string>;
  kubeApiExtraArgs: Record<string, string>;
  sysctlsExtraArgs: Record<string, string>;
  kernelModulesToLoad: Array<{ name: string; parameters?: string[] }>;
  talosControlPlaneExtraConfigPatches: string[];
  talosWorkerExtraConfigPatches: string[];
  tailscale: TailscaleConfig;
  registries: unknown;
  extraManifests: string[] | undefined;
  disableTalosCoredns: boolean;

  deployCilium: boolean;
  ciliumVersion: string;
  ciliumValues: string | undefined;
  ciliumEnableEncryption: boolean;
  ciliumEnableServiceMonitors: boolean;
  deployPrometheusOperatorCrds: boolean;
  prometheusOperatorCrdsVersion: string | undefined;
  deployHcloudCcm: boolean;
  hcloudCcmVersion: string | undefined;
}

const cfg = new pulumi.Config("hcloud-security-cluster");

function getOptionalString(key: string): string | undefined {
  try {
    const v = cfg.get(key);
    return v === "" ? undefined : v;
  } catch {
    return undefined;
  }
}

function getOptionalBoolean(key: string, def: boolean): boolean {
  try {
    return cfg.getBoolean(key) ?? def;
  } catch {
    return def;
  }
}

function parseJson<T>(key: string, def: T): T {
  try {
    const raw = cfg.get(key);
    if (raw == null || raw === "") return def;
    return JSON.parse(raw) as T;
  } catch {
    return def;
  }
}

export function getConfig(): ClusterConfig {
  const controlPlaneNodes = parseJson<ClusterNode[]>("controlPlaneNodes", [{ id: 1, type: "cax11" }]);
  const workerNodes = parseJson<ClusterNode[]>("workerNodes", []);

  const tailscaleRaw = parseJson<{ enabled?: boolean; authKey?: string }>("tailscale", { enabled: false, authKey: "" });
  const tailscale: TailscaleConfig = {
    enabled: tailscaleRaw.enabled ?? false,
    authKey: tailscaleRaw.authKey ?? "",
  };

  return {
    hcloudToken: cfg.requireSecret("hcloudToken") as unknown as string,
    clusterName: cfg.require("clusterName"),
    clusterDomain: cfg.get("clusterDomain") ?? "cluster.local",
    clusterPrefix: getOptionalBoolean("clusterPrefix", false),
    clusterApiHost: getOptionalString("clusterApiHost"),
    clusterApiHostPrivate: getOptionalString("clusterApiHostPrivate"),
    locationName: cfg.get("locationName") ?? "fsn1",
    kubeconfigEndpointMode: (cfg.get("kubeconfigEndpointMode") as ClusterConfig["kubeconfigEndpointMode"]) ?? "public_ip",
    talosconfigEndpointsMode: (cfg.get("talosconfigEndpointsMode") as ClusterConfig["talosconfigEndpointsMode"]) ?? "public_ip",

    firewallId: getOptionalString("firewallId"),
    firewallUseCurrentIp: getOptionalBoolean("firewallUseCurrentIp", false),
    firewallKubeApiSource: parseJson<string[] | undefined>("firewallKubeApiSource", undefined),
    firewallTalosApiSource: parseJson<string[] | undefined>("firewallTalosApiSource", undefined),
    extraFirewallRules: parseJson<ClusterConfig["extraFirewallRules"]>("extraFirewallRules", []),

    enableFloatingIp: getOptionalBoolean("enableFloatingIp", false),
    enableAliasIp: getOptionalBoolean("enableAliasIp", true),
    floatingIpId: cfg.getNumber("floatingIpId"),
    enableIpv6: getOptionalBoolean("enableIpv6", false),
    enableKubeSpan: getOptionalBoolean("enableKubeSpan", false),

    networkIpv4Cidr: cfg.get("networkIpv4Cidr") ?? "10.0.0.0/16",
    nodeIpv4Cidr: cfg.get("nodeIpv4Cidr") ?? "10.0.1.0/24",
    podIpv4Cidr: cfg.get("podIpv4Cidr") ?? "10.0.16.0/20",
    serviceIpv4Cidr: cfg.get("serviceIpv4Cidr") ?? "10.0.8.0/21",

    talosVersion: cfg.require("talosVersion"),
    kubernetesVersion: cfg.require("kubernetesVersion"),
    sshPublicKey: getOptionalString("sshPublicKey"),
    controlPlaneNodes,
    controlPlaneAllowSchedule: getOptionalBoolean("controlPlaneAllowSchedule", false),
    workerNodes,

    disableX86: getOptionalBoolean("disableX86", false),
    disableArm: getOptionalBoolean("disableArm", false),
    talosImageIdX86: getOptionalString("talosImageIdX86"),
    talosImageIdArm: getOptionalString("talosImageIdArm"),
    talosIsoIdX86: getOptionalString("talosIsoIdX86"),
    talosIsoIdArm: getOptionalString("talosIsoIdArm"),

    kubeletExtraArgs: parseJson<Record<string, string>>("kubeletExtraArgs", {}),
    kubeApiExtraArgs: parseJson<Record<string, string>>("kubeApiExtraArgs", {}),
    sysctlsExtraArgs: parseJson<Record<string, string>>("sysctlsExtraArgs", {}),
    kernelModulesToLoad: parseJson<ClusterConfig["kernelModulesToLoad"]>("kernelModulesToLoad", []),
    talosControlPlaneExtraConfigPatches: parseJson<string[]>("talosControlPlaneExtraConfigPatches", []),
    talosWorkerExtraConfigPatches: parseJson<string[]>("talosWorkerExtraConfigPatches", []),
    tailscale,
    registries: parseJson("registries", null),
    extraManifests: parseJson<string[] | undefined>("extraManifests", undefined),
    disableTalosCoredns: getOptionalBoolean("disableTalosCoredns", false),

    deployCilium: getOptionalBoolean("deployCilium", true),
    ciliumVersion: cfg.get("ciliumVersion") ?? "1.16.2",
    ciliumValues: getOptionalString("ciliumValues"),
    ciliumEnableEncryption: getOptionalBoolean("ciliumEnableEncryption", false),
    ciliumEnableServiceMonitors: getOptionalBoolean("ciliumEnableServiceMonitors", false),
    deployPrometheusOperatorCrds: getOptionalBoolean("deployPrometheusOperatorCrds", false),
    prometheusOperatorCrdsVersion: getOptionalString("prometheusOperatorCrdsVersion"),
    deployHcloudCcm: getOptionalBoolean("deployHcloudCcm", true),
    hcloudCcmVersion: getOptionalString("hcloudCcmVersion"),
  };
}
