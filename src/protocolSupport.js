const minecraftProtocol = require("minecraft-protocol");

function getSupportedVersions() {
  return Array.isArray(minecraftProtocol.supportedVersions) ? minecraftProtocol.supportedVersions : [];
}

function pingServer(config) {
  return new Promise((resolve, reject) => {
    minecraftProtocol.ping({ host: config.host, port: config.port }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });
}

function buildProtocolDiagnosis(pingResult, supportedVersions = getSupportedVersions()) {
  const serverVersion = pingResult?.version?.name || "unknown";
  const protocol = pingResult?.version?.protocol;
  const supported = supportedVersions.includes(serverVersion);
  const latestSupported = supportedVersions[supportedVersions.length - 1] || "unknown";

  if (supported) {
    return {
      supported: true,
      serverVersion,
      protocol,
      latestSupported,
      message: `Server version ${serverVersion} is supported.`
    };
  }

  return {
    supported: false,
    serverVersion,
    protocol,
    latestSupported,
    message: `Server version ${serverVersion}${protocol ? ` (protocol ${protocol})` : ""} is not supported by the installed mineflayer/minecraft-protocol packages. Latest supported version is ${latestSupported}.`
  };
}

function resolveMinecraftVersion(configuredVersion, diagnosis) {
  if (!diagnosis?.supported) return configuredVersion;
  const serverVersion = diagnosis.serverVersion;
  if (!serverVersion || serverVersion === "unknown") return configuredVersion;
  return serverVersion;
}

async function preflightProtocol(config, logger) {
  const pingResult = await pingServer(config);
  const diagnosis = buildProtocolDiagnosis(pingResult);
  logger.info(`server ping: version=${diagnosis.serverVersion}, protocol=${diagnosis.protocol}, players=${pingResult.players?.online ?? "?"}/${pingResult.players?.max ?? "?"}`);

  if (!diagnosis.supported && process.env.SKIP_PROTOCOL_PREFLIGHT !== "true") {
    const error = new Error(`${diagnosis.message} Use a supported server version, add a protocol translation proxy that exposes a supported version, or wait for PrismarineJS packages to add support. Set SKIP_PROTOCOL_PREFLIGHT=true only if you intentionally want to test a custom protocol stack.`);
    error.code = "UNSUPPORTED_PROTOCOL";
    throw error;
  }

  return diagnosis;
}

module.exports = {
  buildProtocolDiagnosis,
  getSupportedVersions,
  pingServer,
  preflightProtocol,
  resolveMinecraftVersion
};