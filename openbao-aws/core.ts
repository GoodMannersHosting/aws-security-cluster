/**
 * Stack reference to core-aws. With self-managed backend (S3), org must be "organization".
 */
import * as pulumi from "@pulumi/pulumi";

const stackName = pulumi.getStack();
const coreStack = `organization/core-aws/${stackName}`;

const core = new pulumi.StackReference(coreStack);

export const clusterArn = core.getOutput("clusterArn");
export const vpcId = core.getOutput("vpcId").apply((id) => id as string);
export const privateSubnetIds = core.getOutput("privateSubnetIds").apply((ids) => ids as string[]);
export const traefikSecurityGroupId = core.getOutput("traefikSecurityGroupId").apply((id) => id as string);
export const nlbDnsName = core.getOutput("nlbDnsName").apply((d) => d as string);
export const nlbZoneId = core.getOutput("nlbZoneId").apply((z) => z as string);
export const hostedZoneId = core.getOutput("hostedZoneId").apply((z) => z as string);
