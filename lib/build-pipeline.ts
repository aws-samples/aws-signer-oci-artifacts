/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */
import { Construct } from "constructs";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline"
import * as codecommit from "aws-cdk-lib/aws-codecommit"
import * as codebuild from "aws-cdk-lib/aws-codebuild"
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as iam from "aws-cdk-lib/aws-iam"
import * as kms from "aws-cdk-lib/aws-kms"
import { RemovalPolicy } from "aws-cdk-lib";

export interface BuildPipelineProps {
  name: string;
  buildspecPath: string;
  signerProfileArn: string;
  ecrRepoName: string;
  codeDirectory?: string;
}

export class BuildPipeline extends Construct {
  
  //Expose ECR repo
  public readonly ecrRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props: BuildPipelineProps) {
    super(scope, id);

    //Create build CodePipeline
    const pipeline = new codepipeline.Pipeline(this, 'BuildPipeline', {
      crossAccountKeys: false,
      pipelineName: props.name
    });

    //Create CodeCommit repo and source stage
    const codecommitRepo = new codecommit.Repository(this, 'CodecommitRepo', {
      repositoryName: 'SignerAppRepo',
      code: props.codeDirectory !== undefined ? 
        codecommit.Code.fromDirectory(props.codeDirectory, 'master') : undefined,
    });
    const sourceOutput = new codepipeline.Artifact('SourceArtifact');
    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: 'CodeCommit',
      repository: codecommitRepo,
      output: sourceOutput
    });
    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    //Create ECR repo
    const ecrRepo = new ecr.Repository(this, 'EcrRepo', {
      repositoryName: props.ecrRepoName,
      removalPolicy: RemovalPolicy.DESTROY
    });
    this.ecrRepo = ecrRepo;

    //Create codebuild w/ perms and build stage
    const build = new codebuild.PipelineProject(this, 'Dockerbuild', {
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
    ecrRepo.grant(build, 'ecr:BatchDeleteImage',)
    build.addToRolePolicy(
      iam.PolicyStatement.fromJson({
        Effect: "Allow",
        Action: "signer:SignPayload",
        Resource: props.signerProfileArn,
      })
    )
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'BuildDockerfile',
      project: build,
      input: sourceOutput
    });
    pipeline.addStage({
      stageName: 'Build',
      actions: [buildAction],
    });
  }
}