/**
 * Authentik on AWS: ECS in core cluster, behind Traefik (core NLB). TLS and routing via Traefik.
 */
import * as pulumi from "@pulumi/pulumi";

import { authentikDomain } from "./config";
import { nlbDnsName } from "./core";
import { auroraCluster } from "./data/database";
import { dbSecret } from "./data/secrets";
import { storageBucket } from "./data/storage";

import "./ecs/services";
import "./route53/record";

export const loadBalancerDns = nlbDnsName;
export const loadBalancerUrl = pulumi.interpolate`https://${authentikDomain}`;
export const auroraEndpoint = auroraCluster.endpoint;
export const dbSecretArn = dbSecret.arn;
export const storageBucketName = storageBucket.id;
