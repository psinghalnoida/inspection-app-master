const { withAndroidManifest } = require("expo/config-plugins");

const META_DATA_NAME = "isMonitoringTool";
const META_DATA_VALUE = "enterprise_management";

module.exports = function withMonitoringToolFlag(config) {
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    if (!manifest) {
      console.warn(
        "withMonitoringToolFlag: Could not find <manifest> in AndroidManifest.xml"
      );
      return config;
    }

    if (!manifest["meta-data"]) {
      manifest["meta-data"] = [];
    }

    const existingFlag = manifest["meta-data"].find(
      (m) => m.$?.["android:name"] === META_DATA_NAME
    );

    if (!existingFlag) {
      manifest["meta-data"].push({
        $: {
          "android:name": META_DATA_NAME,
          "android:value": META_DATA_VALUE,
        },
      });
      console.log(
        `withMonitoringToolFlag: Added isMonitoringTool=${META_DATA_VALUE} to manifest`
      );
    } else {
      console.log(
        "withMonitoringToolFlag: isMonitoringTool flag already present in manifest"
      );
    }

    return config;
  });

  return config;
};
