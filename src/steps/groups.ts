import {
  createIntegrationEntity,
  IntegrationStep,
  IntegrationStepExecutionContext,
  RelationshipClass,
  IntegrationMissingKeyError,
} from '@jupiterone/integration-sdk-core';

import { createAPIClient } from '../client';
import { IntegrationConfig, sanitizeConfig } from '../config';
import {
  convertGroupToEntity,
  convertWorkspaceGroupToRelationship,
  convertGroupUserToRelationship,
  convertUserGroupToRelationship,
} from '../sync/converters';
import {
  BITBUCKET_WORKSPACE_ENTITY_TYPE,
  BITBUCKET_USER_ENTITY_TYPE,
  BITBUCKET_GROUP_ENTITY_TYPE,
  BITBUCKET_GROUP_ENTITY_CLASS,
  BITBUCKET_WORKSPACE_GROUP_RELATIONSHIP_TYPE,
  BITBUCKET_GROUP_USER_RELATIONSHIP_TYPE,
  BITBUCKET_USER_GROUP_RELATIONSHIP_TYPE,
} from '../constants';
import {
  BitbucketWorkspaceEntity,
  BitbucketGroupEntity,
  IdEntityMap,
  BitbucketUserEntity,
} from '../types';

export async function fetchGroups(
  context: IntegrationStepExecutionContext<IntegrationConfig>,
) {
  const jobState = context.jobState;
  const apiClient = createAPIClient(
    sanitizeConfig(context.instance.config),
    context,
  );

  const userByIdMap = await jobState.getData<IdEntityMap<BitbucketUserEntity>>(
    'USER_BY_UUID_MAP',
  );

  if (!userByIdMap) {
    throw new IntegrationMissingKeyError(
      `Expected to find userByIdMap in jobState.`,
    );
  }

  await jobState.iterateEntities(
    {
      _type: BITBUCKET_WORKSPACE_ENTITY_TYPE,
    },
    async (workspaceEntity) => {
      if (workspaceEntity.slug) {
        const slug: string = <string>workspaceEntity.slug;
        await apiClient.iterateGroups(slug, async (group) => {
          const groupEntity = (await jobState.addEntity(
            createIntegrationEntity({
              entityData: {
                source: group,
                assign: convertGroupToEntity(group),
              },
            }),
          )) as BitbucketGroupEntity;
          const workspace: BitbucketWorkspaceEntity = <
            BitbucketWorkspaceEntity
          >workspaceEntity;
          await jobState.addRelationship(
            convertWorkspaceGroupToRelationship(workspace, groupEntity),
          );

          for (const user of group.members) {
            if (user.uuid) {
              if (userByIdMap[user.uuid]) {
                await jobState.addRelationship(
                  convertGroupUserToRelationship(
                    groupEntity,
                    userByIdMap[user.uuid],
                  ),
                );
              }
            }
          }

          const owner = group.owner;
          if (owner.uuid) {
            if (userByIdMap[owner.uuid]) {
              await jobState.addRelationship(
                convertUserGroupToRelationship(
                  userByIdMap[owner.uuid],
                  groupEntity,
                ),
              );
            }
          }
        });
      }
    },
  );
}

export const groupSteps: IntegrationStep<IntegrationConfig>[] = [
  {
    id: 'fetch-groups',
    name: 'Fetch Groups',
    entities: [
      {
        resourceName: 'Bitbucket Group',
        _type: BITBUCKET_GROUP_ENTITY_TYPE,
        _class: BITBUCKET_GROUP_ENTITY_CLASS,
      },
    ],
    relationships: [
      {
        _type: BITBUCKET_WORKSPACE_GROUP_RELATIONSHIP_TYPE,
        _class: RelationshipClass.HAS,
        sourceType: BITBUCKET_WORKSPACE_ENTITY_TYPE,
        targetType: BITBUCKET_GROUP_ENTITY_TYPE,
      },
      {
        _type: BITBUCKET_GROUP_USER_RELATIONSHIP_TYPE,
        _class: RelationshipClass.HAS,
        sourceType: BITBUCKET_GROUP_ENTITY_TYPE,
        targetType: BITBUCKET_USER_ENTITY_TYPE,
      },
      {
        _type: BITBUCKET_USER_GROUP_RELATIONSHIP_TYPE,
        _class: RelationshipClass.OWNS,
        sourceType: BITBUCKET_USER_ENTITY_TYPE,
        targetType: BITBUCKET_GROUP_ENTITY_TYPE,
      },
    ],
    dependsOn: ['fetch-users'],
    executionHandler: fetchGroups,
  },
];
