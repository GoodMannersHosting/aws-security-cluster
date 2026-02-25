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
  return pulumi
    .output(id)
    .apply((v) => (typeof v === "number" ? v : parseInt(String(v), 10)));
}

type ServerSpec = ControlPlaneSpec | WorkerSpec;

function createServer(
  resourceName: string,
  spec: ServerSpec,
  userData: pulumi.Output<string>,
  primaryIpv4: hcloud.PrimaryIp,
  primaryIpv6: hcloud.PrimaryIp | undefined,
  placementGroupId: pulumi.Output<number>,
  role: "control-plane" | "worker",
  config: ClusterConfig,
  net: NetworkOutputs,
  firewallIds: pulumi.Output<number[]>,
  sshKeyId: pulumi.Output<string>,
): hcloud.Server {
  const publicNet: {
    ipv4Enabled: boolean;
    ipv4: pulumi.Output<number>;
    ipv6Enabled?: boolean;
    ipv6?: pulumi.Output<number>;
  } = {
    ipv4Enabled: true,
    ipv4: idToNumber(primaryIpv4.id),
  };
  if (primaryIpv6) {
    publicNet.ipv6 = idToNumber(primaryIpv6.id);
  } else if (config.enableIpv6) {
    publicNet.ipv6Enabled = true;
  }
  return new hcloud.Server(
    resourceName,
    {
      name: spec.name,
      location: spec.location,
      image: spec.imageId as string,
      iso: spec.isoId,
      serverType: spec.serverType,
      userData,
      sshKeys: [sshKeyId],
      placementGroupId,
      firewallIds,
      labels: {
        cluster: config.clusterName,
        role,
        server_type: spec.serverType,
        ...spec.labels,
      },
      publicNets: [publicNet],
      networks: [
        {
          networkId: idToNumber(net.network.id),
          ip: spec.ipv4Private,
          aliasIps: [],
        },
      ],
    },
    { ignoreChanges: ["userData", "image", "iso"] },
  );
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
  sshKeyId: pulumi.Output<string>,
): ServerOutputs {
  const firewallIds = firewall.firewallId.apply((id) =>
    id ? [parseInt(String(id), 10)] : [],
  );
  const cpPlacementId = idToNumber(placement.controlPlaneGroup.id);
  const workerPlacementId = idToNumber(placement.workerGroup.id);

  const controlPlaneServers = controlPlaneSpecs.map((spec, i) =>
    createServer(
      `control-plane-${i + 1}`,
      spec,
      controlPlaneUserData[i]!,
      net.primaryIpsCp[i]!,
      net.primaryIpsCpV6[i],
      cpPlacementId,
      "control-plane",
      config,
      net,
      firewallIds,
      sshKeyId,
    ),
  );

  const workerServers = workerSpecs.map((spec, i) =>
    createServer(
      `worker-${i + 1}`,
      spec,
      workerUserData[i]!,
      net.primaryIpsWorker[i]!,
      net.primaryIpsWorkerV6[i],
      workerPlacementId,
      "worker",
      config,
      net,
      firewallIds,
      sshKeyId,
    ),
  );

  return { controlPlaneServers, workerServers };
}
