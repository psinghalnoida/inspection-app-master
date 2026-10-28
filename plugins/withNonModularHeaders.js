const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// iOS builds WITHOUT use_frameworks! (dropped — iOS uses Apple Maps, no
// GoogleMaps SDK). Firebase's Swift pods (FirebaseCoreInternal) depend on
// GoogleUtilities, which doesn't define modules, so they can't integrate as
// static libraries unless module maps are generated. use_modular_headers!
// makes every pod (incl. GoogleUtilities and React-Core) modular, which fixes
// both the Firebase-Swift error and the react-native-maps/RNFB "must be
// imported from module" errors. Injected via a config plugin because EAS runs
// `expo prebuild` (ios/ is gitignored), which regenerates the Podfile.
module.exports = function withNonModularHeaders(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfile, "utf8");

      if (contents.includes("use_modular_headers!")) return config; // idempotent

      contents = contents.replace(
        /^(target ['"][^'"]+['"] do)/m,
        "$1\n  use_modular_headers!"
      );

      fs.writeFileSync(podfile, contents);
      return config;
    },
  ]);
};
