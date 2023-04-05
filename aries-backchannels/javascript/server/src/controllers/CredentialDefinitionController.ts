import { Controller, Get, PathParams, Post, BodyParams } from '@tsed/common'
import { InternalServerError, NotFound } from '@tsed/exceptions'
import { BaseController } from '../BaseController'
import { TestHarnessConfig } from '../TestHarnessConfig'
import { AnonCredsApi, AnonCredsCredentialDefinition, AnonCredsCredentialDefinitionRepository } from '@aries-framework/anoncreds'
import { DidInfo } from '../types'
import { parseCredentialDefinitionId, getLegacyCredentialDefinitionId, parseSchemaId, getLegacySchemaId, getDidIndyCredentialDefinitionId } from '@aries-framework/indy-vdr/build/anoncreds/utils/identifiers'
@Controller('/agent/command/credential-definition')
export class CredentialDefinitionController extends BaseController {
  public constructor(testHarnessConfig: TestHarnessConfig) {
    super(testHarnessConfig)
  }

  @Get('/:credentialDefinitionId')
  async getCredentialDefinitionById(
    @PathParams('credentialDefinitionId') credentialDefinitionId: string
  ): Promise<ReturnedCredentialDefinition> {
    try {
      // Convert to fully qualified credentialDefinitionId if a legacy credentialDefinitionId was provided (current AATH behaviour)
      const { namespaceIdentifier, schemaSeqNo, tag, namespace } = parseCredentialDefinitionId(credentialDefinitionId)
      const didIndyCredentialDefinitionId = getDidIndyCredentialDefinitionId(namespace ?? 'main-pool', namespaceIdentifier, schemaSeqNo, tag)

      const { credentialDefinition } = await this.agent.modules.anoncreds.getCredentialDefinition(didIndyCredentialDefinitionId)

      if (!credentialDefinition) {
        throw new NotFound(`credential definition with credentialDefinitionId "${credentialDefinitionId}" not found.`)
      }

      const { schemaName, schemaVersion } = parseSchemaId(credentialDefinition.schemaId)

      return { ...credentialDefinition, schemaId: getLegacySchemaId(namespaceIdentifier, schemaName, schemaVersion), id: credentialDefinitionId }
    } catch (error) {
      // Credential definition does not exist on ledger
      if (error instanceof NotFound) {
        throw error
      }

      // All other errors
      throw new InternalServerError(
        `Error while retrieving credential definition with id ${credentialDefinitionId}`,
        error
      )
    }
  }

  @Post()
  async createCredentialDefinition(
    @BodyParams('data')
    data: {
      tag: string
      support_revocation: boolean
      schema_id: string
    }
  ): Promise<{
    credential_definition_id: string
    credential_definition: ReturnedCredentialDefinition
  }> {

    // Check locally if credential definition already exists
    const credentialDefinitionRepository = this.agent.dependencyManager.resolve(AnonCredsCredentialDefinitionRepository)
    const [credentialDefinitionRecord] = await credentialDefinitionRepository.findByQuery(this.agent.context, { 
      schemaId: data.schema_id, tag: data.tag })
    if (credentialDefinitionRecord) {

      // Use legacy schema/cred def id identifier, as currently AATH does not support querying full did:indy identifiers
      const { namespaceIdentifier, schemaSeqNo, tag }= parseCredentialDefinitionId(credentialDefinitionRecord.credentialDefinitionId)
      const { schemaName, schemaVersion } = parseSchemaId(credentialDefinitionRecord.credentialDefinition.schemaId)

      return {
        credential_definition_id: getLegacyCredentialDefinitionId(namespaceIdentifier, schemaSeqNo, tag),
        credential_definition: { ...credentialDefinitionRecord.credentialDefinition, 
          id: getLegacyCredentialDefinitionId(namespaceIdentifier, schemaSeqNo, tag), 
          schemaId: getLegacySchemaId(namespaceIdentifier, schemaName, schemaVersion) },
      }
    }

    // TODO: handle schema not found exception
    try {

      const anoncredsApi = this.agent.dependencyManager.resolve(AnonCredsApi)

      const schema = await anoncredsApi.getSchema(data.schema_id)

      const publicDidInfoRecord = await this.agent.genericRecords.findById('PUBLIC_DID_INFO')
    
      if (!publicDidInfoRecord) {
        throw new Error('Agent does not have any public did')
      }
  
      const issuerId = (publicDidInfoRecord.content.didInfo as unknown as DidInfo).did
      
      const { credentialDefinitionState } = await anoncredsApi.registerCredentialDefinition({ 
        credentialDefinition: {
          issuerId,
          schemaId: schema.schemaId,
          tag: data.tag,
        }, options: { didIndyNamespace: 'main-pool'}}) 

      if (!credentialDefinitionState.credentialDefinition || !credentialDefinitionState.credentialDefinitionId) {
        throw new Error()
      }
      
      const { namespaceIdentifier, schemaSeqNo, tag }= parseCredentialDefinitionId(credentialDefinitionState.credentialDefinitionId)

      // Use legacy schema id identifier, as currently AATH does not support querying full did:indy identifiers
      const { schemaName, schemaVersion } = parseSchemaId(credentialDefinitionState.credentialDefinition.schemaId)

      return {
        credential_definition_id: getLegacyCredentialDefinitionId(namespaceIdentifier, schemaSeqNo, tag),
        credential_definition: { ...credentialDefinitionState.credentialDefinition, 
          id: getLegacyCredentialDefinitionId(namespaceIdentifier, schemaSeqNo, tag), 
          schemaId: getLegacySchemaId(namespaceIdentifier, schemaName, schemaVersion) },
      }
    } catch (error: any) {
      throw new InternalServerError(`Error registering credential definition: ${error.message}`, error)
    }
  }
}

interface ReturnedCredentialDefinition extends AnonCredsCredentialDefinition {
  id: string
}