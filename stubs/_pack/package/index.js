function unsupported() {
  throw new Error(
    'raknet-native is disabled in this project. The bot is configured to use the pure-JS jsp-raknet backend instead.'
  );
}

class UnsupportedRaknetNative {
  constructor() {
    unsupported();
  }
}

module.exports = {
  Client: UnsupportedRaknetNative,
  Server: UnsupportedRaknetNative,
  PacketPriority: {},
  PacketReliability: {}
};
