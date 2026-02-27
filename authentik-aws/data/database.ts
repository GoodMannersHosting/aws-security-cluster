/**
 * Aurora Serverless v2 (PostgreSQL) cluster and instance.
 */
import * as aws from "@pulumi/aws";

import { auroraMaxAcu, auroraMinAcu, dbVersion } from "../config";
import { databaseSg } from "../networking/security-groups";
import { dbPassword } from "./secrets";
import { privateSubnet1, privateSubnet2 } from "../networking/vpc";

const dbSubnetGroup = new aws.rds.SubnetGroup("AuthentikDBSubnetGroup", {
  name: "authentik-db-subnet-group",
  description: "Subnet group for AuthentikDB database",
  subnetIds: [privateSubnet1.id, privateSubnet2.id],
});

const auroraCluster = new aws.rds.Cluster("AuthentikDB", {
  clusterIdentifier: "authentik-aurora",
  engine: aws.rds.EngineType.AuroraPostgresql,
  engineMode: aws.rds.EngineMode.Provisioned,
  engineVersion: dbVersion,
  databaseName: "authentik",
  masterUsername: "authentik",
  masterPassword: dbPassword.result,
  dbSubnetGroupName: dbSubnetGroup.name,
  vpcSecurityGroupIds: [databaseSg.id],
  serverlessv2ScalingConfiguration: {
    minCapacity: auroraMinAcu,
    maxCapacity: auroraMaxAcu,
  },
  storageEncrypted: true,
  skipFinalSnapshot: true,
});

const auroraInstance = new aws.rds.ClusterInstance("AuthentikDBInstance", {
  clusterIdentifier: auroraCluster.id,
  instanceClass: "db.serverless",
  engine: aws.rds.EngineType.AuroraPostgresql,
  engineVersion: auroraCluster.engineVersion,
});

export { auroraCluster };
