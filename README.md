# Anvil Android Source Project

This is a production-oriented hybrid Android app with an HTML/JS frontend hosted in a native WebView.
The app is designed around the **Anvil** theme and includes onboarding, workout tracking, nutrition,
habit tracking, usage stats, notifications, and backup/export flows.

<div align="center">

[![Download the Android APK](https://img.shields.io/badge/Download%20APK-Now-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://github.com/akashtavern-art/anvil-tracker-app/releases/download/latest-apk/anvil-tracker-app-debug.apk)

</div>

## Get Anvil APK

Need the app quickly? Tap the button above to directly download the latest Android APK.

- Click **Download APK** above to start the download immediately.
- If the direct file is still being generated, use the fallback release page:
  `https://github.com/akashtavern-art/anvil-tracker-app/releases`
- If Android asks, allow installation from unknown sources.

## Requirements

- Android Studio or JDK 17
- Android SDK 34
- Gradle 8+

## Build

```bash
# from project root
./gradlew -p android assembleDebug
```

If you do not have the Gradle wrapper JAR cached yet, the script will fallback to the system `gradle` command. Ensure `gradle` is installed and on PATH, or open the `android` folder in Android Studio and run a Gradle task there.

The generated APK is:

`android/app/build/outputs/apk/debug/app-debug.apk`

## Notes

- The web frontend is located in `android/app/src/main/assets/www`.
- Native bridge methods are exposed to JS as `window.AnvilBridge`.
- The native bridge includes `UsageStatsManager` integration (Usage Access flow),
  local notifications, native audio recording, and storage export hooks.
- `chart.umd.min.js` now lives in the same assets folder as a local fallback,
  so charts continue to render in offline APK mode without pulling the CDN.
- `anvil_neon_icon.png` is bundled in `android/app/src/main/assets/www`
  and wired into the dashboard top bar.
- The same `anvil_neon_icon.png` is now copied to Android resources and used
  as the app launcher icon.
