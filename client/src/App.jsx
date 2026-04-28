// Main client application.
// This React component is the whole browser-side chess app, which currently:
// - creates or restores the browser's player identity
// - opens the Socket.IO connection to the backend
// - listens for server events such as room creation, state sync, and move updates
// - renders the menu, forms, board, and move history
// The browser is not the source of truth for the game.
// The server is authoritative, and the client mainly sends requests and displays
// the latest state sent back from the backend.

import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Chessboard } from "react-chessboard";

const RESULT_LABELS = {
  WHITE_WIN_CHECKMATE: "White wins by checkmate",
  BLACK_WIN_CHECKMATE: "Black wins by checkmate",
  WHITE_WIN_RESIGNATION: "White wins by resignation",
  BLACK_WIN_RESIGNATION: "Black wins by resignation",
  DRAW_STALEMATE: "Draw by stalemate",
  DRAW_INSUFFICIENT_MATERIAL: "Draw (insufficient material)",
  DRAW_THREEFOLD_REPETITION: "Draw by threefold repetition",
  DRAW: "Draw (fifty-move rule or general draw)"
};

function createMessage(type, clientMsgId, payload) {
  return {
    type,
    clientMsgId,
    payload
  };
}

function getOrCreateTabIdentity() {
  let clientId = sessionStorage.getItem("clientId");
  let playerId = sessionStorage.getItem("playerId");
  let displayName = sessionStorage.getItem("displayName");

  if (!clientId) {
    clientId = `client-${crypto.randomUUID()}`;
    sessionStorage.setItem("clientId", clientId);
  }

  if (!playerId) {
    playerId = `player-${crypto.randomUUID()}`;
    sessionStorage.setItem("playerId", playerId);
  }

  if (!displayName) {
    displayName = `Guest-${Math.floor(Math.random() * 9000) + 1000}`;
    sessionStorage.setItem("displayName", displayName);
  }

  return { clientId, playerId, displayName };
}

function getSavedGameInfo() {
  return {
    lastGameId: localStorage.getItem("lastGameId") || "",
    lastRoomName: localStorage.getItem("lastRoomName") || ""
  };
}

