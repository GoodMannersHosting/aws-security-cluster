/**
 * Aurora Serverless v2 (PostgreSQL). Restore from snapshot if auroraSnapshotIdentifier is set.
 */
import * as aws from "@pulumi/aws";

import {
  auroraMaxAcu,
  auroraMinAcu,
  auroraSnapshotIdentifier,
  dbVersion,
} from "../config";
import { privateSubnetIds } from "../core";
import { dbPassword } from "./secrets";
import { databaseSg } from "../networking/security-groups";

const dbSubnetGroup = new aws.rds.SubnetGroup("AuthentikDBSubnetGroup", {
  name: "authentik-db-subnet-group",
  description: "Subnet group for AuthentikDB database",
  subnetIds: privateSubnetIds,
});

const auroraCluster = auroraSnapshotIdentifier
  ? new aws.rds.Cluster("AuthentikDB", {
      clusterIdentifier: "authentik-aurora",
      snapshotIdentifier: auroraSnapshotIdentifier,
      engine: aws.rds.EngineType.AuroraPostgresql,
      engineMode: aws.rds.EngineMode.Provisioned,
      dbSubnetGroupName: dbSubnetGroup.name,
      vpcSecurityGroupIds: [databaseSg.id],
      serverlessv2ScalingConfiguration: { minCapacity: auroraMinAcu, maxCapacity: auroraMaxAcu },
      storageEncrypted: true,
      skipFinalSnapshot: true,
    })
  : new aws.rds.Cluster("AuthentikDB", {
      clusterIdentifier: "authentik-aurora",
      engine: aws.rds.EngineType.AuroraPostgresql,
      engineMode: aws.rds.EngineMode.Provisioned,
      engineVersion: dbVersion,
      databaseName: "authentik",
      masterUsername: "authentik",
      masterPassword: dbPassword.result,
      dbSubnetGroupName: dbSubnetGroup.name,
      vpcSecurityGroupIds: [databaseSg.id],
      serverlessv2ScalingConfiguration: { minCapacity: auroraMinAcu, maxCapacity: auroraMaxAcu },
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
