import * as hcloud from "@pulumi/hcloud";
import type { FirewallRule } from "@pulumi/hcloud/types/input";
import * as pulumi from "@pulumi/pulumi";
import type { ClusterConfig } from "./config";

export interface FirewallOutput {
  firewall: hcloud.Firewall | undefined;
  firewallId: pulumi.Output<string | undefined>;
}

const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const FETCH_TIMEOUT_MS = 10_000;

/** Fetch current public IPv4 (e.g. for firewall source). */
export async function getCurrentIpv4(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://ipv4.icanhazip.com", {
      signal: controller.signal,
    });
    const text = (await res.text()).trim();
    if (!res.ok || !IPV4_REGEX.test(text)) {
      throw new Error(`Invalid response: ${res.status} ${text.slice(0, 50)}`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function addTcpRule(
  rules: FirewallRule[],
  sourceIps: string[] | null,
  port: string,
  description: string,
): void {
  if (sourceIps && sourceIps.length > 0) {
    rules.push({
      direction: "in",
      protocol: "tcp",
      port,
      sourceIps,
      description,
    });
  }
}

export function createFirewall(
  config: ClusterConfig,
  useCurrentIp: boolean,
  currentIpv4: string,
): FirewallOutput {
  const rules: FirewallRule[] = [];
  const currentIpCidr = useCurrentIp ? [`${currentIpv4}/32`] : null;

  addTcpRule(
    rules,
    config.firewallKubeApiSource ?? currentIpCidr,
    "6443",
    "Allow Incoming Requests to Kube API Server",
  );
  addTcpRule(
    rules,
    config.firewallTalosApiSource ?? currentIpCidr,
    "50000",
    "Allow Incoming Requests to Talos API Server",
  );

  for (const r of config.extraFirewallRules) {
    rules.push({
      direction: r.direction as "in" | "out",
      protocol: r.protocol as "tcp" | "udp" | "icmp" | "esp" | "gre",
      port: r.port,
      sourceIps: r.sourceIps,
      destinationIps: r.destinationIps,
      description: r.description,
    });
  }

  if (config.firewallId != null) {
    return {
      firewall: undefined,
      firewallId: pulumi.output(config.firewallId),
    };
  }

  if (rules.length === 0) {
    return {
      firewall: undefined,
      firewallId: pulumi.output(undefined),
    };
  }

  const firewall = new hcloud.Firewall("cluster-firewall", {
    name: config.clusterName,
    rules,
    labels: { cluster: config.clusterName },
  });

  return {
    firewall,
    firewallId: firewall.id.apply(String),
  };
}