function App() {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
  // These values are created once per browser tab and reused after refreshes.
  const identity = useMemo(() => getOrCreateTabIdentity(), []);
  const savedGameInfo = useMemo(() => getSavedGameInfo(), []);

  const socketRef = useRef(null);
  const msgCounterRef = useRef(0);
  const bannerTimeoutRef = useRef(null);

  const [view, setView] = useState("menu");
  const [connected, setConnected] = useState(false);
  const [initialised, setInitialised] = useState(false);

  const [roomName, setRoomName] = useState(savedGameInfo.lastRoomName || "");
  const [roomPassword, setRoomPassword] = useState("");
  const [gameId, setGameId] = useState(savedGameInfo.lastGameId || "");

  const [errorMessage, setErrorMessage] = useState("");
  // This is the latest authoritative game snapshot received from the server.
  const [sessionState, setSessionState] = useState(null);
  const [bannerMessage, setBannerMessage] = useState("");

  function nextMsgId() {
    msgCounterRef.current += 1;
    return `client-msg-${msgCounterRef.current}`;
  }

  function showBanner(message) {
    setBannerMessage(message);

    if (bannerTimeoutRef.current) {
      clearTimeout(bannerTimeoutRef.current);
    }

    bannerTimeoutRef.current = setTimeout(() => {
      setBannerMessage("");
    }, 4000);
  }

  function saveLastGame(nextGameId, nextRoomName) {
    if (nextGameId) {
      localStorage.setItem("lastGameId", nextGameId);
      setGameId(nextGameId);
    }

    if (nextRoomName) {
      localStorage.setItem("lastRoomName", nextRoomName);
      setRoomName(nextRoomName);
    }
  }

  function handleInboundMessage(type, msg, options = {}) {
    const {
      clearError = true,
      syncState = false,
      saveGame = false,
      savedGameInfo = null,
      nextView = null,
      banner = "",
      error = ""
    } = options;

    if (clearError) {
      setErrorMessage("");
    }

    if (error) {
      setErrorMessage(error);
    }

    // Some events carry a full game snapshot that should replace the current UI state.
    if (syncState) {
      setSessionState(msg?.payload || null);
    }

    // Save these values so the user can resume a game later after refresh/disconnect.
    if (saveGame || savedGameInfo) {
      saveLastGame(
        savedGameInfo?.gameId ?? msg?.payload?.gameId ?? "",
        savedGameInfo?.roomName ?? msg?.payload?.roomName ?? ""
      );
    }

    if (banner) {
      showBanner(banner);
    }

    if (nextView) {
      setView(nextView);
    }
  }

  function emitSocketMessage(type, payload) {
    if (!socketRef.current) return;

    // Every outgoing protocol message gets a simple client-generated ID.
    const message = createMessage(type, nextMsgId(), payload);
    socketRef.current.emit(type, message);
  }

  useEffect(() => {
    // Open one long-lived realtime connection to the backend.
    const socket = io(serverUrl, {
      transports: ["websocket"]
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setErrorMessage("");

      // HELLO is the first protocol message and tells the server who this tab is.
      const helloMessage = createMessage("HELLO", nextMsgId(), {
        clientId: identity.clientId,
        playerId: identity.playerId
      });

      socket.emit("HELLO", helloMessage);
    });

    socket.on("disconnect", (reason) => {
      setConnected(false);
      setInitialised(false);

      if (sessionState?.gameId) {
        setErrorMessage(
          "Connection lost. Use 'Resume Previous Game' or 'Resume This Game' after reconnecting."
        );
      } else {
        setErrorMessage("Connection lost. Refresh the page to reconnect.");
      }
    });

    socket.on("WELCOME", (msg) => {
      setInitialised(true);
      handleInboundMessage("WELCOME", msg);
    });

    socket.on("GAME_CREATED", (msg) => {
      const nextRoomName = msg?.payload?.roomName || "";
      handleInboundMessage("GAME_CREATED", msg, {
        saveGame: true,
        nextView: "game",
        banner: `Room '${nextRoomName}' created. Waiting for second player...`
      });
    });

    socket.on("GAME_JOINED", (msg) => {
      const nextRoomName = msg?.payload?.roomName || "";
      handleInboundMessage("GAME_JOINED", msg, {
        saveGame: true,
        nextView: "game",
        banner: `Joined room '${nextRoomName}' successfully.`
      });
    });

    socket.on("GAME_RESUMED", (msg) => {
      handleInboundMessage("GAME_RESUMED", msg, {
        savedGameInfo: {
          gameId: msg?.payload?.gameId || gameId,
          roomName
        },
        nextView: "game"
      });
      showBanner("Game resumed successfully.");
    });

    socket.on("GAME_START", () => {
      setErrorMessage("");
      showBanner("Second player joined. The game has started.");
      setView("game");
    });

    socket.on("STATE_SYNC", (msg) => {
      handleInboundMessage("STATE_SYNC", msg, {
        syncState: true,
        saveGame: true,
        nextView: "game"
      });
    });

    socket.on("STATE_UPDATE", (msg) => {
      handleInboundMessage("STATE_UPDATE", msg, {
        syncState: true,
        saveGame: true,
        nextView: "game"
      });
    });

    socket.on("GAME_CONCLUDED", (msg) => {
      const result = msg?.payload?.result;
      handleInboundMessage("GAME_CONCLUDED", msg, {
        banner: result ? `Game concluded: ${formatResult(result)}` : "Game concluded."
      });
    });

    socket.on("MOVE_ACCEPTED", (msg) => {
      handleInboundMessage("MOVE_ACCEPTED", msg);
    });

    socket.on("MOVE_REJECTED", (msg) => {
      handleInboundMessage("MOVE_REJECTED", msg, {
        clearError: false,
        error: msg?.payload?.message || "Move rejected"
      });
    });

    socket.on("PLAYER_RECONNECTED", () => {
      showBanner("Your opponent has reconnected.");
    });

    socket.on("PLAYER_LEFT", () => {
      setErrorMessage("Opponent disconnected. They can resume using the saved game ID.");
    });

    socket.on("REMATCH_STATUS", (msg) => {
      handleInboundMessage("REMATCH_STATUS", msg, {
        clearError: false
      });

      const rematch = msg?.payload?.rematch || { white: false, black: false };

      setSessionState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rematch
        };
      });

      showBanner("Rematch requested. Waiting for opponent...");
    });

    socket.on("REMATCH_START", (msg) => {
      handleInboundMessage("REMATCH_START", msg, {
        clearError: false,
        banner: "Both players accepted. New game started."
      });
    });

    socket.on("ERROR", (msg) => {
      handleInboundMessage("ERROR", msg, {
        clearError: false,
        error: msg?.payload?.message || "An error occurred"
      });
    });

    return () => {
      if (bannerTimeoutRef.current) {
        clearTimeout(bannerTimeoutRef.current);
      }
      socket.disconnect();
    };
  }, [identity.clientId, identity.playerId, serverUrl]);

  const assignedColour =
    sessionState?.players?.white?.playerId === identity.playerId
      ? "white"
      : sessionState?.players?.black?.playerId === identity.playerId
        ? "black"
        : null;

  const isPlayersTurn =
    Boolean(sessionState) &&
    sessionState.state === "IN_PROGRESS" &&
    assignedColour !== null &&
    sessionState.turnColour === assignedColour;

  // Can only drag if the game is live, you are a player, and it is your turn.
  const canDragPieces =
    Boolean(sessionState) &&
    sessionState.state === "IN_PROGRESS" &&
    isPlayersTurn &&
    connected &&
    initialised;

  const localRematchAccepted =
    assignedColour === "white"
      ? Boolean(sessionState?.rematch?.white)
      : assignedColour === "black"
        ? Boolean(sessionState?.rematch?.black)
        : false;

  const opponentRematchAccepted =
    assignedColour === "white"
      ? Boolean(sessionState?.rematch?.black)
      : assignedColour === "black"
        ? Boolean(sessionState?.rematch?.white)
        : false;

  function formatResult(result) {
    if (!result) return "—";
    return RESULT_LABELS[result] || result;
  }

  function getStatusMessage() {
    if (!connected) return "Connecting to server...";
    if (!initialised) return "Completing handshake...";

    if (!sessionState) {
      return "Ready";
    }

    if (sessionState.state === "WAITING_FOR_PLAYERS") {
      return "Waiting for second player to join...";
    }

    if (sessionState.state === "FINISHED") {
      if (localRematchAccepted && !opponentRematchAccepted) {
        return "Rematch requested — waiting for opponent...";
      }

      if (!localRematchAccepted && opponentRematchAccepted) {
        return "Opponent requested a rematch.";
      }

      return sessionState.result
        ? `Game finished — ${formatResult(sessionState.result)}`
        : "Game finished";
    }

    if (!assignedColour) {
      return "Connected as observer";
    }

    if (isPlayersTurn) {
      return `Your turn (${assignedColour})`;
    }

    return `Waiting for ${sessionState.turnColour} to move`;
  }

  function formatMoveHistory(moveHistory) {
    if (!moveHistory || moveHistory.length === 0) return [];

    const rows = [];

    // Turn a flat move list into rows like: 1. e4 e5
    for (let i = 0; i < moveHistory.length; i += 2) {
      const moveNumber = Math.floor(i / 2) + 1;
      const whiteMove = moveHistory[i];
      const blackMove = moveHistory[i + 1];

      rows.push({
        moveNumber,
        white: whiteMove?.san || "",
        black: blackMove?.san || ""
      });
    }

    return rows;
  }

  const formattedMoves = formatMoveHistory(sessionState?.moveHistory || []);

  function handleCreateRoom() {
    if (!socketRef.current || !initialised || !roomName || !roomPassword) return;

    setErrorMessage("");
    emitSocketMessage("GAME_CREATE", {
      roomName,
      roomPassword
    });
  }

  function handleJoinRoom() {
    if (!socketRef.current || !initialised || !roomName || !roomPassword) return;

    setErrorMessage("");
    emitSocketMessage("GAME_JOIN", {
      roomName,
      roomPassword
    });
  }

  function handleResumeGame(targetGameId = gameId) {
    if (!socketRef.current || !initialised || !targetGameId) return;

    setErrorMessage("");
    emitSocketMessage("GAME_RESUME", {
      gameId: targetGameId
    });
  }

  function handleRequestRematch() {
    if (!socketRef.current || !sessionState?.gameId) return;
    if (sessionState.state !== "FINISHED") return;
    if (localRematchAccepted) return;

    setErrorMessage("");
    emitSocketMessage("REMATCH_REQUEST", {
      gameId: sessionState.gameId
    });
  }

  function handleResign() {
    if (!socketRef.current || !sessionState?.gameId) return;
    if (sessionState.state !== "IN_PROGRESS") return;
    if (!assignedColour) return;

    setErrorMessage("");
    emitSocketMessage("RESIGN", {
      gameId: sessionState.gameId
    });
  }

  function handlePieceDrop(sourceSquare, targetSquare, piece) {
    if (!socketRef.current || !sessionState) return false;
    if (!canDragPieces) return false;

    const pieceColour =
      piece?.startsWith("w") ? "white" :
      piece?.startsWith("b") ? "black" :
      null;

    if (!pieceColour || pieceColour !== assignedColour) {
      return false;
    }

    const isPromotion =
      (piece?.toLowerCase() === "wp" && targetSquare.endsWith("8")) ||
      (piece?.toLowerCase() === "bp" && targetSquare.endsWith("1"));

    // The backend expects moves in UCI format, for example "e2e4".
    const uci = isPromotion
      ? `${sourceSquare}${targetSquare}q`
      : `${sourceSquare}${targetSquare}`;

    emitSocketMessage("MOVE_SUBMIT", {
      gameId: sessionState.gameId,
      expectedRevision: sessionState.revision,
      uci
    });

    return true;
  }

  function renderMenu() {
    return (
      <div className="menu-stack">
        <button className="menu-button" onClick={() => setView("create")}>
          Create Game
        </button>

        <button className="menu-button" onClick={() => setView("join")}>
          Join Game
        </button>

        <button className="menu-button" onClick={() => setView("settings")}>
          Settings
        </button>

        {gameId && (
          <button
            className="menu-button resume-button"
            onClick={() => handleResumeGame(gameId)}
            disabled={!initialised}
          >
            Resume Previous Game
          </button>
        )}
      </div>
    );
  }

  function renderRoomForm(mode) {
    const title = mode === "create" ? "Create Room" : "Join Room";
    const actionLabel = mode === "create" ? "Create Room" : "Join Room";
    const submitAction = mode === "create" ? handleCreateRoom : handleJoinRoom;

    return (
      <div className="form-card">
        <h2>{title}</h2>

        <label>
          Room Name
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Enter room name"
          />
        </label>

        <label>
          Room Password
          <input
            type="password"
            value={roomPassword}
            onChange={(e) => setRoomPassword(e.target.value)}
            placeholder="Enter room password"
          />
        </label>

        <div className="button-row centered">
          <button
            className="action-button"
            onClick={submitAction}
            disabled={!initialised || !roomName || !roomPassword}
          >
            {actionLabel}
          </button>

          <button className="secondary-button" onClick={() => setView("menu")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  function renderSettings() {
    return (
      <div className="form-card">
        <h2>Settings</h2>
        <p>This page is reserved for later polish.</p>
        <p><strong>Display Name:</strong> {identity.displayName}</p>
        <p><strong>Client ID:</strong> {identity.clientId}</p>
        <p><strong>Player ID:</strong> {identity.playerId}</p>

        <div className="button-row centered">
          <button className="secondary-button" onClick={() => setView("menu")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  function renderGame() {
    return (
      <div className="game-layout">
        <div className="game-panel">
          <h2>Game Information</h2>
          <p><strong>Room:</strong> {roomName || "-"}</p>
          <p><strong>Game ID:</strong> {gameId || "-"}</p>
          <p><strong>You:</strong> {identity.displayName}</p>
          <p><strong>Your Colour:</strong> {assignedColour || "-"}</p>
          <p><strong>Status:</strong> {getStatusMessage()}</p>
          <p><strong>Revision:</strong> {sessionState?.revision ?? "-"}</p>
          <p><strong>Result:</strong> {formatResult(sessionState?.result)}</p>

          {errorMessage && <p className="error-text">{errorMessage}</p>}

          {sessionState?.state === "IN_PROGRESS" && assignedColour && (
            <div className="resign-box">
              <button className="action-button resign-button" onClick={handleResign}>
                Resign Game
              </button>
            </div>
          )}

          {sessionState?.state === "FINISHED" && (
            <p className="result-banner">{formatResult(sessionState.result)}</p>
          )}

          {sessionState?.state === "FINISHED" && assignedColour && (
            <div className="rematch-box">
              <p>
                <strong>Your rematch response:</strong>{" "}
                {localRematchAccepted ? "Accepted" : "Not yet accepted"}
              </p>
              <p>
                <strong>Opponent response:</strong>{" "}
                {opponentRematchAccepted ? "Accepted" : "Pending"}
              </p>

              <button
                className="action-button"
                onClick={handleRequestRematch}
                disabled={localRematchAccepted}
              >
                {localRematchAccepted ? "Rematch Requested" : "Request Rematch"}
              </button>
            </div>
          )}

          {!connected && gameId && (
            <button
              className="action-button"
              onClick={() => handleResumeGame(gameId)}
              disabled={!initialised}
            >
              Resume This Game
            </button>
          )}

          <div className="button-row">
            <button className="secondary-button" onClick={() => setView("menu")}>
              Main Menu
            </button>
          </div>
        </div>

        <div className="game-board-panel">
          <h2>Board</h2>
          <p className="board-status">
            {canDragPieces
              ? `You may move your ${assignedColour} pieces`
              : getStatusMessage()}
          </p>

          <div className="board-wrap">
            <Chessboard
              id="authoritative-board"
              position={sessionState?.fen || "start"}
              boardOrientation={assignedColour === "black" ? "black" : "white"}
              arePiecesDraggable={canDragPieces}
              animationDuration={0}
              onPieceDrop={(sourceSquare, targetSquare, piece) => {
                return handlePieceDrop(sourceSquare, targetSquare, piece);
              }}
            />
          </div>
        </div>

        <div className="game-panel">
          <h2>Move History</h2>

          {formattedMoves.length === 0 ? (
            <p>No moves yet.</p>
          ) : (
            <div className="move-list">
              {formattedMoves.map((row) => (
                <div key={row.moveNumber} className="move-row">
                  <span className="move-number">{row.moveNumber}.</span>
                  <span className="move-white">{row.white}</span>
                  <span className="move-black">{row.black}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="title-box">
        <h1>COMP3932 – Remote Chess App (v0.5)</h1>
      </div>

      <p className="connection-line">
        {connected && initialised ? "Connected" : getStatusMessage()}
      </p>

      {bannerMessage && <div className="top-banner">{bannerMessage}</div>}

      {errorMessage && view !== "game" && (
        <p className="error-text centered-text">{errorMessage}</p>
      )}

      {view === "menu" && renderMenu()}
      {view === "create" && renderRoomForm("create")}
      {view === "join" && renderRoomForm("join")}
      {view === "settings" && renderSettings()}
      {view === "game" && renderGame()}
    </div>
  );
}

export default App;