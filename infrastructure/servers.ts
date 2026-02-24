import * as hcloud from "@pulumi/hcloud";
import * as pulumi from "@pulumi/pulumi";
import type { ClusterConfig } from "./config";
import type { ControlPlaneSpec, WorkerSpec } from "./network";
import type { NetworkOutputs } from "./network";
import type { FirewallOutput } from "./firewall";
import type { PlacementOutputs } from "./placement";

export interface ServerOutputs {
  controlPlaneServers: hcloud.Server[];
  workerServers: hcloud.Server[];
}

function idToNumber(id: pulumi.Input<string | number>): pulumi.Output<number> {
  return pulumi.output(id).apply((v) => (typeof v === "number" ? v : parseInt(String(v), 10)));
}

export function createServers(
  config: ClusterConfig,
  net: NetworkOutputs,
  firewall: FirewallOutput,
  placement: PlacementOutputs,
  controlPlaneSpecs: ControlPlaneSpec[],
  workerSpecs: WorkerSpec[],
  controlPlaneUserData: pulumi.Output<string>[],
  workerUserData: pulumi.Output<string>[],
  sshKeyId: pulumi.Output<string>
): ServerOutputs {
  const firewallIds = firewall.firewallId.apply((id) => (id ? [parseInt(String(id), 10)] : []));

  const controlPlaneServers: hcloud.Server[] = [];
  for (let i = 0; i < controlPlaneSpecs.length; i++) {
    const spec = controlPlaneSpecs[i]!;
    const userData = controlPlaneUserData[i]!;
    const primaryIpv4 = net.primaryIpsCp[i]!;
    const server = new hcloud.Server(`control-plane-${i + 1}`, {
      name: spec.name,
      location: net.locationName,
      image: spec.imageId as string,
      iso: spec.isoId,
      serverType: spec.serverType,
      userData,
      sshKeys: [sshKeyId],
      placementGroupId: idToNumber(placement.controlPlaneGroup.id),
      firewallIds,
      labels: {
        cluster: config.clusterName,
        role: "control-plane",
        server_type: spec.serverType,
        ...spec.labels,
      },
      publicNets: [
        {
          ipv4Enabled: true,
          ipv4: idToNumber(primaryIpv4.id),
          ipv6Enabled: config.enableIpv6,
        },
      ],
      networks: [
        {
          networkId: idToNumber(net.network.id),
          ip: spec.ipv4Private,
          aliasIps: [],
        },
      ],
    }, {
      ignoreChanges: ["userData", "image", "iso"],
    });
    controlPlaneServers.push(server);
  }

  const workerServers: hcloud.Server[] = [];
  for (let i = 0; i < workerSpecs.length; i++) {
    const spec = workerSpecs[i]!;
    const userData = workerUserData[i]!;
    const primaryIpv4 = net.primaryIpsWorker[i]!;
    const server = new hcloud.Server(`worker-${i + 1}`, {
      name: spec.name,
      location: net.locationName,
      image: spec.imageId as string,
      iso: spec.isoId,
      serverType: spec.serverType,
      userData,
      sshKeys: [sshKeyId],
      placementGroupId: idToNumber(placement.workerGroup.id),
      firewallIds,
      labels: {
        cluster: config.clusterName,
        role: "worker",
        server_type: spec.serverType,
        ...spec.labels,
      },
      publicNets: [
        {
          ipv4Enabled: true,
          ipv4: idToNumber(primaryIpv4.id),
          ipv6Enabled: config.enableIpv6,
        },
      ],
      networks: [
        {
          networkId: idToNumber(net.network.id),
          ip: spec.ipv4Private,
          aliasIps: [],
        },
      ],
    }, {
      ignoreChanges: ["userData", "image", "iso"],
    });
    workerServers.push(server);
  }

  return { controlPlaneServers, workerServers };
}
