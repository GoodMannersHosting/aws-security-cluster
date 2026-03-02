/**
 * TLS certificate: use existing ACM cert from config or create self-signed.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as tls from "@pulumi/tls";

import { certificateArnConfig, domainName } from ".";

let certificateArn: pulumi.Output<string>;
if (certificateArnConfig) {
  certificateArn = pulumi.output(certificateArnConfig);
} else {
  const certKey = new tls.PrivateKey("AuthentikSelfSignedKey", {
    algorithm: "ECDSA",
    ecdsaCurve: "P256",
  });
  const selfSignedCert = new tls.SelfSignedCert("AuthentikSelfSignedCert", {
    privateKeyPem: certKey.privateKeyPem,
    validityPeriodHours: 24 * 90,
    earlyRenewalHours: 24,
    allowedUses: ["key_encipherment", "digital_signature", "server_auth"],
    subject: { commonName: domainName ?? "authentik.internal" },
    dnsNames: domainName ? [domainName] : [],
  });
  const importedCert = new aws.acm.Certificate("AuthentikCert", {
    privateKey: certKey.privateKeyPem,
    certificateBody: selfSignedCert.certPem,
    tags: { Name: "AuthentikStack/AuthentikCert", Temporary: "true" },
  });
  certificateArn = importedCert.arn;
}

export { certificateArn };
