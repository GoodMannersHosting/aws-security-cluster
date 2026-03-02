/**
 * Pulumi config and shared constants.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

export const vpcCidr = config.get("vpcCidr") ?? "10.0.0.0/16";
export const dbVersion = config.get("dbVersion") ?? "17.7";
export const openbaoImage = config.get("openbaoImage") ?? "openbao/openbao";
export const openbaoVersion = config.get("openbaoVersion") ?? "2.5";
export const openbaoCpu = config.getNumber("openbaoCpu") ?? 512;
export const openbaoMemory = config.getNumber("openbaoMemory") ?? 1024;
export const desiredCount = config.getNumber("desiredCount") ?? 2;
export const auroraMinAcu = config.getNumber("auroraMinAcu") ?? 0.5;
export const auroraMaxAcu = config.getNumber("auroraMaxAcu") ?? 2;
export const enableSpot = config.getBoolean("enableSpot") ?? true;
export const spotOnDemandBase = config.getNumber("spotOnDemandBase") ?? 1;
/** Domain for OpenBao (e.g. openbao.example.com). Point DNS to core stack NLB. */
export const openbaoDomain = config.require("openbaoDomain");
export const certificateArnConfig = config.get("certificateArn");
export const domainName = config.get("domainName");
/** Optional: restore Aurora from this snapshot ARN instead of creating new (disaster recovery). */
export const auroraSnapshotIdentifier = config.get("auroraSnapshotIdentifier");
/** When true, disables ECS container health checks so you can exec in and run bootstrap manually. */
export const disableHealthChecks = config.getBoolean("disableHealthChecks") ?? false;
export const allowedCidrs = config
  .get("allowedCidrs")
  ?.split(",")
  .map((s) => s.trim()) ?? [vpcCidr];

export const namePrefix = "OpenBaoStack";

export const regionName = pulumi.output(aws.getRegion()).apply((r) => r.name);
