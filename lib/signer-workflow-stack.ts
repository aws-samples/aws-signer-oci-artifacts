/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as signer from 'aws-cdk-lib/aws-signer'
import { BuildPipeline } from './build-pipeline';
import { DeploymentPipeline } from './deployment-pipeline';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';


export class SignerWorkflowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // const signingProfile = new signer.SigningProfile(this, 'SigningProfile', {
    //   platform: signer.Platform.,
    // });

    //Create an AWS Signer profile
    //The aws-signer L2 construct does not currently support notation platform ID, so the L1 construct is used instead
    const signatureValidityPeriodProperty: signer.CfnSigningProfile.SignatureValidityPeriodProperty = {
      type: 'DAYS',
      value: 7,
    };
    const signingProfile = new signer.CfnSigningProfile(this, 'SigningProfile', {
      platformId: 'Notation-OCI-SHA384-ECDSA',
      signatureValidityPeriod: signatureValidityPeriodProperty
    })
    signingProfile.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY)

    //Create a build pipeline to build and sign the image
    const buildPipeline = new BuildPipeline(this, 'BuildPipeline', {
      name: 'DevelopmentPipeline',
      buildspecPath: 'build.yml',
      signerProfileArn: signingProfile.attrArn,
      ecrRepoName: 'signer-workflow-ecr',
      codeDirectory: './app/'
    });

    //Create an ECS cluster to run the image
    const ecsRole = new iam.Role(this, "EcsRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")],
    });
    const loadBalancedFargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      memoryLimitMiB: 1024,
      desiredCount: 2,
      cpu: 512,
      loadBalancerName: 'signer-app-lb',
      publicLoadBalancer: true,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry("public.ecr.aws/docker/library/httpd:latest"),
        command:["/bin/sh -c \"httpd-foreground\""],
        containerName: "signer-fargate-container",
        entryPoint: ["/bin/sh", "-c"],
        executionRole: ecsRole,
      }
    });
    
    //Create a deployment pipeline to verify and deploy the image
    const deployPipeline = new DeploymentPipeline(this, 'DeploymentPipeline', {
      name: 'ProductionPipeline',
      sourceEcrName: buildPipeline.ecrRepo.repositoryName,
      buildspecPath: 'verify.yml',
      signerProfileArn: signingProfile.attrArn,
      ecsService: loadBalancedFargateService,
    });
    deployPipeline.node.addDependency(loadBalancedFargateService);

  }
}
