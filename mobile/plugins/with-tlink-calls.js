// Expo config plugins execute as CommonJS during prebuild.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withInfoPlist, withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = function withTLinkCalls(config) {
  config = withInfoPlist(config, value => {
    value.modResults.UIBackgroundModes = [...new Set([...(value.modResults.UIBackgroundModes || []), 'audio', 'voip', 'remote-notification'])];
    return value;
  });
  return withAndroidManifest(config, value => {
    const manifest = value.modResults;
    manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    for (const permission of ['android.permission.POST_NOTIFICATIONS', 'android.permission.USE_FULL_SCREEN_INTENT', 'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MICROPHONE', 'android.permission.RECORD_AUDIO', 'android.permission.VIBRATE']) {
      if (!manifest.manifest['uses-permission']?.some(item => item.$?.['android:name'] === permission)) {
        AndroidConfig.Permissions.addPermission(manifest, permission);
      }
    }
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.service ||= [];
    // The subclass delegates every non-call message and token update to Expo.
    const serviceName = 'expo.modules.notifications.service.ExpoFirebaseMessagingService';
    const service = application.service.find(item => item.$?.['android:name'] === serviceName);
    if (service) service.$['tools:node'] = 'remove';
    else application.service.push({ $: { 'android:name': serviceName, 'tools:node': 'remove' } });
    return value;
  });
};
