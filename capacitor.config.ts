import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.paldo.app',
  appName: 'pal.do',
  webDir: process.env.PALDO_ANDROID_PREVIEW === '1' ? 'dist-android' : 'dist',
  loggingBehavior: process.env.PALDO_ANDROID_PREVIEW === '1' ? 'none' : 'debug',
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#a6dcc6',
      sound: 'paldo_alert.wav',
    },
  },
}

export default config
