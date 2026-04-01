import { useMemo, useState } from "react";
import { io } from "socket.io-client";
import { Chessboard } from "react-chessboard";

function App() {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

  const [clientId, setClientId] = useState("client-1");
  const [playerId, setPlayerId] = useState("player-1");
  const [gameIdInput, setGameIdInput] = useState("");

  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [initialised, setInitialised] = useState(false);

  const [lastEvent, setLastEvent] = useState("No events yet");
  const [messages, setMessages] = useState([]);
  const [sessionState, setSessionState] = useState(null);

  const nextMsgId = useMemo(() => {
    let count = 0;
    return () => {
      count += 1;
      return `client-msg-${count}`;
    };
  }, []);

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

  function registerSocketListeners(activeSocket) {
    activeSocket.on("connect", () => {
      setConnected(true);
      setLastEvent(`Connected: ${activeSocket.id}`);
    });

    activeSocket.on("disconnect", () => {
      setConnected(false);
      setInitialised(false);
      setLastEvent("Disconnected");
    });

    activeSocket.on("WELCOME", (msg) => {
      setInitialised(true);
      setLastEvent("WELCOME received");
      appendMessage("in", "WELCOME", msg);
    });

    activeSocket.on("GAME_CREATED", (msg) => {
      setLastEvent("GAME_CREATED received");
      appendMessage("in", "GAME_CREATED", msg);

      if (msg?.payload?.gameId) {
        setGameIdInput(msg.payload.gameId);
      }
    });

    activeSocket.on("GAME_JOINED", (msg) => {
      setLastEvent("GAME_JOINED received");
      appendMessage("in", "GAME_JOINED", msg);
    });

    activeSocket.on("GAME_RESUMED", (msg) => {
      setLastEvent("GAME_RESUMED received");
      appendMessage("in", "GAME_RESUMED", msg);
    });

    activeSocket.on("GAME_START", (msg) => {
      setLastEvent("GAME_START received");
      appendMessage("in", "GAME_START", msg);
    });

    activeSocket.on("STATE_SYNC", (msg) => {
      setLastEvent("STATE_SYNC received");
      appendMessage("in", "STATE_SYNC", msg);
      setSessionState(msg.payload || null);
    });

    activeSocket.on("STATE_UPDATE", (msg) => {
      setLastEvent("STATE_UPDATE received");
      appendMessage("in", "STATE_UPDATE", msg);
      setSessionState(msg.payload || null);
    });

    activeSocket.on("MOVE_ACCEPTED", (msg) => {
      setLastEvent("MOVE_ACCEPTED received");
      appendMessage("in", "MOVE_ACCEPTED", msg);
    });

    activeSocket.on("MOVE_REJECTED", (msg) => {
      setLastEvent("MOVE_REJECTED received");
      appendMessage("in", "MOVE_REJECTED", msg);
    });

    activeSocket.on("PLAYER_LEFT", (msg) => {
      setLastEvent("PLAYER_LEFT received");
      appendMessage("in", "PLAYER_LEFT", msg);
    });

    activeSocket.on("PLAYER_RECONNECTED", (msg) => {
      setLastEvent("PLAYER_RECONNECTED received");
      appendMessage("in", "PLAYER_RECONNECTED", msg);
    });

    activeSocket.on("ERROR", (msg) => {
      setLastEvent("ERROR received");
      appendMessage("in", "ERROR", msg);
    });
  }

  function handleConnect() {
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }

    const activeSocket = io(serverUrl, {
      transports: ["websocket"]
    });

    registerSocketListeners(activeSocket);
    setSocket(activeSocket);
  }

  function handleHello() {
    if (!socket) return;

    const message = {
      type: "HELLO",
      clientMsgId: nextMsgId(),
      payload: {
        clientId,
        playerId
      }
    };

    appendMessage("out", "HELLO", message);
    socket.emit("HELLO", message);
  }

  function handleCreateGame() {
    if (!socket) return;

    const message = {
      type: "GAME_CREATE",
      clientMsgId: nextMsgId(),
      payload: {}
    };

    appendMessage("out", "GAME_CREATE", message);
    socket.emit("GAME_CREATE", message);
  }

  function handleJoinGame() {
    if (!socket || !gameIdInput) return;

    const message = {
      type: "GAME_JOIN",
      clientMsgId: nextMsgId(),
      payload: {
        gameId: gameIdInput
      }
    };

    appendMessage("out", "GAME_JOIN", message);
    socket.emit("GAME_JOIN", message);
  }

  function handleResumeGame() {
    if (!socket || !gameIdInput) return;

    const message = {
      type: "GAME_RESUME",
      clientMsgId: nextMsgId(),
      payload: {
        gameId: gameIdInput
      }
    };

    appendMessage("out", "GAME_RESUME", message);
    socket.emit("GAME_RESUME", message);
  }

  const assignedColour =
    sessionState?.players?.white?.playerId === playerId
      ? "white"
      : sessionState?.players?.black?.playerId === playerId
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
    isPlayersTurn;

  function getStatusMessage() {
    if (!connected) return "Not connected";
    if (!initialised) return "Socket connected — HELLO required";
    if (!sessionState) return "Connected — no active game loaded";

    if (sessionState.state === "FINISHED") {
      return sessionState.result
        ? `Game finished: ${sessionState.result}`
        : "Game finished";
    }

    if (!assignedColour) {
      return "Connected as observer / unassigned client";
    }

    if (isPlayersTurn) {
      return `Your turn (${assignedColour})`;
    }

    return `Waiting for ${sessionState.turnColour} to move`;
  }

  function handlePieceDrop(sourceSquare, targetSquare, piece) {
    if (!socket || !sessionState) return false;
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

    const message = {
      type: "MOVE_SUBMIT",
      clientMsgId: nextMsgId(),
      payload: {
        gameId: sessionState.gameId,
        expectedRevision: sessionState.revision,
        uci
      }
    };

    appendMessage("out", "MOVE_SUBMIT", message);
    socket.emit("MOVE_SUBMIT", message);

    return true;
  }

  return (
    <div className="app-shell">
      <h1>COMP3932 Chess App (v0.5)</h1>

      <div className="layout-grid">
        <div>
          <div className="panel">
            <h2>Connection</h2>
            <label>
              Server URL
              <input value={serverUrl} readOnly />
            </label>

            <label>
              Client ID
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </label>

            <label>
              Player ID
              <input value={playerId} onChange={(e) => setPlayerId(e.target.value)} />
            </label>

            <div className="button-row">
              <button onClick={handleConnect}>Connect Socket</button>
              <button onClick={handleHello} disabled={!connected}>
                Send HELLO
              </button>
            </div>

            <p><strong>Connected:</strong> {connected ? "Yes" : "No"}</p>
            <p><strong>Initialised:</strong> {initialised ? "Yes" : "No"}</p>
            <p><strong>Last event:</strong> {lastEvent}</p>
          </div>

          <div className="panel">
            <h2>Game Controls</h2>

            <label>
              Game ID
              <input
                value={gameIdInput}
                onChange={(e) => setGameIdInput(e.target.value)}
                placeholder="Enter or receive a game ID"
              />
            </label>

            <div className="button-row">
              <button onClick={handleCreateGame} disabled={!initialised}>
                Create Game
              </button>
              <button onClick={handleJoinGame} disabled={!initialised || !gameIdInput}>
                Join Game
              </button>
              <button onClick={handleResumeGame} disabled={!initialised || !gameIdInput}>
                Resume Game
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Game Summary</h2>
            <p><strong>Game ID:</strong> {sessionState?.gameId || "-"}</p>
            <p><strong>State:</strong> {sessionState?.state || "-"}</p>
            <p><strong>Revision:</strong> {sessionState?.revision ?? "-"}</p>
            <p><strong>Turn:</strong> {sessionState?.turnColour || "-"}</p>
            <p><strong>Result:</strong> {sessionState?.result || "-"}</p>
            <p><strong>Your Colour:</strong> {assignedColour || "-"}</p>
            <p><strong>Status:</strong> {getStatusMessage()}</p>
          </div>
        </div>

        <div>
          <div className="panel">
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
                onPieceDragBegin={(piece, sourceSquare) => {
                  console.log("drag begin:", piece, sourceSquare);
                }}
                onPieceDrop={(sourceSquare, targetSquare, piece) => {
                  return handlePieceDrop(sourceSquare, targetSquare, piece);
                }}
              />
            </div>
          </div>

          <div className="panel">
            <h2>Move History</h2>
            <pre>{JSON.stringify(sessionState?.moveHistory || [], null, 2)}</pre>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Protocol Log</h2>
        <div className="log-list">
          {messages.length === 0 && <p>No messages yet.</p>}

          {messages.map((entry) => (
            <div key={entry.id} className="log-entry">
              <div>
                <strong>{entry.direction === "out" ? "OUT" : "IN"}</strong> — {entry.type}
              </div>
              <pre>{JSON.stringify(entry.payload, null, 2)}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;