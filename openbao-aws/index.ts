/**
 * OpenBao on AWS: ECS Fargate Spot, Aurora Serverless v2 (PostgreSQL), KMS auto-unseal, ALB.
 * TLS at ALB; no hardcoded credentials (Secrets Manager + IAM for KMS).
 */
import { alb } from "./ecs/alb";
import { auroraCluster, dbSecret } from "./data/database";
import { kmsKey } from "./ecs/iam";
import { rootTokenSecret } from "./init/lambda";

import "./ecs/services";

export const loadBalancerDnsName = alb.dnsName;
export const openbaoUrl = alb.dnsName.apply((d: string) => `https://${d}`);
export const auroraEndpoint = auroraCluster.endpoint;
export const kmsKeyId = kmsKey.keyId;
export const dbSecretArn = dbSecret.arn;
export const rootTokenSecretArn = rootTokenSecret.arn;
