// Broadcast service.
// This service centralises protocol message delivery so handlers do not need
// to repeatedly construct room names or call socket / io emit methods directly.
// At this stage it supports:
// sending a protocol message to one socket
// broadcasting a protocol message to all sockets in a game room
// generating the standard room name for a game

const { ROOM_PREFIX } = require("../config/constants");

function getGameRoomName(gameId) {
    return `${ROOM_PREFIX}${gameId}`;
}

function sendToSocket(socket, messageType, message) {
    socket.emit(messageType, message);
}

function broadcastToGame(io, gameId, messageType, message) {
    io.to(getGameRoomName(gameId)).emit(messageType, message);
}

module.exports = {
    getGameRoomName,
    sendToSocket,
    broadcastToGame
};