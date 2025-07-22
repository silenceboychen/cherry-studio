import { HStack } from '@renderer/components/Layout'
import { PROVIDER_CONFIG } from '@renderer/config/providers'
import { syncAwsBedrockSettingsToProvider, useAwsBedrockSettings } from '@renderer/hooks/useAwsBedrock'
import { Alert, Input } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

interface Props {
  providerId?: string
}

const AwsBedrockSettings: FC<Props> = ({ providerId = 'aws-bedrock' }) => {
  const { t } = useTranslation()
  const { accessKeyId, secretAccessKey, region, setAccessKeyId, setSecretAccessKey, setRegion } =
    useAwsBedrockSettings()

  const providerConfig = PROVIDER_CONFIG['aws-bedrock']
  const apiKeyWebsite = providerConfig?.websites?.apiKey

  const [localAccessKeyId, setLocalAccessKeyId] = useState(accessKeyId)
  const [localSecretAccessKey, setLocalSecretAccessKey] = useState(secretAccessKey)
  const [localRegion, setLocalRegion] = useState(region)

  // 同步设置到provider的extra_headers
  useEffect(() => {
    syncAwsBedrockSettingsToProvider(providerId)
  }, [accessKeyId, secretAccessKey, region, providerId])

  const handleAccessKeyIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalAccessKeyId(e.target.value)
  }

  const handleSecretAccessKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSecretAccessKey(e.target.value)
  }

  const handleRegionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalRegion(e.target.value)
  }

  const handleAccessKeyIdBlur = () => {
    setAccessKeyId(localAccessKeyId)
  }

  const handleSecretAccessKeyBlur = () => {
    setSecretAccessKey(localSecretAccessKey)
  }

  const handleRegionBlur = () => {
    setRegion(localRegion)
  }

  return (
    <>
      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.aws.title')}</SettingSubtitle>
      <Alert type="info" style={{ marginTop: 5 }} message={t('settings.provider.aws.description')} showIcon />

      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.aws.access_key_id')}</SettingSubtitle>
      <Input
        value={localAccessKeyId}
        placeholder={t('settings.provider.aws.access_key_id_placeholder')}
        onChange={handleAccessKeyIdChange}
        onBlur={handleAccessKeyIdBlur}
        style={{ marginTop: 5 }}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.aws.access_key_id_help')}</SettingHelpText>
      </SettingHelpTextRow>

      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.aws.secret_access_key')}</SettingSubtitle>
      <Input.Password
        value={localSecretAccessKey}
        placeholder={t('settings.provider.aws.secret_access_key_placeholder')}
        onChange={handleSecretAccessKeyChange}
        onBlur={handleSecretAccessKeyBlur}
        style={{ marginTop: 5 }}
        spellCheck={false}
      />
      {apiKeyWebsite && (
        <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
          <HStack>
            <SettingHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.provider.get_api_key')}
            </SettingHelpLink>
          </HStack>
          <SettingHelpText>{t('settings.provider.aws.secret_access_key_help')}</SettingHelpText>
        </SettingHelpTextRow>
      )}

      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.aws.region')}</SettingSubtitle>
      <Input
        value={localRegion}
        placeholder={t('settings.provider.aws.region_placeholder')}
        onChange={handleRegionChange}
        onBlur={handleRegionBlur}
        style={{ marginTop: 5 }}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.aws.region_help')}</SettingHelpText>
      </SettingHelpTextRow>
    </>
  )
}

export default AwsBedrockSettings
