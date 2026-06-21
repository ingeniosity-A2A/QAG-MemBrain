import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ava007.mobile',
  appName: 'AVA007 AMOS',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    // Native plugins registered here as they are implemented in QNNPlugin.kt / ArrowBridge.kt
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
