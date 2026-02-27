/**
 * VPC, subnets, internet gateway, NAT, route tables and associations.
 */
import * as aws from "@pulumi/aws";

import { namePrefix } from "./config";

const vpc = new aws.ec2.Vpc("AuthentikVpc", {
  cidrBlock: "172.16.0.0/16",
  enableDnsHostnames: true,
  enableDnsSupport: true,
  tags: { Name: `${namePrefix}/AuthentikVpc` },
});

const azs = aws
  .getAvailabilityZones({ state: "available" })
  .then((z: aws.GetAvailabilityZonesResult) => z.names);
const publicSubnet1 = new aws.ec2.Subnet("PublicSubnet1", {
  vpcId: vpc.id,
  cidrBlock: "172.16.0.0/18",
  availabilityZone: azs.then((a: string[]) => a[0]),
  mapPublicIpOnLaunch: true,
  tags: {
    "aws-cdk:subnet-name": "Public",
    "aws-cdk:subnet-type": "Public",
    Name: `${namePrefix}/AuthentikVpc/PublicSubnet1`,
  },
});
const publicSubnet2 = new aws.ec2.Subnet("PublicSubnet2", {
  vpcId: vpc.id,
  cidrBlock: "172.16.64.0/18",
  availabilityZone: azs.then((a: string[]) => a[1]),
  mapPublicIpOnLaunch: true,
  tags: {
    "aws-cdk:subnet-name": "Public",
    "aws-cdk:subnet-type": "Public",
    Name: `${namePrefix}/AuthentikVpc/PublicSubnet2`,
  },
});
const privateSubnet1 = new aws.ec2.Subnet("PrivateSubnet1", {
  vpcId: vpc.id,
  cidrBlock: "172.16.128.0/18",
  availabilityZone: azs.then((a: string[]) => a[0]),
  mapPublicIpOnLaunch: false,
  tags: {
    "aws-cdk:subnet-name": "Private",
    "aws-cdk:subnet-type": "Private",
    Name: `${namePrefix}/AuthentikVpc/PrivateSubnet1`,
  },
});
const privateSubnet2 = new aws.ec2.Subnet("PrivateSubnet2", {
  vpcId: vpc.id,
  cidrBlock: "172.16.192.0/18",
  availabilityZone: azs.then((a: string[]) => a[1]),
  mapPublicIpOnLaunch: false,
  tags: {
    "aws-cdk:subnet-name": "Private",
    "aws-cdk:subnet-type": "Private",
    Name: `${namePrefix}/AuthentikVpc/PrivateSubnet2`,
  },
});

const igw = new aws.ec2.InternetGateway("IGW", {
  vpcId: vpc.id,
  tags: { Name: `${namePrefix}/AuthentikVpc` },
});

const publicRt1 = new aws.ec2.RouteTable("PublicSubnet1RouteTable", {
  vpcId: vpc.id,
  tags: { Name: `${namePrefix}/AuthentikVpc/PublicSubnet1` },
});
const publicRt2 = new aws.ec2.RouteTable("PublicSubnet2RouteTable", {
  vpcId: vpc.id,
  tags: { Name: `${namePrefix}/AuthentikVpc/PublicSubnet2` },
});
const privateRt1 = new aws.ec2.RouteTable("PrivateSubnet1RouteTable", {
  vpcId: vpc.id,
  tags: { Name: `${namePrefix}/AuthentikVpc/PrivateSubnet1` },
});
const privateRt2 = new aws.ec2.RouteTable("PrivateSubnet2RouteTable", {
  vpcId: vpc.id,
  tags: { Name: `${namePrefix}/AuthentikVpc/PrivateSubnet2` },
});

new aws.ec2.RouteTableAssociation("PublicSubnet1Rta", {
  subnetId: publicSubnet1.id,
  routeTableId: publicRt1.id,
});
new aws.ec2.RouteTableAssociation("PublicSubnet2Rta", {
  subnetId: publicSubnet2.id,
  routeTableId: publicRt2.id,
});
new aws.ec2.RouteTableAssociation("PrivateSubnet1Rta", {
  subnetId: privateSubnet1.id,
  routeTableId: privateRt1.id,
});
new aws.ec2.RouteTableAssociation("PrivateSubnet2Rta", {
  subnetId: privateSubnet2.id,
  routeTableId: privateRt2.id,
});

new aws.ec2.Route("PublicSubnet1DefaultRoute", {
  routeTableId: publicRt1.id,
  destinationCidrBlock: "0.0.0.0/0",
  gatewayId: igw.id,
});
new aws.ec2.Route("PublicSubnet2DefaultRoute", {
  routeTableId: publicRt2.id,
  destinationCidrBlock: "0.0.0.0/0",
  gatewayId: igw.id,
});

const natEip = new aws.ec2.Eip("NATEip", {
  domain: "vpc",
  tags: { Name: `${namePrefix}/AuthentikVpc/PublicSubnet1` },
});
const nat = new aws.ec2.NatGateway("NAT", {
  subnetId: publicSubnet1.id,
  allocationId: natEip.allocationId,
  tags: { Name: `${namePrefix}/AuthentikVpc/PublicSubnet1` },
});

new aws.ec2.Route("PrivateSubnet1DefaultRoute", {
  routeTableId: privateRt1.id,
  destinationCidrBlock: "0.0.0.0/0",
  natGatewayId: nat.id,
});
new aws.ec2.Route("PrivateSubnet2DefaultRoute", {
  routeTableId: privateRt2.id,
  destinationCidrBlock: "0.0.0.0/0",
  natGatewayId: nat.id,
});

export { vpc, publicSubnet1, publicSubnet2, privateSubnet1, privateSubnet2 };
