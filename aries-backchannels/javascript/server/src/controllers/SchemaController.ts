import { AnonCredsSchema, AnonCredsSchemaRepository } from '@aries-framework/anoncreds'
import { DidInfo } from '../types'
import { Controller, Get, PathParams, Post, BodyParams } from '@tsed/common'
import { InternalServerError, NotFound } from '@tsed/exceptions'
import { BaseController } from '../BaseController'
import { TestHarnessConfig } from '../TestHarnessConfig'
import { parseSchemaId, getLegacySchemaId, getDidIndySchemaId } from '@aries-framework/indy-vdr/build/anoncreds/utils/identifiers'

@Controller('/agent/command/schema')
export class SchemaController extends BaseController {
  private createdSchemas: {
    [schemaName: string]: AnonCredsSchema
  } = {}

  public constructor(testHarnessConfig: TestHarnessConfig) {
    super(testHarnessConfig)
  }

  @Get('/:schemaId')
  async getSchemaById(@PathParams('schemaId') schemaId: string): Promise<ReturnedSchema> {
    try {
      // Convert to fully qualified schemaId if a legacy schemaId was provided (current AATH behaviour)
      const { namespaceIdentifier, schemaName, schemaVersion, namespace } = parseSchemaId(schemaId)
      const didIndySchemaId = getDidIndySchemaId(namespace ?? 'main-pool', namespaceIdentifier, schemaName, schemaVersion)

      const { schema } = await this.agent.modules.anoncreds.getSchema(didIndySchemaId)

      if (!schema) {
        throw new NotFound(`schema with schemaId "${schemaId}" not found.`)
      }

      return { ...schema, id: schemaId }
    } catch (error: any) {
      // Schema does not exist on ledger
      if (error instanceof NotFound) {
        throw error
      }

      // All other errors
      throw new InternalServerError(`Error while retrieving schema with id ${schemaId}`, error)
    }
  }

  @Post()
  async createSchema(@BodyParams('data') data: any): Promise<{schema_id: string, schema: ReturnedSchema}> {

    const schemaRepository = this.agent.dependencyManager.resolve(AnonCredsSchemaRepository)
    const [schemaRecord] = await schemaRepository.findByQuery(this.agent.context, { schemaName: data.schema_name, 
      schemaVersion: data.schema_version })
    if (schemaRecord) {
      const { namespaceIdentifier, schemaName, schemaVersion } = parseSchemaId(schemaRecord.schemaId)
      return {
        schema_id: getLegacySchemaId(namespaceIdentifier, schemaName, schemaVersion),
        schema: { ...schemaRecord.schema, id: getLegacySchemaId(namespaceIdentifier, schemaName, schemaVersion) },
      }
    }
    const publicDidInfoRecord = await this.agent.genericRecords.findById('PUBLIC_DID_INFO')
    
    if (!publicDidInfoRecord) {
      throw new Error('Agent does not have any public did')
    }

    const issuerId = (publicDidInfoRecord.content.didInfo as unknown as DidInfo).did
    const schema = await this.agent.modules.anoncreds.registerSchema({
      schema: {
        attrNames: data.attributes,
        name: data.schema_name,
        version: data.schema_version,
        issuerId,
      },
      options: { didIndyNamespace: 'main-pool'}
    })

    if (!schema.schemaState.schema || !schema.schemaState.schemaId) {
      throw new Error(`Schema could not be registered: ${JSON.stringify(schema.schemaState)}}`) // TODO
    }

    const { namespaceIdentifier, schemaName, schemaVersion } = parseSchemaId(schema.schemaState.schemaId)

    return {
      schema_id: getLegacySchemaId(namespaceIdentifier, schemaName, schemaVersion),
      schema: { ...schema.schemaState.schema, id: getLegacySchemaId(namespaceIdentifier, schemaName, schemaVersion) },
    }
  }
}

interface ReturnedSchema extends AnonCredsSchema {
  id: string
}
