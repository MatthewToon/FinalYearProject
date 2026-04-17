/*
 * Internal Redis pub/sub channel names.
 *
 * Keeping these centralised makes the service-to-service wiring much easier
 * to follow and keeps message routing consistent.
 */

const CHANNELS = {
  sessionRequests: "chess.session.requests",
  gameRequests: "chess.game.requests"
};

function getGatewayReplyChannel(gatewayInstanceId) {
  return `chess.gateway.${gatewayInstanceId}.responses`;
}

module.exports = {
  CHANNELS,
  getGatewayReplyChannel
};
