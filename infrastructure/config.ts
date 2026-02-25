import * as pulumi from "@pulumi/pulumi";
import { validateCidr, validateCidrIpv6 } from "./locals";

export interface Taint {
  key: string;
  value: string;
  effect: "NoSchedule" | "PreferNoSchedule" | "NoExecute";
}

/** Per-node config; optional location enables multi-region (same network zone only). */
export interface ClusterNode {
  id: number;
  type: string;
  location?: string;
  labels?: Record<string, string>;
  taints?: Taint[];
}

/** Hetzner Cloud locations (same list as hcloud). */
export const HCLOUD_LOCATIONS = [
  "fsn1",
  "nbg1",
  "hel1",
  "ash",
  "hil",
  "sin",
] as const;

/** Network zone per location (all nodes must share one zone). */
export const HCLOUD_LOCATION_ZONE: Record<string, string> = {
  fsn1: "eu-central",
  nbg1: "eu-central",
  hel1: "eu-central",
  ash: "us-east",
  hil: "us-west",
  sin: "ap-southeast",
};

export interface ClusterConfig {
  hcloudToken: string;
  clusterName: string;
  clusterDomain: string;
  clusterPrefix: boolean;
  clusterApiHost: string | undefined;
  clusterApiHostPrivate: string | undefined;
  locationName: string;
  kubeconfigEndpointMode:
    | "public_ip"
    | "private_ip"
    | "public_endpoint"
    | "private_endpoint";
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
  /** Set when enableIpv6; used for Kubernetes pod CIDR dual-stack. */
  podIpv6Cidr: string | undefined;
  /** Set when enableIpv6; used for Kubernetes service CIDR dual-stack. */
  serviceIpv6Cidr: string | undefined;

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
  talosSchematicExtensions: string[];
  talosSchematicExtraKernelArgs: string[];
  talosSchematicExtensionsControlPlane: string[];
  talosSchematicExtraKernelArgsControlPlane: string[];
  talosSchematicExtensionsWorker: string[];
  talosSchematicExtraKernelArgsWorker: string[];

  kubeletExtraArgs: Record<string, string>;
  kubeApiExtraArgs: Record<string, string>;
  sysctlsExtraArgs: Record<string, string>;
  kernelModulesToLoad: Array<{ name: string; parameters?: string[] }>;
  talosControlPlaneExtraConfigPatches: string[];
  talosWorkerExtraConfigPatches: string[];
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

  /** Optional node autoscaling pool (Cluster Autoscaler on Hetzner). */
  workerAutoscaling: {
    enabled: boolean;
    min: number;
    max: number;
    serverType: string;
    location: string;
  } | null;
}

const cfg = new pulumi.Config("hcloud-security-cluster");

const KUBECONFIG_MODES = [
  "public_ip",
  "private_ip",
  "public_endpoint",
  "private_endpoint",
] as const;
const TALOSCONFIG_MODES = ["public_ip", "private_ip"] as const;
const FIREWALL_DIRECTIONS = ["in", "out"] as const;
const FIREWALL_PROTOCOLS = ["tcp", "udp", "icmp", "esp", "gre"] as const;

function getOptionalString(key: string): string | undefined {
  const v = cfg.get(key);
  return v === "" ? undefined : v;
}

function getOptionalBoolean(key: string, def: boolean): boolean {
  const v = cfg.getBoolean(key);
  return v ?? def;
}

function parseJson<T>(key: string, def: T): T {
  const raw = cfg.get(key);
  if (raw == null || raw === "") return def;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return def;
  }
}

function parseEndpointMode<
  K extends "kubeconfigEndpointMode" | "talosconfigEndpointsMode",
>(key: K, def: ClusterConfig[K]): ClusterConfig[K] {
  const v = cfg.get(key);
  if (v == null || v === "") return def;
  const allowed =
    key === "kubeconfigEndpointMode" ? KUBECONFIG_MODES : TALOSCONFIG_MODES;
  return (allowed.includes(v as never) ? v : def) as ClusterConfig[K];
}

function validateLocation(loc: string, context: string): void {
  if (!HCLOUD_LOCATIONS.includes(loc as (typeof HCLOUD_LOCATIONS)[number])) {
    throw new Error(
      `${context}: invalid location "${loc}". Allowed: ${HCLOUD_LOCATIONS.join(", ")}`,
    );
  }
}

function validateSameZone(locations: string[], context: string): void {
  const zones = [...new Set(locations.map((loc) => HCLOUD_LOCATION_ZONE[loc]))];
  if (zones.length > 1) {
    throw new Error(
      `${context}: all nodes must be in the same network zone. ` +
        `Locations ${locations.join(", ")} map to zones: ${zones.join(", ")}`,
    );
  }
}

