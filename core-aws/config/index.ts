/**
 * Pulumi config and shared constants for core-aws.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

export const vpcCidr = config.get("vpcCidr") ?? "172.16.0.0/20";
export const namePrefix = "CoreStack";

/** Route53 hosted zone ID for ACME DNS-01 challenge (e.g. Z0123456789ABC). */
export const hostedZoneId = config.require("hostedZoneId");
/** Base domain for ACME (e.g. example.com). Traefik will request certs for *.example.com and example.com. */
export const domain = config.get("domain");
/** Email for Let's Encrypt ACME registration. */
export const acmeEmail = config.require("acmeEmail");
/** ACME CA server. Use staging for testing: https://acme-staging-v02.api.letsencrypt.org/directory */
export const acmeCaServer = config.get("acmeCaServer");
/** Seconds to wait before checking DNS propagation for Route53 (helps with flaky issuance). Default 10. */
export const acmeDnsPropagationDelay = config.getNumber("acmeDnsPropagationDelay") ?? 10;

export const enableSpot = config.getBoolean("enableSpot") ?? true;
export const traefikCpu = config.getNumber("traefikCpu") ?? 256;
export const traefikMemory = config.getNumber("traefikMemory") ?? 512;
export const traefikDesiredCount = config.getNumber("traefikDesiredCount") ?? 2;

export const regionName = pulumi.output(aws.getRegion()).apply((r) => r.name);
