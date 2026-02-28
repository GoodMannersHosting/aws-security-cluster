/**
 * VPC, subnets, internet gateway, NAT, route tables, flow logs.
 */
import * as aws from "@pulumi/aws";

import { namePrefix, vpcCidr } from "../config";

function subnetCidrsFromVpcCidr(cidr: string): [string, string, string, string] {
  const parts = cidr.split("/")[0]!.split(".");
  if (parts.length < 2) return ["10.0.0.0/18", "10.0.64.0/18", "10.0.128.0/18", "10.0.192.0/18"];
  const a = parts[0]!;
  const b = parts[1]!;
  return [`${a}.${b}.0.0/18`, `${a}.${b}.64.0/18`, `${a}.${b}.128.0/18`, `${a}.${b}.192.0/18`];
}

const [pub1Cidr, pub2Cidr, priv1Cidr, priv2Cidr] = subnetCidrsFromVpcCidr(vpcCidr);

const vpc = new aws.ec2.Vpc("OpenBaoVpc", {
  cidrBlock: vpcCidr,
  enableDnsHostnames: true,
  enableDnsSupport: true,
  tags: { Name: `${namePrefix}/OpenBaoVpc` },
});

const azs = aws.getAvailabilityZones({ state: "available" }).then((z) => z.names);

const publicSubnet1 = new aws.ec2.Subnet("PublicSubnet1", {
  vpcId: vpc.id,
  cidrBlock: pub1Cidr,
  availabilityZone: azs.then((a) => a[0]),
  mapPublicIpOnLaunch: true,
  tags: { Name: `${namePrefix}/PublicSubnet1` },
});
const publicSubnet2 = new aws.ec2.Subnet("PublicSubnet2", {
  vpcId: vpc.id,
  cidrBlock: pub2Cidr,
  availabilityZone: azs.then((a) => a[1]),
  mapPublicIpOnLaunch: true,
  tags: { Name: `${namePrefix}/PublicSubnet2` },
});
const privateSubnet1 = new aws.ec2.Subnet("PrivateSubnet1", {
  vpcId: vpc.id,
  cidrBlock: priv1Cidr,
  availabilityZone: azs.then((a) => a[0]),
  mapPublicIpOnLaunch: false,
  tags: { Name: `${namePrefix}/PrivateSubnet1` },
});
const privateSubnet2 = new aws.ec2.Subnet("PrivateSubnet2", {
  vpcId: vpc.id,
  cidrBlock: priv2Cidr,
  availabilityZone: azs.then((a) => a[1]),
  mapPublicIpOnLaunch: false,
  tags: { Name: `${namePrefix}/PrivateSubnet2` },
});

const igw = new aws.ec2.InternetGateway("IGW", {
  vpcId: vpc.id,
  tags: { Name: `${namePrefix}/IGW` },
});

const publicRt1 = new aws.ec2.RouteTable("PublicRt1", { vpcId: vpc.id, tags: { Name: `${namePrefix}/PublicRt1` } });
const publicRt2 = new aws.ec2.RouteTable("PublicRt2", { vpcId: vpc.id, tags: { Name: `${namePrefix}/PublicRt2` } });
const privateRt1 = new aws.ec2.RouteTable("PrivateRt1", { vpcId: vpc.id, tags: { Name: `${namePrefix}/PrivateRt1` } });
const privateRt2 = new aws.ec2.RouteTable("PrivateRt2", { vpcId: vpc.id, tags: { Name: `${namePrefix}/PrivateRt2` } });

new aws.ec2.RouteTableAssociation("PublicRta1", { subnetId: publicSubnet1.id, routeTableId: publicRt1.id });
new aws.ec2.RouteTableAssociation("PublicRta2", { subnetId: publicSubnet2.id, routeTableId: publicRt2.id });
new aws.ec2.RouteTableAssociation("PrivateRta1", { subnetId: privateSubnet1.id, routeTableId: privateRt1.id });
new aws.ec2.RouteTableAssociation("PrivateRta2", { subnetId: privateSubnet2.id, routeTableId: privateRt2.id });

new aws.ec2.Route("PublicDefault1", { routeTableId: publicRt1.id, destinationCidrBlock: "0.0.0.0/0", gatewayId: igw.id });
new aws.ec2.Route("PublicDefault2", { routeTableId: publicRt2.id, destinationCidrBlock: "0.0.0.0/0", gatewayId: igw.id });

const natEip = new aws.ec2.Eip("NATEip", { domain: "vpc", tags: { Name: `${namePrefix}/NAT` } });
const nat = new aws.ec2.NatGateway("NAT", {
  subnetId: publicSubnet1.id,
  allocationId: natEip.allocationId,
  tags: { Name: `${namePrefix}/NAT` },
});
new aws.ec2.Route("PrivateDefault1", { routeTableId: privateRt1.id, destinationCidrBlock: "0.0.0.0/0", natGatewayId: nat.id });
new aws.ec2.Route("PrivateDefault2", { routeTableId: privateRt2.id, destinationCidrBlock: "0.0.0.0/0", natGatewayId: nat.id });

const flowLogRole = new aws.iam.Role("FlowLogRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "vpc-flow-logs.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
});
new aws.iam.RolePolicyAttachment("FlowLogPolicy", {
  role: flowLogRole.name,
  policyArn: "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess",
});
const flowLogGroup = new aws.cloudwatch.LogGroup("VpcFlowLogs", { retentionInDays: 7 });
new aws.ec2.FlowLog("VpcFlowLog", {
  vpcId: vpc.id,
  trafficType: "ALL",
  logDestinationType: "cloud-watch-logs",
  logDestination: flowLogGroup.arn,
  iamRoleArn: flowLogRole.arn,
  tags: { Name: `${namePrefix}/VpcFlowLog` },
});

export { vpc, publicSubnet1, publicSubnet2, privateSubnet1, privateSubnet2, natEip };
