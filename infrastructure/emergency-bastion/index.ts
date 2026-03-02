/**
 * Emergency bastion: EC2 in core VPC public subnet with SSH access and ingress to OpenBao RDS.
 * Uses the same stack name as core-aws and openbao-aws (e.g. prod).
 * Uploads the local SSH public key from ~/.ssh/id_ed25519.pub.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const stackName = pulumi.getStack();
const org = "organization";

const coreRef = new pulumi.StackReference(`${org}/core-aws/${stackName}`);
const openbaoRef = new pulumi.StackReference(`${org}/openbao-aws/${stackName}`);

const vpcId = coreRef.getOutput("vpcId").apply((id) => id as string);
const publicSubnetIds = coreRef.getOutput("publicSubnetIds").apply((ids) => ids as string[]);
const databaseSgId = openbaoRef
  .getOutput("databaseSecurityGroupId")
  .apply((id) => {
    if (id === undefined || id === null || id === "") {
      throw new Error(
        "openbao-aws must export databaseSecurityGroupId. Run 'pulumi up' in the openbao-aws stack first, then retry here."
      );
    }
    return id as string;
  });

const pubKeyPath = path.join(process.env.HOME ?? os.homedir(), ".ssh", "id_ed25519.pub");
if (!fs.existsSync(pubKeyPath)) {
  throw new Error(`SSH public key not found at ${pubKeyPath}. Create one with: ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""`);
}
const publicKey = fs.readFileSync(pubKeyPath, "utf8").trim();

const keyPair = new aws.ec2.KeyPair("BastionKey", {
  keyName: `emergency-bastion-${stackName}`,
  publicKey,
  tags: { Name: `emergency-bastion-${stackName}` },
});

const bastionSg = new aws.ec2.SecurityGroup("BastionSG", {
  vpcId,
  description: "Emergency bastion SSH",
  ingress: [
    { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"], description: "SSH" },
  ],
  egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
  tags: { Name: `emergency-bastion-${stackName}` },
});

new aws.ec2.SecurityGroupRule("RdsFromBastion", {
  type: "ingress",
  securityGroupId: databaseSgId,
  sourceSecurityGroupId: bastionSg.id,
  fromPort: 5432,
  toPort: 5432,
  protocol: "tcp",
  description: "PostgreSQL from emergency bastion",
});

const ami = aws.ec2.getAmi({
  mostRecent: true,
  owners: ["amazon"],
  filters: [
    { name: "name", values: ["al2023-ami-*-x86_64"] },
    { name: "state", values: ["available"] },
  ],
});

const subnetId = publicSubnetIds.apply((ids) => ids[0]!);

const bastion = new aws.ec2.Instance("Bastion", {
  ami: ami.then((a) => a.id),
  instanceType: "t3.micro",
  keyName: keyPair.keyName,
  vpcSecurityGroupIds: [bastionSg.id],
  subnetId,
  associatePublicIpAddress: true,
  tags: { Name: `emergency-bastion-${stackName}` },
});

export const bastionPublicIp = bastion.publicIp;
export const bastionId = bastion.id;
export const sshCommand = bastionPublicIp.apply(
  (ip) => `ssh -i ~/.ssh/id_ed25519 ec2-user@${ip}`
);
