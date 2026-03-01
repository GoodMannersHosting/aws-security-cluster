/**
 * Aurora Serverless v2 (PostgreSQL). Restore from snapshot if auroraSnapshotIdentifier is set.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import {
  auroraMaxAcu,
  auroraMinAcu,
  auroraSnapshotIdentifier,
  dbVersion,
  namePrefix,
} from "../config";
import { privateSubnetIds } from "../core";
import { dbPassword, dbSecret } from "./secrets";
import { databaseSg } from "../networking/security-groups";

const dbSubnetGroup = new aws.rds.SubnetGroup("OpenBaoDBSubnetGroup", {
  name: "openbao-db-subnet-group",
  description: "OpenBao Aurora PostgreSQL",
  subnetIds: privateSubnetIds,
});

const auroraCluster = auroraSnapshotIdentifier
  ? new aws.rds.Cluster("OpenBaoDB", {
      clusterIdentifier: "openbao-aurora",
      snapshotIdentifier: auroraSnapshotIdentifier,
      engine: aws.rds.EngineType.AuroraPostgresql,
      engineMode: aws.rds.EngineMode.Provisioned,
      dbSubnetGroupName: dbSubnetGroup.name,
      vpcSecurityGroupIds: [databaseSg.id],
      serverlessv2ScalingConfiguration: { minCapacity: auroraMinAcu, maxCapacity: auroraMaxAcu },
      storageEncrypted: true,
      skipFinalSnapshot: true,
      tags: { Name: `${namePrefix}/OpenBaoDB` },
    })
  : new aws.rds.Cluster("OpenBaoDB", {
      clusterIdentifier: "openbao-aurora",
      engine: aws.rds.EngineType.AuroraPostgresql,
      engineMode: aws.rds.EngineMode.Provisioned,
      engineVersion: dbVersion,
      databaseName: "openbao",
      masterUsername: "openbao",
      masterPassword: dbPassword.result,
      dbSubnetGroupName: dbSubnetGroup.name,
      vpcSecurityGroupIds: [databaseSg.id],
      serverlessv2ScalingConfiguration: { minCapacity: auroraMinAcu, maxCapacity: auroraMaxAcu },
      storageEncrypted: true,
      skipFinalSnapshot: true,
      tags: { Name: `${namePrefix}/OpenBaoDB` },
    });

new aws.rds.ClusterInstance("OpenBaoDBInstance", {
  clusterIdentifier: auroraCluster.id,
  instanceClass: "db.serverless",
  engine: aws.rds.EngineType.AuroraPostgresql,
  engineVersion: auroraCluster.engineVersion,
  tags: { Name: `${namePrefix}/OpenBaoDBInstance` },
});

// When not restoring, set the connection URL in Secrets Manager. When restoring, user must update the secret with the new endpoint.
if (!auroraSnapshotIdentifier) {
  const connectionUrl = pulumi.all([auroraCluster.endpoint, dbPassword.result]).apply(([endpoint, pass]) => {
    const encoded = encodeURIComponent(pass);
    return `postgres://openbao:${encoded}@${endpoint}:5432/openbao?sslmode=require`;
  });
  new aws.secretsmanager.SecretVersion("OpenBaoDBSecretVersion", {
    secretId: dbSecret.id,
    secretString: connectionUrl,
  });
}

export { auroraCluster, dbSecret };
