/**
 * VPC and subnets from core-aws stack reference.
 */
import * as pulumi from "@pulumi/pulumi";

import { vpcId, privateSubnetIds } from "../core";

export const vpc = { id: vpcId };
export const privateSubnet1 = { id: pulumi.output(privateSubnetIds).apply((ids) => ids[0]!) };
export const privateSubnet2 = { id: pulumi.output(privateSubnetIds).apply((ids) => ids[1]!) };
