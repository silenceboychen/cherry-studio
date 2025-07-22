import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  Message as AWSMessage
} from '@aws-sdk/client-bedrock-runtime'
import { loggerService } from '@logger'
import { GenericChunk } from '@renderer/aiCore/middleware/schemas'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import { estimateTextTokens } from '@renderer/services/TokenService'
import {
  GenerateImageParams,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  ToolCallResponse
} from '@renderer/types'
import { ChunkType, MCPToolCreatedChunk, TextDeltaChunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import {
  AwsBedrockSdkInstance,
  AwsBedrockSdkMessageParam,
  AwsBedrockSdkParams,
  AwsBedrockSdkRawChunk,
  AwsBedrockSdkRawOutput,
  AwsBedrockSdkTool,
  AwsBedrockSdkToolCall,
  SdkModel
} from '@renderer/types/sdk'
import { isEnabledToolUse, mcpToolCallResponseToAwsBedrockMessage } from '@renderer/utils/mcp-tools'
import { buildSystemPrompt } from '@renderer/utils/prompt'

import { BaseApiClient } from '../BaseApiClient'
import { RequestTransformer, ResponseChunkTransformer } from '../types'

const logger = loggerService.withContext('AwsBedrockAPIClient')

export class AwsBedrockAPIClient extends BaseApiClient<
  AwsBedrockSdkInstance,
  AwsBedrockSdkParams,
  AwsBedrockSdkRawOutput,
  AwsBedrockSdkRawChunk,
  AwsBedrockSdkMessageParam,
  AwsBedrockSdkToolCall,
  AwsBedrockSdkTool
> {
  constructor(provider: Provider) {
    super(provider)
  }

  async getSdkInstance(): Promise<AwsBedrockSdkInstance> {
    if (this.sdkInstance) {
      return this.sdkInstance
    }

    const region = this.provider.extra_headers?.['AWS-Region']
    const accessKeyId = this.provider.extra_headers?.['AWS-Access-Key-ID']
    const secretAccessKey = this.provider.extra_headers?.['AWS-Secret-Access-Key']

    if (!region) {
      throw new Error('AWS region is required. Please configure AWS-Region in extra headers.')
    }

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('AWS credentials are required. Please configure AWS-Access-Key-ID and AWS-Secret-Access-Key.')
    }

    const client = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    })

    this.sdkInstance = { client, region }
    return this.sdkInstance
  }

  async createCompletions(payload: AwsBedrockSdkParams): Promise<AwsBedrockSdkRawOutput> {
    const sdk = await this.getSdkInstance()

    // 转换消息格式到AWS SDK原生格式
    const awsMessages: AWSMessage[] = payload.messages.map((msg) => ({
      role: msg.role,
      content: msg.content.map((content) => {
        if (content.text) {
          return { text: content.text }
        }
        if (content.toolResult) {
          return {
            toolResult: {
              toolUseId: content.toolResult.toolUseId,
              content: content.toolResult.content
            }
          }
        }
        if (content.toolUse) {
          return {
            toolUse: {
              toolUseId: content.toolUse.toolUseId,
              name: content.toolUse.name,
              input: content.toolUse.input
            }
          }
        }
        return { text: '' }
      })
    }))

    const commonParams = {
      modelId: payload.modelId,
      messages: awsMessages,
      system: payload.system ? [{ text: payload.system }] : undefined,
      inferenceConfig: {
        maxTokens: payload.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: payload.temperature || 0.7,
        topP: payload.topP || 1
      },
      toolConfig:
        payload.tools && payload.tools.length > 0
          ? {
              tools: payload.tools
            }
          : undefined
    }

    try {
      if (payload.stream) {
        const command = new ConverseStreamCommand(commonParams)
        const response = await sdk.client.send(command)
        // 直接返回AWS Bedrock流式响应的异步迭代器
        return this.createStreamIterator(response)
      } else {
        const command = new ConverseCommand(commonParams)
        const response = await sdk.client.send(command)
        return { output: response }
      }
    } catch (error) {
      logger.error('Failed to create completions with AWS Bedrock:', error)
      throw error
    }
  }

  private async *createStreamIterator(response: any): AsyncIterable<AwsBedrockSdkRawChunk> {
    try {
      if (response.stream) {
        for await (const chunk of response.stream) {
          logger.debug('AWS Bedrock chunk received:', chunk)

          // AWS Bedrock的流式响应格式转换为标准格式
          if (chunk.contentBlockDelta?.delta?.text) {
            yield {
              contentBlockDelta: {
                delta: { text: chunk.contentBlockDelta.delta.text }
              }
            }
          }

          if (chunk.messageStart) {
            yield { messageStart: chunk.messageStart }
          }

          if (chunk.messageStop) {
            yield { messageStop: chunk.messageStop }
          }

          if (chunk.metadata) {
            yield { metadata: chunk.metadata }
          }
        }
      }
    } catch (error) {
      logger.error('Error in AWS Bedrock stream iterator:', error)
      throw error
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async generateImage(_generateImageParams: GenerateImageParams): Promise<string[]> {
    throw new Error('AWS Bedrock image generation not implemented yet')
  }

  async getEmbeddingDimensions(model?: Model): Promise<number> {
    if (!model) return 1536

    const modelId = model.id.toLowerCase()
    if (modelId.includes('titan-embed')) {
      return 1536
    }
    if (modelId.includes('cohere.embed')) {
      return 1024
    }

    return 1536
  }

  async listModels(): Promise<SdkModel[]> {
    return [
      { id: 'us.anthropic.claude-opus-4-20250514-v1:0', name: 'Claude Opus 4 (US)' },
      { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0', name: 'Claude Sonnet 4 (US)' },
      { id: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0', name: 'Claude 3.7 Sonnet (US)' }
    ]
  }

  async convertMessageToSdkParam(message: Message): Promise<AwsBedrockSdkMessageParam> {
    const content = await this.getMessageContent(message)

    return {
      role: message.role === 'system' ? 'user' : message.role,
      content: [{ text: content }]
    }
  }

  getRequestTransformer(): RequestTransformer<AwsBedrockSdkParams, AwsBedrockSdkMessageParam> {
    return {
      transform: async (
        coreRequest,
        assistant,
        model,
        isRecursiveCall,
        recursiveSdkMessages
      ): Promise<{
        payload: AwsBedrockSdkParams
        messages: AwsBedrockSdkMessageParam[]
        metadata: Record<string, any>
      }> => {
        const { messages, mcpTools, maxTokens, streamOutput } = coreRequest

        // 设置工具
        const { tools } = this.setupToolsConfig({
          mcpTools: mcpTools,
          model,
          enableToolUse: isEnabledToolUse(assistant)
        })

        let systemPrompt = assistant.prompt

        if (this.useSystemPromptForTools) {
          systemPrompt = await buildSystemPrompt(systemPrompt, mcpTools, assistant)
        }

        // 处理消息
        const sdkMessages: AwsBedrockSdkMessageParam[] = []
        if (typeof messages === 'string') {
          sdkMessages.push({ role: 'user', content: [{ text: messages }] })
        } else {
          for (const message of messages) {
            sdkMessages.push(await this.convertMessageToSdkParam(message))
          }
        }

        const payload: AwsBedrockSdkParams = {
          modelId: model.id,
          messages:
            isRecursiveCall && recursiveSdkMessages && recursiveSdkMessages.length > 0
              ? recursiveSdkMessages
              : sdkMessages,
          system: systemPrompt,
          maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
          temperature: this.getTemperature(assistant, model),
          topP: this.getTopP(assistant, model),
          stream: streamOutput !== false,
          tools: tools.length > 0 ? tools : undefined
        }

        const timeout = this.getTimeout(model)
        return { payload, messages: sdkMessages, metadata: { timeout } }
      }
    }
  }

  getResponseChunkTransformer(): ResponseChunkTransformer<AwsBedrockSdkRawChunk> {
    return () => {
      let hasStartedText = false
      let accumulatedJson = ''
      const toolCalls: Record<number, AwsBedrockSdkToolCall> = {}

      return {
        async transform(rawChunk: AwsBedrockSdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) {
          logger.debug('Processing AWS Bedrock chunk:', rawChunk)

          // 处理消息开始事件
          if (rawChunk.messageStart) {
            controller.enqueue({
              type: ChunkType.TEXT_START
            })
            hasStartedText = true
            logger.debug('Message started')
          }

          // 处理内容块开始事件 - 参考 Anthropic 的 content_block_start 处理
          if (rawChunk.contentBlockStart?.start?.toolUse) {
            const toolUse = rawChunk.contentBlockStart.start.toolUse
            const blockIndex = rawChunk.contentBlockStart.contentBlockIndex || 0
            toolCalls[blockIndex] = {
              id: toolUse.toolUseId, // 设置 id 字段与 toolUseId 相同
              name: toolUse.name,
              toolUseId: toolUse.toolUseId,
              input: {} // Will be populated by input deltas
            }
            logger.debug('Tool use started:', toolUse)
          }

          // 处理内容块增量事件 - 参考 Anthropic 的 content_block_delta 处理
          if (rawChunk.contentBlockDelta?.delta?.toolUse?.input) {
            const inputDelta = rawChunk.contentBlockDelta.delta.toolUse.input
            accumulatedJson += inputDelta
            logger.debug('Tool input delta:', inputDelta)
          }

          // 处理文本增量
          if (rawChunk.contentBlockDelta?.delta?.text) {
            if (!hasStartedText) {
              controller.enqueue({
                type: ChunkType.TEXT_START
              })
              hasStartedText = true
            }

            controller.enqueue({
              type: ChunkType.TEXT_DELTA,
              text: rawChunk.contentBlockDelta.delta.text
            } as TextDeltaChunk)

            logger.debug('Text delta:', rawChunk.contentBlockDelta.delta.text)
          }

          // 处理内容块停止事件 - 参考 Anthropic 的 content_block_stop 处理
          if (rawChunk.contentBlockStop) {
            const blockIndex = rawChunk.contentBlockStop.contentBlockIndex || 0
            const toolCall = toolCalls[blockIndex]
            if (toolCall && accumulatedJson) {
              try {
                toolCall.input = JSON.parse(accumulatedJson)
                logger.debug(`Tool call id: ${toolCall.toolUseId}, accumulated json: ${accumulatedJson}`)
                controller.enqueue({
                  type: ChunkType.MCP_TOOL_CREATED,
                  tool_calls: [toolCall]
                } as MCPToolCreatedChunk)
                accumulatedJson = '' // Reset for next tool
              } catch (error) {
                logger.error(`Error parsing tool call input: ${error}`)
              }
            }
          }

          // 处理消息结束事件
          if (rawChunk.messageStop) {
            logger.debug('Message stopped, metadata:', rawChunk.metadata)

            // 从metadata中提取usage信息
            const usage = rawChunk.metadata?.usage || {}

            controller.enqueue({
              type: ChunkType.LLM_RESPONSE_COMPLETE,
              response: {
                usage: {
                  prompt_tokens: usage.inputTokens || 0,
                  completion_tokens: usage.outputTokens || 0,
                  total_tokens: (usage.inputTokens || 0) + (usage.outputTokens || 0)
                }
              }
            })
          }
        }
      }
    }
  }

  convertMcpToolsToSdkTools(mcpTools: MCPTool[]): AwsBedrockSdkTool[] {
    return mcpTools.map((mcpTool) => ({
      toolSpec: {
        name: mcpTool.name,
        description: mcpTool.description,
        inputSchema: {
          json: {
            type: 'object',
            properties: mcpTool.inputSchema?.properties
              ? Object.fromEntries(
                  Object.entries(mcpTool.inputSchema.properties).map(([key, value]) => [
                    key,
                    {
                      type:
                        typeof value === 'object' && value !== null && 'type' in value ? (value as any).type : 'string',
                      description:
                        typeof value === 'object' && value !== null && 'description' in value
                          ? (value as any).description
                          : undefined
                    }
                  ])
                )
              : {},
            required: mcpTool.inputSchema?.required || []
          }
        }
      }
    }))
  }

  convertSdkToolCallToMcp(toolCall: AwsBedrockSdkToolCall, mcpTools: MCPTool[]): MCPTool | undefined {
    return mcpTools.find((tool) => tool.name === toolCall.name)
  }

  convertSdkToolCallToMcpToolResponse(toolCall: AwsBedrockSdkToolCall, mcpTool: MCPTool): ToolCallResponse {
    return {
      id: toolCall.id || toolCall.toolUseId || '', // 优先使用 id 字段
      tool: mcpTool,
      arguments: toolCall.input || {},
      status: 'pending',
      toolCallId: toolCall.toolUseId
    }
  }

  buildSdkMessages(
    currentReqMessages: AwsBedrockSdkMessageParam[],
    output: AwsBedrockSdkRawOutput | string | undefined,
    toolResults: AwsBedrockSdkMessageParam[]
  ): AwsBedrockSdkMessageParam[] {
    const messages: AwsBedrockSdkMessageParam[] = [...currentReqMessages]

    if (typeof output === 'string') {
      messages.push({
        role: 'assistant',
        content: [{ text: output }]
      })
    }

    if (toolResults.length > 0) {
      messages.push(...toolResults)
    }

    return messages
  }

  estimateMessageTokens(message: AwsBedrockSdkMessageParam): number {
    const content = message.content
    if (Array.isArray(content)) {
      return content.reduce((total, item) => {
        if (item.text) {
          return total + estimateTextTokens(item.text)
        }
        return total
      }, 0)
    }
    return 0
  }

  convertMcpToolResponseToSdkMessageParam(
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ): AwsBedrockSdkMessageParam | undefined {
    if ('toolUseId' in mcpToolResponse && mcpToolResponse.toolUseId) {
      // 使用专用的转换函数处理 toolUseId 情况
      return mcpToolCallResponseToAwsBedrockMessage(mcpToolResponse, resp, model)
    } else if ('toolCallId' in mcpToolResponse && mcpToolResponse.toolCallId) {
      // 处理 toolCallId 情况 - 作为备用标识
      return {
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId: mcpToolResponse.toolCallId,
              content: resp.content
                .map((item) => {
                  if (item.type === 'text') {
                    return { text: item.text || '' }
                  }
                  if (item.type === 'image') {
                    return { text: `[Image: ${item.mimeType || 'image/png'}]` }
                  }
                  return { text: JSON.stringify(item) }
                })
                .filter((content) => content !== null)
            }
          }
        ]
      }
    }

    // 如果既没有 toolUseId 也没有 toolCallId，返回 undefined
    return undefined
  }

  extractMessagesFromSdkPayload(sdkPayload: AwsBedrockSdkParams): AwsBedrockSdkMessageParam[] {
    return sdkPayload.messages || []
  }
}
