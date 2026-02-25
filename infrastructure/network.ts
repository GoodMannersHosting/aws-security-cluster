import * as hcloud from "@pulumi/hcloud";
import * as pulumi from "@pulumi/pulumi";
import type { ClusterConfig } from "./config";
import { cidrHost } from "./locals";
import type { ControlPlaneSpec, WorkerSpec } from "./locals";

export type { ControlPlaneSpec, WorkerSpec };

const PRIVATE_VIP_HOST_OFFSET = 100;
const CONTROL_PLANE_PRIVATE_IP_BASE = 101;
const WORKER_PRIVATE_IP_BASE = 201;

export interface NetworkOutputs {
  network: hcloud.Network;
  subnet: hcloud.NetworkSubnet;
  locationName: string;
  controlPlanePublicIpv4List: pulumi.Output<string>[];
  controlPlanePrivateIpv4List: string[];
  controlPlanePrivateVipIpv4: string;
  workerPublicIpv4List: pulumi.Output<string>[];
  workerPrivateIpv4List: string[];
  controlPlanePublicIpv6List: pulumi.Output<string>[];
  workerPublicIpv6List: pulumi.Output<string>[];
  floatingIp: hcloud.FloatingIp | undefined;
  primaryIpsCp: hcloud.PrimaryIp[];
  primaryIpsWorker: hcloud.PrimaryIp[];
  primaryIpsCpV6: hcloud.PrimaryIp[];
  primaryIpsWorkerV6: hcloud.PrimaryIp[];
}

export function createNetwork(
  config: ClusterConfig,
  clusterPrefix: string,
  controlPlaneLocations: string[],
  workerLocations: string[],
): NetworkOutputs {
  const network = new hcloud.Network("cluster-network", {
    name: config.clusterName,
    ipRange: config.networkIpv4Cidr,
    labels: { cluster: config.clusterName },
  });

  const firstLocation = controlPlaneLocations[0] ?? config.locationName;
  const location = hcloud.getLocation({ name: firstLocation }).then((l) => l);
  const networkZone = pulumi.output(location).apply((l) => l.networkZone);

  const subnet = new hcloud.NetworkSubnet("nodes", {
    networkId: network.id.apply((id) =>
      typeof id === "number" ? id : parseInt(String(id), 10),
    ),
    type: "cloud",
    networkZone: networkZone,
    ipRange: config.nodeIpv4Cidr,
  });

  const controlPlaneCount = config.controlPlaneNodes.length;
  const workerCount = config.workerNodes.length;

  const controlPlanePrimaryIps: hcloud.PrimaryIp[] = [];
  for (let i = 0; i < controlPlaneCount; i++) {
    const loc = controlPlaneLocations[i] ?? config.locationName;
    const ip = new hcloud.PrimaryIp(`cp-ipv4-${i + 1}`, {
      name: `${clusterPrefix}control-plane-${i + 1}-ipv4`,
      location: loc,
      type: "ipv4",
      assigneeType: "server",
      autoDelete: false,
      labels: { cluster: config.clusterName, role: "control-plane" },
    });
    controlPlanePrimaryIps.push(ip);
  }

  const workerPrimaryIps: hcloud.PrimaryIp[] = [];
  for (let i = 0; i < workerCount; i++) {
    const loc = workerLocations[i] ?? config.locationName;
    const ip = new hcloud.PrimaryIp(`worker-ipv4-${i + 1}`, {
      name: `${clusterPrefix}worker-${i + 1}-ipv4`,
      location: loc,
      type: "ipv4",
      assigneeType: "server",
      autoDelete: false,
      labels: { cluster: config.clusterName, role: "worker" },
    });
    workerPrimaryIps.push(ip);
  }

  const controlPlanePublicIpv4List: pulumi.Output<string>[] =
    controlPlanePrimaryIps.map((ip) => ip.ipAddress);
  const workerPublicIpv4List: pulumi.Output<string>[] = workerPrimaryIps.map(
    (ip) => ip.ipAddress,
  );

  let controlPlanePrimaryIpsV6: hcloud.PrimaryIp[] = [];
  let workerPrimaryIpsV6: hcloud.PrimaryIp[] = [];
  if (config.enableIpv6) {
    for (let i = 0; i < controlPlaneCount; i++) {
      const loc = controlPlaneLocations[i] ?? config.locationName;
      const ip = new hcloud.PrimaryIp(`cp-ipv6-${i + 1}`, {
        name: `${clusterPrefix}control-plane-${i + 1}-ipv6`,
        location: loc,
        type: "ipv6",
        assigneeType: "server",
        autoDelete: false,
        labels: { cluster: config.clusterName, role: "control-plane" },
      });
      controlPlanePrimaryIpsV6.push(ip);
    }
    for (let i = 0; i < workerCount; i++) {
      const loc = workerLocations[i] ?? config.locationName;
      const ip = new hcloud.PrimaryIp(`worker-ipv6-${i + 1}`, {
        name: `${clusterPrefix}worker-${i + 1}-ipv6`,
        location: loc,
        type: "ipv6",
        assigneeType: "server",
        autoDelete: false,
        labels: { cluster: config.clusterName, role: "worker" },
      });
      workerPrimaryIpsV6.push(ip);
    }
  }
  const controlPlanePublicIpv6List: pulumi.Output<string>[] =
    controlPlanePrimaryIpsV6.map((ip) => ip.ipAddress);
  const workerPublicIpv6List: pulumi.Output<string>[] = workerPrimaryIpsV6.map(
    (ip) => ip.ipAddress,
  );

  const subnetIpRange = config.nodeIpv4Cidr;
  const controlPlanePrivateVipIpv4 = cidrHost(
    subnetIpRange,
    PRIVATE_VIP_HOST_OFFSET,
  );
  const controlPlanePrivateIpv4List: string[] = [];
  for (let i = 0; i < controlPlaneCount; i++) {
    controlPlanePrivateIpv4List.push(
      cidrHost(subnetIpRange, i + CONTROL_PLANE_PRIVATE_IP_BASE),
    );
  }
  const workerPrivateIpv4List: string[] = [];
  for (let i = 0; i < workerCount; i++) {
    workerPrivateIpv4List.push(
      cidrHost(subnetIpRange, i + WORKER_PRIVATE_IP_BASE),
    );
  }

  let floatingIp: hcloud.FloatingIp | undefined;
  const createFloatingIp =
    config.enableFloatingIp && config.floatingIpId == null;
  if (createFloatingIp) {
    const floatingIpLocation = controlPlaneLocations[0] ?? config.locationName;
    floatingIp = new hcloud.FloatingIp("control-plane-vip", {
      name: `${clusterPrefix}control-plane-ipv4`,
      type: "ipv4",
      homeLocation: floatingIpLocation,
      description: "Control Plane VIP",
      deleteProtection: false,
      labels: { cluster: config.clusterName, role: "control-plane" },
    });
  }

  return {
    network,
    subnet,
    locationName: firstLocation,
    controlPlanePublicIpv4List,
    controlPlanePrivateIpv4List,
    controlPlanePrivateVipIpv4,
    workerPublicIpv4List,
    workerPrivateIpv4List,
    controlPlanePublicIpv6List,
    workerPublicIpv6List,
    floatingIp,
    primaryIpsCp: controlPlanePrimaryIps,
    primaryIpsWorker: workerPrimaryIps,
    primaryIpsCpV6: controlPlanePrimaryIpsV6,
    primaryIpsWorkerV6: workerPrimaryIpsV6,
  };
}

