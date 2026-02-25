import * as hcloud from "@pulumi/hcloud";
import * as pulumi from "@pulumi/pulumi";
import * as talos from "@pulumiverse/talos";
import { getConfig } from "./config";
import { getCurrentIpv4, createFirewall } from "./firewall";
import { resolveTalosImages } from "./images";
import {
  createNetwork,
  buildControlPlaneSpecs,
  buildWorkerSpecs,
  type NetworkOutputs,
} from "./network";
import { createPlacementGroups } from "./placement";
import { createServers } from "./servers";
import { createSshKey } from "./sshKey";
import { createTalosConfigs } from "./talos";

const API_PORT_K8S = 6443;

async function main() {
  const config = getConfig();
  const clusterPrefix = config.clusterPrefix ? `${config.clusterName}-` : "";
  const controlPlaneLocations = config.controlPlaneNodes.map(
    (n) => n.location ?? config.locationName,
  );
  const workerLocations = config.workerNodes.map(
    (n) => n.location ?? config.locationName,
  );

  const currentIpv4 =
    config.firewallId == null && config.firewallUseCurrentIp
      ? await getCurrentIpv4()
      : "";

  const firewall = createFirewall(
    config,
    config.firewallUseCurrentIp && config.firewallId == null,
    currentIpv4,
  );

  const net = createNetwork(
    config,
    clusterPrefix,
    controlPlaneLocations,
    workerLocations,
  );
  const placement = createPlacementGroups(config, clusterPrefix);
  const sshKey = createSshKey(config, clusterPrefix);

  const resolvedImages = await resolveTalosImages(config);
  const controlPlaneSpecs = buildControlPlaneSpecs(
    config,
    clusterPrefix,
    net.controlPlanePrivateIpv4List,
    controlPlaneLocations,
    resolvedImages.armImageId,
    resolvedImages.x86ImageId,
    resolvedImages.armIsoId,
    resolvedImages.x86IsoId,
  );
  const workerSpecs = buildWorkerSpecs(
    config,
    clusterPrefix,
    net.workerPrivateIpv4List,
    workerLocations,
    resolvedImages.armImageId,
    resolvedImages.x86ImageId,
    resolvedImages.armIsoId,
    resolvedImages.x86IsoId,
  );

  const talosOutputs = createTalosConfigs(
    config,
    net,
    controlPlaneSpecs,
    workerSpecs,
  );

  const servers = createServers(
    config,
    net,
    firewall,
    placement,
    controlPlaneSpecs,
    workerSpecs,
    talosOutputs.controlPlaneMachineConfigs,
    talosOutputs.workerMachineConfigs,
    sshKey.id,
  );

  const firstControlPlaneServer = servers.controlPlaneServers[0];
  if (net.floatingIp && firstControlPlaneServer) {
    new hcloud.FloatingIpAssignment(
      "floating-ip-assignment",
      {
        floatingIpId: net.floatingIp.id.apply((id) =>
          typeof id === "number" ? id : parseInt(String(id), 10),
        ),
        serverId: firstControlPlaneServer.id.apply((id) =>
          typeof id === "number" ? id : parseInt(String(id), 10),
        ),
      },
      { dependsOn: [firstControlPlaneServer] },
    );
  }

  const firstCpPublicIp = net.controlPlanePublicIpv4List[0];
  const bootstrap = new talos.machine.Bootstrap(
    "bootstrap",
    {
      clientConfiguration: talosOutputs.secrets.clientConfiguration,
      endpoint: firstCpPublicIp,
      node: firstCpPublicIp,
    },
    { dependsOn: servers.controlPlaneServers },
  );

  const kubeconfigResult = talos.cluster.getKubeconfigOutput(
    {
      clientConfiguration: talosOutputs.secrets.clientConfiguration,
      node: firstCpPublicIp,
    },
    { dependsOn: [bootstrap] },
  );

  const kubeconfigHost = pulumi
    .all([
      config.kubeconfigEndpointMode,
      net.controlPlanePrivateVipIpv4,
      net.controlPlanePublicIpv4List[0],
      config.clusterApiHost,
      config.clusterApiHostPrivate,
    ])
    .apply(([mode, bestPrivate, bestPublic, apiHost, apiHostPrivate]) => {
      if (mode === "private_ip") return bestPrivate;
      if (mode === "public_ip") return bestPublic;
      if (mode === "public_endpoint") return apiHost ?? bestPublic;
      if (mode === "private_endpoint") return apiHostPrivate ?? bestPrivate;
      return bestPublic;
    });

  const kubeconfig = pulumi
    .all([kubeconfigResult, kubeconfigHost])
    .apply(([kc, host]) => {
      const clusterEndpointUrlInternal = `https://${talosOutputs.clusterEndpointInternal}:${API_PORT_K8S}`;
      const replaceWith = `https://${host}:${API_PORT_K8S}`;
      return (kc.kubeconfigRaw ?? "").replace(
        clusterEndpointUrlInternal,
        replaceWith,
      );
    });

  const talosconfig = talosOutputs.talosClientConfigResult.apply(
    (c) => c.talosConfig ?? "",
  );

  return {
    talosconfig,
    kubeconfig,
    publicIpv4List: pulumi.all(net.controlPlanePublicIpv4List),
    hetznerNetworkId: net.network.id,
    firewallId: firewall.firewallId,
    talosWorkerIds: pulumi
      .output(servers.workerServers)
      .apply((list) => Object.fromEntries(list.map((s, i) => [`${i}`, s.id]))),
  };
}

export = main();
