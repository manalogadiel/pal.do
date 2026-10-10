import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.paldo.app',
  appName: 'pal.do',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#a6dcc6',
      sound: 'beep.wav',
    },
  },
}

export default config
