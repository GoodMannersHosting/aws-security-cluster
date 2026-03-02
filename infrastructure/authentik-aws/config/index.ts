/**
 * Pulumi config and shared constants.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

export const dbVersion = config.get("dbVersion") ?? "16.4";
export const authentikImage =
  config.get("authentikImage") ?? "ghcr.io/goauthentik/server";
export const authentikVersion = config.get("authentikVersion") ?? "2026.2.0";
export const authentikServerCpu = config.getNumber("authentikServerCpu") ?? 512;
export const authentikServerMemory =
  config.getNumber("authentikServerMemory") ?? 1024;
export const authentikServerDesiredCount =
  config.getNumber("authentikServerDesiredCount") ?? 2;
export const authentikWorkerCpu = config.getNumber("authentikWorkerCpu") ?? 512;
export const authentikWorkerMemory =
  config.getNumber("authentikWorkerMemory") ?? 1024;
export const authentikWorkerDesiredCount =
  config.getNumber("authentikWorkerDesiredCount") ?? 2;
/** Domain for Authentik (e.g. auth.example.com). Point DNS to core stack NLB. */
export const authentikDomain = config.require("authentikDomain");
export const certificateArnConfig = config.get("certificateArn");
export const domainName = config.get("domainName");
/** Optional: restore Aurora from this snapshot ARN instead of creating new (disaster recovery). */
export const auroraSnapshotIdentifier = config.get("auroraSnapshotIdentifier");
export const auroraMinAcu = config.getNumber("auroraMinAcu") ?? 0.5;
export const auroraMaxAcu = config.getNumber("auroraMaxAcu") ?? 1;
export const enableSpot = config.getBoolean("enableSpot") ?? true;
export const spotServerOnDemandBase =
  config.getNumber("spotServerOnDemandBase") ?? 1;

export const namePrefix = "AuthentikStack";

export const regionName = pulumi.output(aws.getRegion()).apply((r) => r.name);
