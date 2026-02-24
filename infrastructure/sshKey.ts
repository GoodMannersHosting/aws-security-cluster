import * as hcloud from "@pulumi/hcloud";
import * as pulumi from "@pulumi/pulumi";
import * as tls from "@pulumi/tls";
import type { ClusterConfig } from "./config";

export function createSshKey(config: ClusterConfig, clusterPrefix: string): hcloud.SshKey {
  let publicKey: pulumi.Output<string>;
  if (config.sshPublicKey) {
    publicKey = pulumi.output(config.sshPublicKey);
  } else {
    const key = new tls.PrivateKey("ssh-key", {
      algorithm: "ED25519",
    });
    publicKey = key.publicKeyOpenssh;
  }
  return new hcloud.SshKey("default", {
    name: `${clusterPrefix}default`,
    publicKey,
    labels: { cluster: config.clusterName },
  });
}
