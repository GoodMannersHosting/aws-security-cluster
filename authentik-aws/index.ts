/**
 * Authentik on AWS: Pulumi port of the CloudFormation template.
 * Database: Aurora Serverless v2 (PostgreSQL) instead of RDS instance.
 *
 * HTTPS certificate: set either certificateArn (existing ACM cert) or domainName.
 * If domainName is set, an ACM certificate is created; set route53ZoneId to validate
 * automatically via Route53 DNS, or add the CNAME manually and re-run when validated.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const dbVersion = config.get("dbVersion") ?? "16.4";
const dbStorage = config.getNumber("dbStorage") ?? 10;
const authentikImage = config.get("authentikImage") ?? "ghcr.io/goauthentik/server";
const authentikVersion = config.get("authentikVersion") ?? "2026.2.0";
const authentikServerCpu = config.getNumber("authentikServerCpu") ?? 512;
const authentikServerMemory = config.getNumber("authentikServerMemory") ?? 1024;
const authentikServerDesiredCount = config.getNumber("authentikServerDesiredCount") ?? 2;
const authentikWorkerCpu = config.getNumber("authentikWorkerCpu") ?? 512;
const authentikWorkerMemory = config.getNumber("authentikWorkerMemory") ?? 1024;
const authentikWorkerDesiredCount = config.getNumber("authentikWorkerDesiredCount") ?? 2;
const certificateArnConfig = config.get("certificateArn");
const domainName = config.get("domainName");
const route53ZoneId = config.get("route53ZoneId");
if (!certificateArnConfig && !domainName) {
  throw new Error(
    "Set either 'certificateArn' (existing ACM cert) or 'domainName' (create ACM cert). " +
      "For domainName, set 'route53ZoneId' for automatic DNS validation.",
  );
}
const auroraMinAcu = config.getNumber("auroraMinAcu") ?? 0.5;
const auroraMaxAcu = config.getNumber("auroraMaxAcu") ?? 1;

// let certificateArn: pulumi.Output<string>;
// if (certificateArnConfig) {
//   certificateArn = pulumi.output(certificateArnConfig);
// } else {
//   const cert = new aws.acm.Certificate("AuthentikCert", {
//     domainName: domainName!,
//     validationMethod: "DNS",
//   });
//   if (route53ZoneId) {
//     const certValidationRecord = new aws.route53.Record("AuthentikCertValidation", {
//       zoneId: route53ZoneId,
//       name: cert.domainValidationOptions.apply((opts) => opts[0].resourceRecordName),
//       type: cert.domainValidationOptions.apply((opts) => opts[0].resourceRecordType),
//       records: cert.domainValidationOptions.apply((opts) => [opts[0].resourceRecordValue]),
//       ttl: 60,
//     });
//     new aws.acm.CertificateValidation("AuthentikCertValidation", {
//       certificateArn: cert.arn,
//       validationRecordFqdns: [certValidationRecord.fqdn],
//     });
//   }
//   certificateArn = cert.arn;
// }

const namePrefix = "AuthentikStack";

const vpc = new aws.ec2.Vpc("AuthentikVpc", {
  cidrBlock: "172.16.0.0/16",
  enableDnsHostnames: true,
  enableDnsSupport: true,
  tags: { Name: `${namePrefix}/AuthentikVpc` },
});

const azs = aws.getAvailabilityZones({ state: "available" }).then((z: aws.GetAvailabilityZonesResult) => z.names);
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

const databaseSg = new aws.ec2.SecurityGroup("DatabaseSG", {
  vpcId: vpc.id,
  description: "Security Group for authentik RDS PostgreSQL",
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});

const authentikSg = new aws.ec2.SecurityGroup("AuthentikSG", {
  vpcId: vpc.id,
  description: "Security Group for authentik services",
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});

const dbPassword = new random.RandomPassword("DBPassword", {
  length: 64,
  overrideSpecial: "!#$%&*()_+-=[]{}|;:,.<>?",
  special: true,
});
const dbSecret = new aws.secretsmanager.Secret("DBPassword", {});
const dbSecretVersion = new aws.secretsmanager.SecretVersion("DBPasswordVersion", {
  secretId: dbSecret.id,
  secretString: pulumi.interpolate`{"username":"authentik","password":${dbPassword.result}}`,
});

const authentikSecretKey = new random.RandomPassword("AuthentikSecretKey", {
  length: 64,
  overrideSpecial: "@/\"'\\",
  special: true,
});
const authentikSecretKeySecret = new aws.secretsmanager.Secret("AuthentikSecretKey", {});
const authentikSecretKeyVersion = new aws.secretsmanager.SecretVersion(
  "AuthentikSecretKeyVersion",
  {
    secretId: authentikSecretKeySecret.id,
    secretString: authentikSecretKey.result,
  },
);

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

new aws.ec2.SecurityGroupRule("DatabaseSGFromAuthentik", {
  type: "ingress",
  securityGroupId: databaseSg.id,
  sourceSecurityGroupId: authentikSg.id,
  fromPort: 5432,
  toPort: 5432,
  protocol: "tcp",
  description: "Allow authentik to connect to RDS PostgreSQL",
});

const efsDataSg = new aws.ec2.SecurityGroup("AuthentikDataEFSSecurityGroup", {
  vpcId: vpc.id,
  description: "Security group for authentik data EFS",
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});
const efsMediaSg = new aws.ec2.SecurityGroup("AuthentikMediaEFSSecurityGroup", {
  vpcId: vpc.id,
  description: "Security group for authentik media EFS",
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});

new aws.ec2.SecurityGroupRule("EFSDataFromAuthentik", {
  type: "ingress",
  securityGroupId: efsDataSg.id,
  sourceSecurityGroupId: authentikSg.id,
  fromPort: 2049,
  toPort: 2049,
  protocol: "tcp",
});
new aws.ec2.SecurityGroupRule("EFSMediaFromAuthentik", {
  type: "ingress",
  securityGroupId: efsMediaSg.id,
  sourceSecurityGroupId: authentikSg.id,
  fromPort: 2049,
  toPort: 2049,
  protocol: "tcp",
});

const efsData = new aws.efs.FileSystem("AuthentikDataEFS", {
  encrypted: true,
  performanceMode: "generalPurpose",
  throughputMode: "bursting",
  tags: { Name: `${namePrefix}/AuthentikDataEFS` },
});
const efsMedia = new aws.efs.FileSystem("AuthentikMediaEFS", {
  encrypted: true,
  performanceMode: "generalPurpose",
  throughputMode: "bursting",
  tags: { Name: `${namePrefix}/AuthentikMediaEFS` },
});

const efsDataMt1 = new aws.efs.MountTarget("AuthentikDataEFSMountTarget1", {
  fileSystemId: efsData.id,
  subnetId: privateSubnet1.id,
  securityGroups: [efsDataSg.id],
});
const efsDataMt2 = new aws.efs.MountTarget("AuthentikDataEFSMountTarget2", {
  fileSystemId: efsData.id,
  subnetId: privateSubnet2.id,
  securityGroups: [efsDataSg.id],
});
const efsMediaMt1 = new aws.efs.MountTarget("AuthentikMediaEFSMountTarget1", {
  fileSystemId: efsMedia.id,
  subnetId: privateSubnet1.id,
  securityGroups: [efsMediaSg.id],
});
const efsMediaMt2 = new aws.efs.MountTarget("AuthentikMediaEFSMountTarget2", {
  fileSystemId: efsMedia.id,
  subnetId: privateSubnet2.id,
  securityGroups: [efsMediaSg.id],
});

const efsDataAp = new aws.efs.AccessPoint("AuthentikDataAccessPoint", {
  fileSystemId: efsData.id,
  posixUser: { gid: 1000, uid: 1000 },
  rootDirectory: {
    path: "/data",
    creationInfo: { ownerGid: 1000, ownerUid: 1000, permissions: "755" },
  },
  tags: { Name: `${namePrefix}/AuthentikDataEFS/AuthentikDataAccessPoint` },
});
const efsMediaAp = new aws.efs.AccessPoint("AuthentikMediaAccessPoint", {
  fileSystemId: efsMedia.id,
  posixUser: { gid: 1000, uid: 1000 },
  rootDirectory: {
    path: "/media",
    creationInfo: { ownerGid: 1000, ownerUid: 1000, permissions: "755" },
  },
  tags: { Name: `${namePrefix}/AuthentikMediaEFS/AuthentikMediaAccessPoint` },
});

const ecsCluster = new aws.ecs.Cluster("AuthentikCluster", {});

const albSg = new aws.ec2.SecurityGroup("AuthentikALBSecurityGroup", {
  vpcId: vpc.id,
  description: "Security Group for ALB AuthentikStackAuthentikALB",
  ingress: [
    { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"], description: "Allow from anyone on port 80" },
    { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"], description: "Allow from anyone on port 443" },
  ],
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});

new aws.ec2.SecurityGroupRule("ALBToAuthentik", {
  type: "egress",
  securityGroupId: albSg.id,
  sourceSecurityGroupId: authentikSg.id,
  fromPort: 9000,
  toPort: 9000,
  protocol: "tcp",
  description: "Load balancer to target",
});
new aws.ec2.SecurityGroupRule("AuthentikFromALB", {
  type: "ingress",
  securityGroupId: authentikSg.id,
  sourceSecurityGroupId: albSg.id,
  fromPort: 9000,
  toPort: 9000,
  protocol: "tcp",
  description: "Load balancer to target",
});

const alb = new aws.lb.LoadBalancer("AuthentikALB", {
  loadBalancerType: "application",
  securityGroups: [albSg.id],
  subnets: [publicSubnet1.id, publicSubnet2.id],
  tags: { Name: `${namePrefix}/AuthentikALB` },
});

const serverTg = new aws.lb.TargetGroup("AuthentikServerTargetGroup", {
  name: "auth-server-tg",
  port: 9000,
  protocol: "HTTP",
  vpcId: vpc.id,
  targetType: "ip",
  healthCheck: {
    path: "/-/health/live/",
    matcher: "200",
    interval: 30,
    timeout: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
  },
  stickiness: { type: "lb_cookie", enabled: false },
});

const httpListener = new aws.lb.Listener("AuthentikHttpListener", {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: "HTTP",
  defaultActions: [{
    type: "redirect",
    redirect: { protocol: "HTTPS", port: "443", statusCode: "HTTP_301" },
  }],
});

const httpsListener = new aws.lb.Listener("AuthentikHttpsListener", {
  loadBalancerArn: alb.arn,
  port: 443,
  protocol: "HTTP",
  // certificateArn,
  defaultActions: [{ type: "forward", targetGroupArn: serverTg.arn }],
});

const serverLogGroup = new aws.cloudwatch.LogGroup("AuthentikServerLogGroup", {
  retentionInDays: 7,
});
const workerLogGroup = new aws.cloudwatch.LogGroup("AuthentikWorkerLogGroup", {
  retentionInDays: 7,
});

const serverExecutionRole = new aws.iam.Role("AuthentikServerExecutionRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
});
new aws.iam.RolePolicyAttachment("AuthentikServerExecutionRolePolicy", {
  role: serverExecutionRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy,
});
const serverExecutionPolicy = new aws.iam.RolePolicy("AuthentikServerExecutionPolicy", {
  role: serverExecutionRole.id,
  policy: pulumi
    .all([
      dbSecret.arn,
      authentikSecretKeySecret.arn,
      serverLogGroup.arn,
      efsData.arn,
      efsMedia.arn,
    ])
    .apply(([dbArn, keyArn, logArn, efsDataArn, efsMediaArn]: string[]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
            Resource: [dbArn, keyArn],
          },
          {
            Effect: "Allow",
            Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
            Resource: `${logArn}:*`,
          },
          {
            Effect: "Allow",
            Action: [
              "elasticfilesystem:ClientMount",
              "elasticfilesystem:ClientWrite",
              "elasticfilesystem:DescribeMountTargets",
              "elasticfilesystem:DescribeFileSystems",
            ],
            Resource: [efsDataArn, efsMediaArn],
          },
        ],
      }),
  ),
});

const serverTaskRole = new aws.iam.Role("AuthentikServerTaskRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
});
new aws.iam.RolePolicy("AuthentikServerTaskRolePolicy", {
  role: serverTaskRole.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ],
        Resource: "*",
      },
      { Effect: "Allow", Action: "logs:DescribeLogGroups", Resource: "*" },
      { Effect: "Allow", Action: ["logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"], Resource: "*" },
    ],
  }),
});

const regionName = pulumi.output(aws.getRegion()).apply((r) => r.name);
const serverTaskDef = new aws.ecs.TaskDefinition("AuthentikServerTask", {
  family: "AuthentikStackAuthentikServerTask",
  cpu: String(authentikServerCpu),
  memory: String(authentikServerMemory),
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: serverExecutionRole.arn,
  taskRoleArn: serverTaskRole.arn,
  containerDefinitions: pulumi
    .all([
      auroraCluster.endpoint,
      dbSecret.arn,
      authentikSecretKeySecret.arn,
      serverLogGroup.name,
      efsData.id,
      efsMedia.id,
      efsDataAp.id,
      efsMediaAp.id,
      regionName,
    ])
    .apply(
      ([dbEndpoint, dbArn, keyArn, logGroup, _efsDataId, _efsMediaId, _dataApId, _mediaApId, reg]: string[]) =>
        JSON.stringify([
          {
            name: "AuthentikServerContainer",
            image: `${authentikImage}:${authentikVersion}`,
            command: ["server"],
            essential: true,
            portMappings: [{ containerPort: 9000, protocol: "tcp" }],
            environment: [
              { name: "AUTHENTIK_POSTGRESQL__HOST", value: dbEndpoint },
              { name: "AUTHENTIK_POSTGRESQL__USER", value: "authentik" },
            ],
            secrets: [
              { name: "AUTHENTIK_POSTGRESQL__PASSWORD", valueFrom: `${dbArn}:password::` },
              { name: "AUTHENTIK_SECRET_KEY", valueFrom: keyArn },
            ],
            mountPoints: [
              { sourceVolume: "data", containerPath: "/data", readOnly: false },
              { sourceVolume: "media", containerPath: "/data/media", readOnly: false },
            ],
            logConfiguration: {
              logDriver: "awslogs",
              options: {
                "awslogs-group": logGroup,
                "awslogs-stream-prefix": "authentik-server",
                "awslogs-region": reg,
              },
            },
            healthCheck: {
              command: ["CMD", "ak", "healthcheck"],
              interval: 30,
              timeout: 30,
              retries: 3,
              startPeriod: 60,
            },
          },
        ]),
    ),
  volumes: [
    {
      name: "data",
      efsVolumeConfiguration: {
        fileSystemId: efsData.id,
        transitEncryption: "ENABLED",
        authorizationConfig: { accessPointId: efsDataAp.id, iam: "ENABLED" },
      },
    },
    {
      name: "media",
      efsVolumeConfiguration: {
        fileSystemId: efsMedia.id,
        transitEncryption: "ENABLED",
        authorizationConfig: { accessPointId: efsMediaAp.id, iam: "ENABLED" },
      },
    },
  ],
});

const workerExecutionRole = new aws.iam.Role("AuthentikWorkerExecutionRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
});
new aws.iam.RolePolicyAttachment("AuthentikWorkerExecutionRolePolicy", {
  role: workerExecutionRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy,
});
const workerExecutionPolicy = new aws.iam.RolePolicy("AuthentikWorkerExecutionPolicy", {
  role: workerExecutionRole.id,
  policy: pulumi
    .all([
      dbSecret.arn,
      authentikSecretKeySecret.arn,
      workerLogGroup.arn,
      efsData.arn,
      efsMedia.arn,
    ])
    .apply(([dbArn, keyArn, logArn, efsDataArn, efsMediaArn]: string[]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
            Resource: [dbArn, keyArn],
          },
          {
            Effect: "Allow",
            Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
            Resource: `${logArn}:*`,
          },
          {
            Effect: "Allow",
            Action: [
              "elasticfilesystem:ClientMount",
              "elasticfilesystem:ClientWrite",
              "elasticfilesystem:DescribeMountTargets",
              "elasticfilesystem:DescribeFileSystems",
            ],
            Resource: [efsDataArn, efsMediaArn],
          },
        ],
      }),
  ),
});

const workerTaskRole = new aws.iam.Role("AuthentikWorkerTaskRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
});
new aws.iam.RolePolicy("AuthentikWorkerTaskRolePolicy", {
  role: workerTaskRole.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ],
        Resource: "*",
      },
      { Effect: "Allow", Action: "logs:DescribeLogGroups", Resource: "*" },
      { Effect: "Allow", Action: ["logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"], Resource: "*" },
    ],
  }),
});

const workerTaskDef = new aws.ecs.TaskDefinition("AuthentikWorkerTask", {
  family: "AuthentikStackAuthentikWorkerTask",
  cpu: String(authentikWorkerCpu),
  memory: String(authentikWorkerMemory),
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: workerExecutionRole.arn,
  taskRoleArn: workerTaskRole.arn,
  containerDefinitions: pulumi
    .all([
      auroraCluster.endpoint,
      dbSecret.arn,
      authentikSecretKeySecret.arn,
      workerLogGroup.name,
      efsData.id,
      efsMedia.id,
      efsDataAp.id,
      efsMediaAp.id,
      regionName,
    ])
    .apply(
      ([dbEndpoint, dbArn, keyArn, logGroup, _efsDataId, _efsMediaId, _dataApId, _mediaApId, reg]: string[]) =>
        JSON.stringify([
          {
            name: "AuthentikWorkerContainer",
            image: `${authentikImage}:${authentikVersion}`,
            command: ["worker"],
            essential: true,
            environment: [
              { name: "AUTHENTIK_POSTGRESQL__HOST", value: dbEndpoint },
              { name: "AUTHENTIK_POSTGRESQL__USER", value: "authentik" },
            ],
            secrets: [
              { name: "AUTHENTIK_POSTGRESQL__PASSWORD", valueFrom: `${dbArn}:password::` },
              { name: "AUTHENTIK_SECRET_KEY", valueFrom: keyArn },
            ],
            mountPoints: [
              { sourceVolume: "data", containerPath: "/data", readOnly: false },
              { sourceVolume: "media", containerPath: "/data/media", readOnly: false },
            ],
            logConfiguration: {
              logDriver: "awslogs",
              options: {
                "awslogs-group": logGroup,
                "awslogs-stream-prefix": "authentik-worker",
                "awslogs-region": reg,
              },
            },
            healthCheck: {
              command: ["CMD", "ak", "healthcheck"],
              interval: 30,
              timeout: 30,
              retries: 3,
              startPeriod: 60,
            },
          },
        ]),
    ),
  volumes: [
    {
      name: "data",
      efsVolumeConfiguration: {
        fileSystemId: efsData.id,
        transitEncryption: "ENABLED",
        authorizationConfig: { accessPointId: efsDataAp.id, iam: "ENABLED" },
      },
    },
    {
      name: "media",
      efsVolumeConfiguration: {
        fileSystemId: efsMedia.id,
        transitEncryption: "ENABLED",
        authorizationConfig: { accessPointId: efsMediaAp.id, iam: "ENABLED" },
      },
    },
  ],
});

const serverService = new aws.ecs.Service("AuthentikServerService", {
  cluster: ecsCluster.arn,
  taskDefinition: serverTaskDef.arn,
  desiredCount: authentikServerDesiredCount,
  launchType: "FARGATE",
  enableExecuteCommand: true,
  healthCheckGracePeriodSeconds: 60,
  networkConfiguration: {
    subnets: [privateSubnet1.id, privateSubnet2.id],
    securityGroups: [authentikSg.id],
    assignPublicIp: false,
  },
  loadBalancers: [
    {
      targetGroupArn: serverTg.arn,
      containerName: "AuthentikServerContainer",
      containerPort: 9000,
    },
  ],
  deploymentCircuitBreaker: { enable: false, rollback: false },
  deploymentMaximumPercent: 200,
  deploymentMinimumHealthyPercent: 50,
}, { dependsOn: [httpsListener, serverTaskDef] });

const workerService = new aws.ecs.Service("AuthentikWorkerService", {
  cluster: ecsCluster.arn,
  taskDefinition: workerTaskDef.arn,
  desiredCount: authentikWorkerDesiredCount,
  launchType: "FARGATE",
  enableExecuteCommand: true,
  networkConfiguration: {
    subnets: [privateSubnet1.id, privateSubnet2.id],
    securityGroups: [authentikSg.id],
    assignPublicIp: false,
  },
  deploymentCircuitBreaker: { enable: false, rollback: false },
  deploymentMaximumPercent: 200,
  deploymentMinimumHealthyPercent: 50,
}, { dependsOn: [workerTaskDef] });

export const loadBalancerDns = alb.dnsName;
export const loadBalancerUrl = alb.dnsName.apply((d: string) => `https://${d}`);
export const auroraEndpoint = auroraCluster.endpoint;
export const dbSecretArn = dbSecret.arn;
