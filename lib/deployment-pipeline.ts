/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */
import { Construct } from "constructs";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";

export interface DeploymentPipelineProps {
  name: string;
  sourceEcrName: string;
  buildspecPath: string;
  signerProfileArn: string;
  ecsService: ecsPatterns.ApplicationLoadBalancedFargateService;
}

export class DeploymentPipeline extends Construct {
  constructor(scope: Construct, id: string, props: DeploymentPipelineProps) {
    super(scope, id);

    //Deployment CodePipeline
    const pipeline = new codepipeline.Pipeline(this, 'DeployPipeline', {
      crossAccountKeys: false,
      pipelineName: props.name
    });

    //Declare ECR repo and source stage
    const ecrRepo = ecr.Repository.fromRepositoryName(this, 'EcrRepo', props.sourceEcrName);
    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.EcrSourceAction({
      actionName: 'ECR',
      repository: ecrRepo,
      output: sourceOutput,
    });
    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    //Add manual approval step
    const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
      actionName: 'Approve',
    });
    pipeline.addStage({
     stageName: 'Approve',
     actions: [manualApprovalAction]
    });

    //Create CodeBuild w/ perms and build stage
    const build = new codebuild.PipelineProject(this, 'DeployBuild', {
      buildSpec: codebuild.BuildSpec.fromAsset(props.buildspecPath),
      environment: {
        privileged: true,
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5
      },
      environmentVariables: {
        REPOSITORY_URI: { value: ecrRepo.repositoryUri },
        SIGNER_PROFILE_ARN: { value: props.signerProfileArn },
      },
    });
    ecrRepo.grantPullPush(build);
    // kms.Key.fromLookup(this, 'KmsKey', {
    //   aliasName: 'alias/aws/s3'
    // }).grantDecrypt(build);
    build.addToRolePolicy(
      iam.PolicyStatement.fromJson({
        Effect: "Allow",
        Action: "signer:GetRevocationStatus",
        // Resource: props.signerProfileArn,
        Resource: "*",
      })
    );
    const buildOutput = new codepipeline.Artifact();
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'VerifyImage',
      project: build,
      input: sourceOutput,
      outputs: [buildOutput]
    });
    pipeline.addStage({
      stageName: 'VerifyImage',
      actions: [buildAction],
    });

    //Deploy to ECS
    const deployAction = new codepipeline_actions.EcsDeployAction({
      actionName: "Deploy",
      input: buildOutput,
      service: props.ecsService.service
    });
    pipeline.addStage({
      stageName: 'Deploy',
      actions: [deployAction],
    });
  }
}