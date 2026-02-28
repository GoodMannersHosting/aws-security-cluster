/**
 * Aurora Serverless v2 (PostgreSQL) cluster and instance; DB connection secret.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import { auroraMaxAcu, auroraMinAcu, dbVersion, namePrefix } from "../config";
import { databaseSg } from "../networking/security-groups";
import { dbPassword, dbSecret } from "./secrets";
import { privateSubnet1, privateSubnet2 } from "../networking/vpc";

const dbSubnetGroup = new aws.rds.SubnetGroup("OpenBaoDBSubnetGroup", {
  name: "openbao-db-subnet-group",
  description: "OpenBao Aurora PostgreSQL",
  subnetIds: [privateSubnet1.id, privateSubnet2.id],
});

const auroraCluster = new aws.rds.Cluster("OpenBaoDB", {
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

const connectionUrl = pulumi.all([auroraCluster.endpoint, dbPassword.result]).apply(([endpoint, pass]) => {
  const encoded = encodeURIComponent(pass);
  return `postgres://openbao:${encoded}@${endpoint}:5432/openbao?sslmode=require`;
});

new aws.secretsmanager.SecretVersion("OpenBaoDBSecretVersion", {
  secretId: dbSecret.id,
  secretString: connectionUrl,
});

export { auroraCluster, dbSecret };