function validateExtraFirewallRules(
  rules: ClusterConfig["extraFirewallRules"],
): ClusterConfig["extraFirewallRules"] {
  return rules.map((r, i) => {
    const dir = r.direction as string;
    const proto = r.protocol as string;
    if (
      !FIREWALL_DIRECTIONS.includes(dir as (typeof FIREWALL_DIRECTIONS)[number])
    ) {
      throw new Error(
        `extraFirewallRules[${i}]: direction must be "in" or "out"`,
      );
    }
    if (
      !FIREWALL_PROTOCOLS.includes(proto as (typeof FIREWALL_PROTOCOLS)[number])
    ) {
      throw new Error(
        `extraFirewallRules[${i}]: protocol must be tcp, udp, icmp, esp, or gre`,
      );
    }
    return r;
  });
}

export function getConfig(): ClusterConfig {
  const controlPlaneNodes = parseJson<ClusterNode[]>("controlPlaneNodes", [
    { id: 1, type: "cax11" },
  ]);
  const workerNodes = parseJson<ClusterNode[]>("workerNodes", []);

  if (controlPlaneNodes.length === 0) {
    throw new Error("At least one control plane node is required");
  }

  const locationName = cfg.get("locationName") ?? "fsn1";
  validateLocation(locationName, "locationName");

  const controlPlaneLocations = controlPlaneNodes.map(
    (n) => n.location ?? locationName,
  );
  const workerLocations = workerNodes.map((n) => n.location ?? locationName);
  controlPlaneLocations.forEach((loc, i) =>
    validateLocation(loc, `controlPlaneNodes[${i}].location`),
  );
  workerLocations.forEach((loc, i) =>
    validateLocation(loc, `workerNodes[${i}].location`),
  );
  validateSameZone(
    [...controlPlaneLocations, ...workerLocations],
    "Multi-region",
  );

  const networkIpv4Cidr = cfg.get("networkIpv4Cidr") ?? "10.0.0.0/16";
  const nodeIpv4Cidr = cfg.get("nodeIpv4Cidr") ?? "10.0.1.0/24";
  const podIpv4Cidr = cfg.get("podIpv4Cidr") ?? "10.0.16.0/20";
  const serviceIpv4Cidr = cfg.get("serviceIpv4Cidr") ?? "10.0.8.0/21";
  validateCidr(networkIpv4Cidr, "networkIpv4Cidr");
  validateCidr(nodeIpv4Cidr, "nodeIpv4Cidr");
  validateCidr(podIpv4Cidr, "podIpv4Cidr");
  validateCidr(serviceIpv4Cidr, "serviceIpv4Cidr");

  const extraFirewallRules = parseJson<ClusterConfig["extraFirewallRules"]>(
    "extraFirewallRules",
    [],
  );
  validateExtraFirewallRules(extraFirewallRules);

  const enableIpv6 = getOptionalBoolean("enableIpv6", false);
  const podIpv6CidrRaw =
    getOptionalString("podIpv6Cidr") ??
    (enableIpv6 ? "fd00:10:16::/56" : undefined);
  const serviceIpv6CidrRaw =
    getOptionalString("serviceIpv6Cidr") ??
    (enableIpv6 ? "fd00:10:8::/56" : undefined);
  if (enableIpv6) {
    if (podIpv6CidrRaw) validateCidrIpv6(podIpv6CidrRaw, "podIpv6Cidr");
    if (serviceIpv6CidrRaw)
      validateCidrIpv6(serviceIpv6CidrRaw, "serviceIpv6Cidr");
  }
  const podIpv6Cidr = enableIpv6 ? podIpv6CidrRaw : undefined;
  const serviceIpv6Cidr = enableIpv6 ? serviceIpv6CidrRaw : undefined;

  const workerAutoscalingRaw = parseJson<{
    enabled?: boolean;
    min?: number;
    max?: number;
    serverType?: string;
    location?: string;
  } | null>("workerAutoscaling", null);
  let workerAutoscaling: ClusterConfig["workerAutoscaling"] = null;
  if (workerAutoscalingRaw && workerAutoscalingRaw.enabled) {
    const min = workerAutoscalingRaw.min ?? 0;
    const max = workerAutoscalingRaw.max ?? 1;
    const serverType = workerAutoscalingRaw.serverType ?? "cax21";
    const loc = (workerAutoscalingRaw.location ?? locationName).toLowerCase();
    if (min > max) {
      throw new Error("workerAutoscaling: min must be <= max");
    }
    if (min < 0 || max < 1) {
      throw new Error("workerAutoscaling: min >= 0 and max >= 1 required");
    }
    validateLocation(loc, "workerAutoscaling.location");
    workerAutoscaling = {
      enabled: true,
      min,
      max,
      serverType,
      location: loc,
    };
  }

  return {
    hcloudToken: cfg.requireSecret("hcloudToken") as unknown as string,
    clusterName: cfg.require("clusterName"),
    clusterDomain: cfg.get("clusterDomain") ?? "cluster.local",
    clusterPrefix: getOptionalBoolean("clusterPrefix", false),
    clusterApiHost: getOptionalString("clusterApiHost"),
    clusterApiHostPrivate: getOptionalString("clusterApiHostPrivate"),
    locationName,
    kubeconfigEndpointMode: parseEndpointMode(
      "kubeconfigEndpointMode",
      "public_ip",
    ),
    talosconfigEndpointsMode: parseEndpointMode(
      "talosconfigEndpointsMode",
      "public_ip",
    ),

    firewallId: getOptionalString("firewallId"),
    firewallUseCurrentIp: getOptionalBoolean("firewallUseCurrentIp", false),
    firewallKubeApiSource: parseJson<string[] | undefined>(
      "firewallKubeApiSource",
      undefined,
    ),
    firewallTalosApiSource: parseJson<string[] | undefined>(
      "firewallTalosApiSource",
      undefined,
    ),
    extraFirewallRules,

    enableFloatingIp: getOptionalBoolean("enableFloatingIp", false),
    enableAliasIp: getOptionalBoolean("enableAliasIp", true),
    floatingIpId: cfg.getNumber("floatingIpId"),
    enableIpv6,
    enableKubeSpan: getOptionalBoolean("enableKubeSpan", false),

    networkIpv4Cidr,
    nodeIpv4Cidr,
    podIpv4Cidr,
    serviceIpv4Cidr,
    podIpv6Cidr,
    serviceIpv6Cidr,

    talosVersion: cfg.require("talosVersion"),
    kubernetesVersion: cfg.require("kubernetesVersion"),
    sshPublicKey: getOptionalString("sshPublicKey"),
    controlPlaneNodes,
    controlPlaneAllowSchedule: getOptionalBoolean(
      "controlPlaneAllowSchedule",
      false,
    ),
    workerNodes,

    disableX86: getOptionalBoolean("disableX86", false),
    disableArm: getOptionalBoolean("disableArm", false),
    talosImageIdX86: getOptionalString("talosImageIdX86"),
    talosImageIdArm: getOptionalString("talosImageIdArm"),
    talosIsoIdX86: getOptionalString("talosIsoIdX86"),
    talosIsoIdArm: getOptionalString("talosIsoIdArm"),
    talosSchematicExtensions: parseJson<string[]>(
      "talosSchematicExtensions",
      [],
    ),
    talosSchematicExtraKernelArgs: parseJson<string[]>(
      "talosSchematicExtraKernelArgs",
      [],
    ),
    talosSchematicExtensionsControlPlane: parseJson<string[]>(
      "talosSchematicExtensionsControlPlane",
      [],
    ),
    talosSchematicExtraKernelArgsControlPlane: parseJson<string[]>(
      "talosSchematicExtraKernelArgsControlPlane",
      [],
    ),
    talosSchematicExtensionsWorker: parseJson<string[]>(
      "talosSchematicExtensionsWorker",
      [],
    ),
    talosSchematicExtraKernelArgsWorker: parseJson<string[]>(
      "talosSchematicExtraKernelArgsWorker",
      [],
    ),

    kubeletExtraArgs: parseJson<Record<string, string>>("kubeletExtraArgs", {}),
    kubeApiExtraArgs: parseJson<Record<string, string>>("kubeApiExtraArgs", {}),
    sysctlsExtraArgs: parseJson<Record<string, string>>("sysctlsExtraArgs", {}),
    kernelModulesToLoad: parseJson<ClusterConfig["kernelModulesToLoad"]>(
      "kernelModulesToLoad",
      [],
    ),
    talosControlPlaneExtraConfigPatches: parseJson<string[]>(
      "talosControlPlaneExtraConfigPatches",
      [],
    ),
    talosWorkerExtraConfigPatches: parseJson<string[]>(
      "talosWorkerExtraConfigPatches",
      [],
    ),
    registries: parseJson("registries", null),
    extraManifests: parseJson<string[] | undefined>(
      "extraManifests",
      undefined,
    ),
    disableTalosCoredns: getOptionalBoolean("disableTalosCoredns", false),

    deployCilium: getOptionalBoolean("deployCilium", true),
    ciliumVersion: cfg.get("ciliumVersion") ?? "1.16.2",
    ciliumValues: getOptionalString("ciliumValues"),
    ciliumEnableEncryption: getOptionalBoolean("ciliumEnableEncryption", false),
    ciliumEnableServiceMonitors: getOptionalBoolean(
      "ciliumEnableServiceMonitors",
      false,
    ),
    deployPrometheusOperatorCrds: getOptionalBoolean(
      "deployPrometheusOperatorCrds",
      false,
    ),
    prometheusOperatorCrdsVersion: getOptionalString(
      "prometheusOperatorCrdsVersion",
    ),
    deployHcloudCcm: getOptionalBoolean("deployHcloudCcm", true),
    hcloudCcmVersion: getOptionalString("hcloudCcmVersion"),
    workerAutoscaling,
  };
}
