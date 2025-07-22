import store, { useAppSelector } from '@renderer/store'
import {
  setAwsBedrockAccessKeyId,
  setAwsBedrockRegion,
  setAwsBedrockSecretAccessKey,
  updateProvider
} from '@renderer/store/llm'
import { useDispatch } from 'react-redux'

export function useAwsBedrockSettings() {
  const settings = useAppSelector(
    (state) => state.llm.settings.awsBedrock || { accessKeyId: '', secretAccessKey: '', region: '' }
  )
  const dispatch = useDispatch()

  return {
    ...settings,
    setAccessKeyId: (accessKeyId: string) => dispatch(setAwsBedrockAccessKeyId(accessKeyId)),
    setSecretAccessKey: (secretAccessKey: string) => dispatch(setAwsBedrockSecretAccessKey(secretAccessKey)),
    setRegion: (region: string) => dispatch(setAwsBedrockRegion(region))
  }
}

export function getAwsBedrockSettings() {
  const settings = store.getState().llm.settings.awsBedrock
  return settings || { accessKeyId: '', secretAccessKey: '', region: '' }
}

export function getAwsBedrockAccessKeyId() {
  const settings = store.getState().llm.settings.awsBedrock
  return settings?.accessKeyId || ''
}

export function getAwsBedrockSecretAccessKey() {
  const settings = store.getState().llm.settings.awsBedrock
  return settings?.secretAccessKey || ''
}

export function getAwsBedrockRegion() {
  const settings = store.getState().llm.settings.awsBedrock
  return settings?.region || ''
}

/**
 * 将AWS Bedrock设置同步到provider的extra_headers
 * 用于保持向后兼容性
 */
export function syncAwsBedrockSettingsToProvider(providerId: string) {
  const state = store.getState()
  const settings = state.llm.settings.awsBedrock
  const provider = state.llm.providers.find((p) => p.id === providerId)

  // 如果settings为undefined，使用默认值
  if (!settings) {
    return
  }

  if (provider && provider.type === 'aws-bedrock') {
    store.dispatch(
      updateProvider({
        id: providerId,
        extra_headers: {
          ...provider.extra_headers,
          'AWS-Access-Key-ID': settings.accessKeyId || '',
          'AWS-Secret-Access-Key': settings.secretAccessKey || '',
          'AWS-Region': settings.region || ''
        }
      })
    )
  }
}