function isArmServerType(serverType: string): boolean {
  return serverType.startsWith("cax");
}

export function buildControlPlaneSpecs(
  config: ClusterConfig,
  clusterPrefix: string,
  controlPlanePrivateIpv4List: string[],
  controlPlaneLocations: string[],
  armImageId: string | number | undefined,
  x86ImageId: string | number | undefined,
  armIsoId: string | undefined,
  x86IsoId: string | undefined,
): ControlPlaneSpec[] {
  const nodes = config.controlPlaneNodes;
  return nodes.map((node, i) => {
    const idx = i + 1;
    const privateIp = controlPlanePrivateIpv4List[i];
    if (!privateIp)
      throw new Error(`Missing private IP for control plane ${idx}`);
    const isArm = isArmServerType(node.type);
    const location = controlPlaneLocations[i] ?? config.locationName;
    return {
      index: i,
      name: `${clusterPrefix}control-plane-${idx}`,
      location,
      serverType: node.type,
      imageId: isArm ? (armImageId ?? 0) : (x86ImageId ?? 0),
      isoId: isArm ? armIsoId : x86IsoId,
      ipv4Public: "",
      ipv6Public: undefined,
      ipv6PublicSubnet: undefined,
      ipv4Private: privateIp,
      labels: node.labels ?? {},
      taints: (node.taints ?? []).map((t) => ({
        key: t.key,
        value: t.value,
        effect: t.effect,
      })),
    };
  });
}

export function buildWorkerSpecs(
  config: ClusterConfig,
  clusterPrefix: string,
  workerPrivateIpv4List: string[],
  workerLocations: string[],
  armImageId: string | number | undefined,
  x86ImageId: string | number | undefined,
  armIsoId: string | undefined,
  x86IsoId: string | undefined,
): WorkerSpec[] {
  const nodes = config.workerNodes;
  return nodes.map((node, i) => {
    const idx = i + 1;
    const privateIp = workerPrivateIpv4List[i];
    if (!privateIp) throw new Error(`Missing private IP for worker ${idx}`);
    const isArm = isArmServerType(node.type);
    const location = workerLocations[i] ?? config.locationName;
    return {
      index: i,
      name: `${clusterPrefix}worker-${idx}`,
      location,
      serverType: node.type,
      imageId: isArm ? (armImageId ?? 0) : (x86ImageId ?? 0),
      isoId: isArm ? armIsoId : x86IsoId,
      ipv4Public: "",
      ipv6Public: undefined,
      ipv6PublicSubnet: undefined,
      ipv4Private: privateIp,
      labels: node.labels ?? {},
      taints: (node.taints ?? []).map((t) => ({
        key: t.key,
        value: t.value,
        effect: t.effect,
      })),
    };
  });
}
