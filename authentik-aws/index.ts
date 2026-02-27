/**
 * Authentik on AWS: Pulumi port of the CloudFormation template.
 * Database: Aurora Serverless v2 (PostgreSQL). Storage: S3.
 *
 * TLS: set certificateArn to use an existing ACM cert; otherwise a temporary
 * self-signed cert is generated and imported into ACM automatically.
 */
import { alb } from "./alb";
import { auroraCluster } from "./database";
import { dbSecret } from "./secrets";
import { storageBucket } from "./storage";

import "./services";

export const loadBalancerDns = alb.dnsName;
export const loadBalancerUrl = alb.dnsName.apply((d: string) => `https://${d}`);
export const auroraEndpoint = auroraCluster.endpoint;
export const dbSecretArn = dbSecret.arn;
export const storageBucketName = storageBucket.id;
