// Shared Expo build entry. Edit each app's own configuration under frontend/.
const audience =
  process.env.HYZZ_APP_VARIANT === "driver" ? "driver" : "customer";
const app = require(`./frontend/${audience}/app.config.js`);
module.exports = {
  expo: {
    name: app.name,
    slug: app.slug,
    version: app.version,
    icon: app.icon,
    orientation: "portrait",
    userInterfaceStyle: "light",
    platforms: ["android", "ios", "web"],
    scheme: app.scheme,
    android: {
      package: app.package,
      ...(require("fs").existsSync(
        `./android/app/src/${audience}/google-services.json`,
      )
        ? {
            googleServicesFile: `./android/app/src/${audience}/google-services.json`,
          }
        : {}),
      versionCode: app.versionCode,
      softwareKeyboardLayoutMode: "resize",
      permissions: [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "POST_NOTIFICATIONS",
        ...(audience === "driver"
          ? [
              "ACCESS_BACKGROUND_LOCATION",
              "FOREGROUND_SERVICE",
              "FOREGROUND_SERVICE_LOCATION",
            ]
          : []),
      ],
      blockedPermissions: [
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE",
        "SYSTEM_ALERT_WINDOW",
        ...(audience === "customer" ? ["ACCESS_BACKGROUND_LOCATION"] : []),
      ],
    },
    ios: {
      bundleIdentifier: app.package,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          "Hyzz uses location for pickup and assigned trip tracking.",
      },
    },
    web: { bundler: "metro", output: "single" },
    plugins: [
      "expo-font",
      "expo-web-browser",
      "expo-document-picker",
      "expo-notifications",
      "expo-secure-store",
      [
        "expo-location",
        {
          isAndroidBackgroundLocationEnabled: audience === "driver",
          isAndroidForegroundServiceEnabled: audience === "driver",
          locationWhenInUsePermission:
            "Allow Hyzz to use your location for pickup and nearby driver matching.",
        },
      ],
    ],
    extra: {
      appVariant: audience,
      ...(app.easProjectId ? { eas: { projectId: app.easProjectId } } : {}),
    },
  },
};
