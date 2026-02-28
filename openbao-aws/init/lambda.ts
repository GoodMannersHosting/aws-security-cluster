/**
 * One-time OpenBao init: Lambda runs on a schedule, checks if uninitialized, calls init API, stores root token.
 */
import * as path from "path";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import { namePrefix } from "../config";
import { alb } from "../ecs/alb";
import { privateSubnet1, privateSubnet2, vpc } from "../networking/vpc";

const stackName = pulumi.getStack();

const lambdaSg = new aws.ec2.SecurityGroup("OpenBaoInitLambdaSG", {
  vpcId: vpc.id,
  description: "OpenBao init Lambda",
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});

const rootTokenSecret = new aws.secretsmanager.Secret("OpenBaoRootToken", {
  name: `openbao-root-token-${stackName}`,
  description: "OpenBao root token (set by init Lambda)",
  tags: { Name: `${namePrefix}/RootToken` },
});

const lambdaRole = new aws.iam.Role("OpenBaoInitLambdaRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
});
new aws.iam.RolePolicyAttachment("OpenBaoInitLambdaBasic", {
  role: lambdaRole.name,
  policyArn: aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole,
});
new aws.iam.RolePolicy("OpenBaoInitLambdaSecrets", {
  role: lambdaRole.id,
  policy: rootTokenSecret.arn.apply(
    (arn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["secretsmanager:PutSecretValue", "secretsmanager:DescribeSecret"],
            Resource: arn,
          },
        ],
      })
  ),
});

const lambda = new aws.lambda.Function("OpenBaoInitLambda", {
  runtime: aws.lambda.Runtime.NodeJS24dX,
  handler: "index.handler",
  role: lambdaRole.arn,
  timeout: 60,
  memorySize: 128,
  code: new pulumi.asset.FileArchive(path.join(__dirname, "lambda-code")),
  environment: {
    variables: {
      OPENBAO_URL: pulumi.interpolate`https://${alb.dnsName}`,
      ROOT_TOKEN_SECRET_ARN: rootTokenSecret.arn,
    },
  },
  vpcConfig: {
    subnetIds: [privateSubnet1.id, privateSubnet2.id],
    securityGroupIds: [lambdaSg.id],
  },
  tags: { Name: `${namePrefix}/InitLambda` },
});

new aws.lambda.Permission("OpenBaoInitLambdaEvents", {
  action: "lambda:InvokeFunction",
  function: lambda.name,
  principal: "events.amazonaws.com",
});

const scheduleRule = new aws.cloudwatch.EventRule("OpenBaoInitSchedule", {
  scheduleExpression: "rate(5 minutes)",
  description: "Trigger OpenBao init Lambda until initialized",
});
new aws.cloudwatch.EventTarget("OpenBaoInitTarget", {
  rule: scheduleRule.name,
  arn: lambda.arn,
});

export { rootTokenSecret, lambda };
