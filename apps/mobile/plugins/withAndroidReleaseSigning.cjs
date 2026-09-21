const { withAppBuildGradle } = require("expo/config-plugins");

// ThroughLine: the Expo/React Native template signs release builds with the
// toolchain's shared `debug.keystore` (CN=Android Debug), which anyone has.
// A published application must be signed with a key only we hold.
//
// The key and its password live outside this repository, in the same
// owner-only credential directory as the Apple signing material. Gradle reads
// that file itself at build time; the password is never passed on a command
// line, never placed in an environment variable, and never written here.
//
// If the file is absent the release build falls back to the template's debug
// signing rather than failing, so a checkout without the credential still
// builds something installable for local testing.
const SIGNING_PROPERTIES_PATH =
  process.env.THROUGHLINE_ANDROID_SIGNING_PROPERTIES ??
  "/Users/Admin/.local/state/android-signing/upload-key.properties";

const MARKER = "// ThroughLine: upload signing";

const signingConfigBlock = (propertiesPath) => `
    ${MARKER}
    release {
        def throughlinePropsFile = new File("${propertiesPath}")
        if (throughlinePropsFile.exists()) {
            def throughlineProps = new Properties()
            throughlinePropsFile.withInputStream { throughlineProps.load(it) }
            storeFile file(throughlineProps['storeFile'])
            storePassword throughlineProps['storePassword']
            keyAlias throughlineProps['keyAlias']
            keyPassword throughlineProps['keyPassword']
        } else {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
`;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (nextConfig) => {
    let contents = nextConfig.modResults.contents;

    if (contents.includes(MARKER)) {
      return nextConfig;
    }

    // 1. Add a `release` signing config beside the template's `debug` one.
    const signingConfigsAnchor = /(signingConfigs\s*\{)/;
    if (!signingConfigsAnchor.test(contents)) {
      throw new Error(
        "withAndroidReleaseSigning: no signingConfigs block found in app/build.gradle",
      );
    }
    contents = contents.replace(
      signingConfigsAnchor,
      `$1\n${signingConfigBlock(SIGNING_PROPERTIES_PATH)}`,
    );

    // 2. Point the release build type at it instead of the debug config.
    const releaseUsesDebug = /signingConfig\s+signingConfigs\.debug/g;
    const releaseBuildType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
    if (!releaseBuildType.test(contents)) {
      throw new Error(
        "withAndroidReleaseSigning: release build type does not reference signingConfigs.debug",
      );
    }
    contents = contents.replace(
      releaseBuildType,
      "$1signingConfig signingConfigs.release",
    );
    void releaseUsesDebug;

    nextConfig.modResults.contents = contents;
    return nextConfig;
  });
};
