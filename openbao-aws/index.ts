/**
 * OpenBao on AWS: ECS in core cluster, behind Traefik (core NLB). TLS and routing via Traefik.
 */
import * as pulumi from "@pulumi/pulumi";

import { openbaoDomain } from "./config";
import { nlbDnsName } from "./core";
import { auroraCluster, dbSecret } from "./data/database";
import { kmsKey } from "./ecs/iam";
import { rootTokenSecret } from "./init/lambda";

import "./ecs/services";
import "./route53/record";

export const openbaoUrl = pulumi.interpolate`https://${openbaoDomain}`;
export const nlbDnsNameForDns = nlbDnsName;
export const auroraEndpoint = auroraCluster.endpoint;
export const kmsKeyId = kmsKey.keyId;
export const dbSecretArn = dbSecret.arn;
export const rootTokenSecretArn = rootTokenSecret.arn;
