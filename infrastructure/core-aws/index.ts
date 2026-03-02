/**
 * Core AWS: VPC, ECS cluster, Traefik (ACME + Route53), NLB.
 * Application stacks reference this stack for cluster, VPC, and Traefik SG.
 */
import * as pulumi from "@pulumi/pulumi";

import "./efs/traefik-data";
import "./ecs/traefik-service";
import "./route53/traefik-dashboard";

import { hostedZoneId } from "./config";
import { ecsCluster } from "./ecs/cluster";
import { nlb } from "./ecs/nlb";
import { traefikSg } from "./networking/security-groups";
import { vpc, privateSubnet1, privateSubnet2, publicSubnet1, publicSubnet2 } from "./networking/vpc";

export const clusterArn = ecsCluster.arn;
export const clusterName = ecsCluster.name;
export const vpcId = vpc.id;
export const privateSubnetIds = pulumi.output([privateSubnet1.id, privateSubnet2.id]);
export const publicSubnetIds = pulumi.output([publicSubnet1.id, publicSubnet2.id]);
export const traefikSecurityGroupId = traefikSg.id;
export const nlbDnsName = nlb.dnsName;
export const nlbZoneId = nlb.zoneId;
export { hostedZoneId };
