import { theme } from 'ant-design-vue'
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'

export const cabinetTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#D4A574',
    colorInfo: '#D4A574',
    colorSuccess: '#E8B84A',
    colorWarning: '#E8B84A',
    colorError: '#C23B22',
    colorBgBase: '#241814',
    colorBgContainer: '#2C1C16',
    colorBgElevated: '#35241C',
    colorTextBase: '#F2E6D0',
    colorText: '#F2E6D0',
    colorTextSecondary: '#8A7464',
    colorBorder: '#5A3F32',
    colorBorderSecondary: '#3D2A22',
    borderRadius: 2,
    fontFamily: '"Noto Sans SC", "Source Han Sans SC", sans-serif',
    fontSize: 15,
    controlHeight: 44,
  },
}
