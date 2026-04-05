import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Chessboard } from "react-chessboard";

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

  const [lastEvent, setLastEvent] = useState("Connecting...");
  const [errorMessage, setErrorMessage] = useState("");
  const [sessionState, setSessionState] = useState(null);
  const [messages, setMessages] = useState([]);
  const [bannerMessage, setBannerMessage] = useState("");

  function nextMsgId() {
    msgCounterRef.current += 1;
    return `client-msg-${msgCounterRef.current}`;
  }

  function appendMessage(direction, type, payload) {
    setMessages((prev) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        direction,
        type,
        payload
      },
      ...prev
    ]);
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

  useEffect(() => {
    const socket = io(serverUrl, {
      transports: ["websocket"]
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setLastEvent(`Connected: ${socket.id}`);
      setErrorMessage("");

      const helloMessage = createMessage("HELLO", nextMsgId(), {
        clientId: identity.clientId,
        playerId: identity.playerId
      });

      appendMessage("out", "HELLO", helloMessage);
      socket.emit("HELLO", helloMessage);
    });

    socket.on("disconnect", (reason) => {
      setConnected(false);
      setInitialised(false);
      setLastEvent(`Disconnected: ${reason || "unknown reason"}`);

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
      setLastEvent("WELCOME received");
      setErrorMessage("");
      appendMessage("in", "WELCOME", msg);
    });

    socket.on("GAME_CREATED", (msg) => {
      setLastEvent("GAME_CREATED received");
      setErrorMessage("");
      appendMessage("in", "GAME_CREATED", msg);

      const nextGameId = msg?.payload?.gameId || "";
      const nextRoomName = msg?.payload?.roomName || "";

      saveLastGame(nextGameId, nextRoomName);
      showBanner(`Room '${nextRoomName}' created. Waiting for second player...`);
      setView("game");
    });

    socket.on("GAME_JOINED", (msg) => {
      setLastEvent("GAME_JOINED received");
      setErrorMessage("");
      appendMessage("in", "GAME_JOINED", msg);

      const nextGameId = msg?.payload?.gameId || "";
      const nextRoomName = msg?.payload?.roomName || "";

      saveLastGame(nextGameId, nextRoomName);
      showBanner(`Joined room '${nextRoomName}' successfully.`);
      setView("game");
    });

    socket.on("GAME_RESUMED", (msg) => {
      setLastEvent("GAME_RESUMED received");
      setErrorMessage("");
      appendMessage("in", "GAME_RESUMED", msg);

      const nextGameId = msg?.payload?.gameId || gameId;
      saveLastGame(nextGameId, roomName);
      showBanner("Game resumed successfully.");
      setView("game");
    });

    socket.on("GAME_START", () => {
      setLastEvent("GAME_START received");
      setErrorMessage("");
      showBanner("Second player joined. The game has started.");
      setView("game");
    });

    socket.on("STATE_SYNC", (msg) => {
      setLastEvent("STATE_SYNC received");
      setErrorMessage("");
      appendMessage("in", "STATE_SYNC", msg);
      setSessionState(msg.payload || null);

      const nextGameId = msg?.payload?.gameId || "";
      const nextRoomName = msg?.payload?.roomName || "";

      saveLastGame(nextGameId, nextRoomName);
      setView("game");
    });

    socket.on("STATE_UPDATE", (msg) => {
      setLastEvent("STATE_UPDATE received");
      setErrorMessage("");
      appendMessage("in", "STATE_UPDATE", msg);
      setSessionState(msg.payload || null);

      const nextGameId = msg?.payload?.gameId || "";
      const nextRoomName = msg?.payload?.roomName || "";

      saveLastGame(nextGameId, nextRoomName);
      setView("game");
    });

    socket.on("GAME_CONCLUDED", (msg) => {
      setLastEvent("GAME_CONCLUDED received");
      setErrorMessage("");
      appendMessage("in", "GAME_CONCLUDED", msg);

      const result = msg?.payload?.result;
      if (result) {
        showBanner(`Game concluded: ${formatResult(result)}`);
      } else {
        showBanner("Game concluded.");
      }
    });

    socket.on("MOVE_ACCEPTED", (msg) => {
      setLastEvent("MOVE_ACCEPTED received");
      setErrorMessage("");
      appendMessage("in", "MOVE_ACCEPTED", msg);
    });

    socket.on("MOVE_REJECTED", (msg) => {
      setLastEvent("MOVE_REJECTED received");
      appendMessage("in", "MOVE_REJECTED", msg);
      setErrorMessage(msg?.payload?.message || "Move rejected");
    });

    socket.on("PLAYER_RECONNECTED", () => {
      setLastEvent("PLAYER_RECONNECTED received");
      showBanner("Your opponent has reconnected.");
    });

    socket.on("PLAYER_LEFT", () => {
      setLastEvent("PLAYER_LEFT received");
      setErrorMessage("Opponent disconnected. They can resume using the saved game ID.");
    });

    socket.on("REMATCH_STATUS", (msg) => {
      setLastEvent("REMATCH_STATUS received");
      appendMessage("in", "REMATCH_STATUS", msg);

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
      setLastEvent("REMATCH_START received");
      appendMessage("in", "REMATCH_START", msg);
      showBanner("Both players accepted. New game started.");
    });

    socket.on("ERROR", (msg) => {
      setLastEvent("ERROR received");
      appendMessage("in", "ERROR", msg);
      setErrorMessage(msg?.payload?.message || "An error occurred");
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

    const map = {
      WHITE_WIN_CHECKMATE: "White wins by checkmate",
      BLACK_WIN_CHECKMATE: "Black wins by checkmate",
      WHITE_WIN_RESIGNATION: "White wins by resignation",
      BLACK_WIN_RESIGNATION: "Black wins by resignation",
      DRAW_STALEMATE: "Draw by stalemate",
      DRAW_INSUFFICIENT_MATERIAL: "Draw (insufficient material)",
      DRAW_THREEFOLD_REPETITION: "Draw by threefold repetition",
      DRAW: "Draw (fifty-move rule or general draw)"
    };

    return map[result] || result;
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

    const message = createMessage("GAME_CREATE", nextMsgId(), {
      roomName,
      roomPassword
    });

    appendMessage("out", "GAME_CREATE", message);
    socketRef.current.emit("GAME_CREATE", message);
  }

  function handleJoinRoom() {
    if (!socketRef.current || !initialised || !roomName || !roomPassword) return;

    setErrorMessage("");

    const message = createMessage("GAME_JOIN", nextMsgId(), {
      roomName,
      roomPassword
    });

    appendMessage("out", "GAME_JOIN", message);
    socketRef.current.emit("GAME_JOIN", message);
  }

  function handleResumeGame(targetGameId = gameId) {
    if (!socketRef.current || !initialised || !targetGameId) return;

    setErrorMessage("");

    const message = createMessage("GAME_RESUME", nextMsgId(), {
      gameId: targetGameId
    });

    appendMessage("out", "GAME_RESUME", message);
    socketRef.current.emit("GAME_RESUME", message);
  }

  function handleRequestRematch() {
    if (!socketRef.current || !sessionState?.gameId) return;
    if (sessionState.state !== "FINISHED") return;
    if (localRematchAccepted) return;

    setErrorMessage("");

    const message = createMessage("REMATCH_REQUEST", nextMsgId(), {
      gameId: sessionState.gameId
    });

    appendMessage("out", "REMATCH_REQUEST", message);
    socketRef.current.emit("REMATCH_REQUEST", message);
  }

  function handleResign() {
    if (!socketRef.current || !sessionState?.gameId) return;
    if (sessionState.state !== "IN_PROGRESS") return;
    if (!assignedColour) return;

    setErrorMessage("");

    const message = createMessage("RESIGN", nextMsgId(), {
      gameId: sessionState.gameId
    });

    appendMessage("out", "RESIGN", message);
    socketRef.current.emit("RESIGN", message);
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

    const uci = isPromotion
      ? `${sourceSquare}${targetSquare}q`
      : `${sourceSquare}${targetSquare}`;

    const message = createMessage("MOVE_SUBMIT", nextMsgId(), {
      gameId: sessionState.gameId,
      expectedRevision: sessionState.revision,
      uci
    });

    appendMessage("out", "MOVE_SUBMIT", message);
    socketRef.current.emit("MOVE_SUBMIT", message);

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

  function renderCreateForm() {
    return (
      <div className="form-card">
        <h2>Create Room</h2>

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
            onClick={handleCreateRoom}
            disabled={!initialised || !roomName || !roomPassword}
          >
            Create Room
          </button>

          <button className="secondary-button" onClick={() => setView("menu")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  function renderJoinForm() {
    return (
      <div className="form-card">
        <h2>Join Room</h2>

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
            onClick={handleJoinRoom}
            disabled={!initialised || !roomName || !roomPassword}
          >
            Join Room
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
      {view === "create" && renderCreateForm()}
      {view === "join" && renderJoinForm()}
      {view === "settings" && renderSettings()}
      {view === "game" && renderGame()}
    </div>
  );
}

export default App;