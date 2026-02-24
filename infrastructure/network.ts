import * as hcloud from "@pulumi/hcloud";
import * as pulumi from "@pulumi/pulumi";
import type { ClusterConfig } from "./config";
import { cidrHost } from "./locals";
import type { ControlPlaneSpec, WorkerSpec } from "./locals";

export type { ControlPlaneSpec, WorkerSpec };

export interface NetworkOutputs {
  network: hcloud.Network;
  subnet: hcloud.NetworkSubnet;
  locationName: string;
  controlPlanePublicIpv4List: pulumi.Output<string>[];
  controlPlanePrivateIpv4List: string[];
  controlPlanePrivateVipIpv4: string;
  workerPublicIpv4List: pulumi.Output<string>[];
  workerPrivateIpv4List: string[];
  floatingIp: hcloud.FloatingIp | undefined;
  primaryIpsCp: hcloud.PrimaryIp[];
  primaryIpsWorker: hcloud.PrimaryIp[];
}

export function createNetwork(
  config: ClusterConfig,
  locationName: string,
  clusterPrefix: string
): NetworkOutputs {
  const network = new hcloud.Network("cluster-network", {
    name: config.clusterName,
    ipRange: config.networkIpv4Cidr,
    labels: { cluster: config.clusterName },
  });

  const location = hcloud.getLocation({ name: locationName }).then((l) => l);
  const networkZone = pulumi.output(location).apply((l) => l.networkZone);

  const subnet = new hcloud.NetworkSubnet("nodes", {
    networkId: network.id.apply((id) => (typeof id === "number" ? id : parseInt(String(id), 10))),
    type: "cloud",
    networkZone: networkZone,
    ipRange: config.nodeIpv4Cidr,
  });

  const controlPlaneCount = config.controlPlaneNodes.length;
  const workerCount = config.workerNodes.length;

  const controlPlanePrimaryIps = [];
  for (let i = 0; i < controlPlaneCount; i++) {
    const ip = new hcloud.PrimaryIp(`cp-ipv4-${i + 1}`, {
      name: `${clusterPrefix}control-plane-${i + 1}-ipv4`,
      location: locationName,
      type: "ipv4",
      assigneeType: "server",
      autoDelete: false,
      labels: { cluster: config.clusterName, role: "control-plane" },
    });
    controlPlanePrimaryIps.push(ip);
  }

  const workerPrimaryIps = [];
  for (let i = 0; i < workerCount; i++) {
    const ip = new hcloud.PrimaryIp(`worker-ipv4-${i + 1}`, {
      name: `${clusterPrefix}worker-${i + 1}-ipv4`,
      location: locationName,
      type: "ipv4",
      assigneeType: "server",
      autoDelete: false,
      labels: { cluster: config.clusterName, role: "worker" },
    });
    workerPrimaryIps.push(ip);
  }

  const controlPlanePublicIpv4List: pulumi.Output<string>[] = controlPlanePrimaryIps.map((ip) => ip.ipAddress);
  const workerPublicIpv4List: pulumi.Output<string>[] = workerPrimaryIps.map((ip) => ip.ipAddress);

  const subnetIpRange = config.nodeIpv4Cidr;
  const controlPlanePrivateVipIpv4 = cidrHost(subnetIpRange, 100);
  const controlPlanePrivateIpv4List = [];
  for (let i = 0; i < controlPlaneCount; i++) {
    controlPlanePrivateIpv4List.push(cidrHost(subnetIpRange, i + 101));
  }
  const workerPrivateIpv4List = [];
  for (let i = 0; i < workerCount; i++) {
    workerPrivateIpv4List.push(cidrHost(subnetIpRange, i + 201));
  }

  let floatingIp: hcloud.FloatingIp | undefined;
  const createFloatingIp = config.enableFloatingIp && config.floatingIpId == null;
  if (createFloatingIp) {
    floatingIp = new hcloud.FloatingIp("control-plane-vip", {
      name: `${clusterPrefix}control-plane-ipv4`,
      type: "ipv4",
      homeLocation: locationName,
      description: "Control Plane VIP",
      deleteProtection: false,
      labels: { cluster: config.clusterName, role: "control-plane" },
    });
  }

  return {
    network,
    subnet,
    locationName,
    controlPlanePublicIpv4List,
    controlPlanePrivateIpv4List,
    controlPlanePrivateVipIpv4,
    workerPublicIpv4List,
    workerPrivateIpv4List,
    floatingIp,
    primaryIpsCp: controlPlanePrimaryIps,
    primaryIpsWorker: workerPrimaryIps,
  };
}

export function buildControlPlaneSpecs(
  config: ClusterConfig,
  clusterPrefix: string,
  controlPlanePrivateIpv4List: string[],
  armImageId: string | number | undefined,
  x86ImageId: string | number | undefined,
  armIsoId: string | undefined,
  x86IsoId: string | undefined
): ControlPlaneSpec[] {
  const controlPlaneNodesById: Record<number, (typeof config.controlPlaneNodes)[0]> = {};
  for (const n of config.controlPlaneNodes) {
    controlPlaneNodesById[n.id] = n;
  }
  const specs: ControlPlaneSpec[] = [];
  for (let i = 1; i <= config.controlPlaneNodes.length; i++) {
    const node = controlPlaneNodesById[i]!;
    const isArm = node.type.startsWith("cax");
    specs.push({
      index: i - 1,
      name: `${clusterPrefix}control-plane-${i}`,
      serverType: node.type,
      imageId: isArm ? (armImageId ?? 0) : (x86ImageId ?? 0),
      isoId: isArm ? armIsoId : x86IsoId,
      ipv4Public: "",
      ipv6Public: undefined,
      ipv6PublicSubnet: undefined,
      ipv4Private: controlPlanePrivateIpv4List[i - 1]!,
      labels: node.labels ?? {},
      taints: (node.taints ?? []).map((t) => ({ key: t.key, value: t.value, effect: t.effect })),
    });
  }
  return specs;
}

export function buildWorkerSpecs(
  config: ClusterConfig,
  clusterPrefix: string,
  workerPrivateIpv4List: string[],
  armImageId: string | number | undefined,
  x86ImageId: string | number | undefined,
  armIsoId: string | undefined,
  x86IsoId: string | undefined
): WorkerSpec[] {
  const workerNodesById: Record<number, (typeof config.workerNodes)[0]> = {};
  for (const n of config.workerNodes) {
    workerNodesById[n.id] = n;
  }
  const specs: WorkerSpec[] = [];
  for (let i = 1; i <= config.workerNodes.length; i++) {
    const node = workerNodesById[i]!;
    const isArm = node.type.startsWith("cax");
    specs.push({
      index: i - 1,
      name: `${clusterPrefix}worker-${i}`,
      serverType: node.type,
      imageId: isArm ? (armImageId ?? 0) : (x86ImageId ?? 0),
      isoId: isArm ? armIsoId : x86IsoId,
      ipv4Public: "",
      ipv6Public: undefined,
      ipv6PublicSubnet: undefined,
      ipv4Private: workerPrivateIpv4List[i - 1]!,
      labels: node.labels ?? {},
      taints: (node.taints ?? []).map((t) => ({ key: t.key, value: t.value, effect: t.effect })),
    });
  }
  return specs;
}
