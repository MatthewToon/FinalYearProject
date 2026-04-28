# Locust benchmark harness for the hosted chess monolith.
# One Locust user models one full chess game between two socket clients:
# - player A connects and sends HELLO
# - player B connects and sends HELLO
# - player A creates a room
# - player B joins the room
# - both players reach GAME_START and STATE_SYNC
# - the pair replays one legal game from data/gamesReplay.json
# Supported modes:
# - standard: normal full-game replay
# - fault: replay with a chosen connection, session, or move fault
# - stress: normal replay plus a Locust step-load shape that keeps raising users

import json
import locust.stats
import os
import time
import uuid
from pathlib import Path
from threading import Lock

import socketio
from locust import LoadTestShape, User, between, events, task

locust.stats.PERCENTILES_TO_CHART = [0.50, 0.95, 0.99]
locust.stats.MODERN_UI_PERCENTILES_TO_CHART = [0.50, 0.95, 0.99]

REPLAY_DATA_FILE = Path(__file__).resolve().parents[2] / "data" / "gamesReplay.json"
BENCHMARK_MODE = os.getenv("BENCHMARK_MODE", "standard").strip().lower()
MOVE_DELAY_SECONDS = float(os.getenv("MOVE_DELAY_SECONDS", "0.25"))
EVENT_TIMEOUT_SECONDS = float(os.getenv("SOCKET_EVENT_TIMEOUT_SECONDS", "5"))
GRACEFUL_STOP_TIMEOUT_SECONDS = float(os.getenv("GRACEFUL_STOP_TIMEOUT_SECONDS", "600"))
FAULT_SCENARIO = os.getenv("FAULT_SCENARIO", "connection").strip().lower()
FAULT_INJECTION_MOVE_INDEX = int(os.getenv("FAULT_INJECTION_MOVE_INDEX", "5"))
STRESS_STEP_USERS = int(os.getenv("STRESS_STEP_USERS", "30"))
STRESS_STEP_DURATION_SECONDS = int(os.getenv("STRESS_STEP_DURATION_SECONDS", "60"))
STRESS_MAX_USERS = int(os.getenv("STRESS_MAX_USERS", "0"))
STRESS_SPAWN_RATE = float(os.getenv("STRESS_SPAWN_RATE", "0.5"))
GAME_INDEX_LOCK = Lock()
GAME_INDEX = 0


@events.init.add_listener
def configure_graceful_stop(environment, **kwargs):
    # Tell Locust to let an in-progress game finish when Stop is pressed.
    # One Locust task represents one whole game, so using stop_timeout gives us
    # the desired behaviour without custom shutdown orchestration:
    # stop spawning new work, but allow already-running games time to conclude.

    if getattr(environment, "stop_timeout", 0.0) <= 0.0:
        environment.stop_timeout = GRACEFUL_STOP_TIMEOUT_SECONDS


def load_replay_games():
    if not REPLAY_DATA_FILE.exists():
        return []

    with REPLAY_DATA_FILE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


REPLAY_GAMES = load_replay_games()


def random_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def next_replay_game():
    global GAME_INDEX

    if not REPLAY_GAMES:
        return None

    with GAME_INDEX_LOCK:
        game = REPLAY_GAMES[GAME_INDEX % len(REPLAY_GAMES)]
        GAME_INDEX += 1
        return game


class GameSocketClient:
    def __init__(self, host: str, label: str):
        self.host = host
        self.label = label
        self.client_id = random_id(f"{label}-client")
        self.player_id = random_id(f"{label}-player")
        self.connected = False
        self.socket = None
        self.welcomed = False
        self.game_created = None
        self.game_joined = None
        self.game_started = None
        self.game_resumed = None
        self.player_reconnecteds = []
        self.state_syncs = []
        self.state_updates = []
        self.move_accepteds = []
        self.move_rejecteds = []
        self.game_concluded = []
        self.errors = []
        self._create_socket()

    def _create_socket(self):
        self.socket = socketio.Client(reconnection=False, logger=False, engineio_logger=False)

        @self.socket.event
        def connect():
            self.connected = True

        @self.socket.event
        def disconnect():
            self.connected = False

        @self.socket.on("WELCOME")
        def on_welcome(message):
            self.welcomed = message

        @self.socket.on("GAME_CREATED")
        def on_game_created(message):
            self.game_created = message

        @self.socket.on("GAME_JOINED")
        def on_game_joined(message):
            self.game_joined = message

        @self.socket.on("GAME_START")
        def on_game_start(message):
            self.game_started = message

        @self.socket.on("GAME_RESUMED")
        def on_game_resumed(message):
            self.game_resumed = message

        @self.socket.on("PLAYER_RECONNECTED")
        def on_player_reconnected(message):
            self.player_reconnecteds.append(message)

        @self.socket.on("STATE_SYNC")
        def on_state_sync(message):
            self.state_syncs.append(message)

        @self.socket.on("STATE_UPDATE")
        def on_state_update(message):
            self.state_updates.append(message)

        @self.socket.on("MOVE_ACCEPTED")
        def on_move_accepted(message):
            self.move_accepteds.append(message)

        @self.socket.on("MOVE_REJECTED")
        def on_move_rejected(message):
            self.move_rejecteds.append(message)

        @self.socket.on("GAME_CONCLUDED")
        def on_game_concluded(message):
            self.game_concluded.append(message)

        @self.socket.on("ERROR")
        def on_error(message):
            self.errors.append(message)

    def reset_runtime_state(self):
        self.welcomed = False
        self.game_created = None
        self.game_joined = None
        self.game_started = None
        self.game_resumed = None
        self.player_reconnecteds = []
        self.state_syncs = []
        self.state_updates = []
        self.move_accepteds = []
        self.move_rejecteds = []
        self.game_concluded = []
        self.errors = []

    def connect_and_hello(self):
        self.reset_runtime_state()

        if self.socket is None:
            self._create_socket()

        self.socket.connect(self.host, transports=["websocket"])

        hello_started = time.perf_counter()
        self.socket.emit("HELLO", {
            "type": "HELLO",
            "clientMsgId": random_id("msg"),
            "payload": {
                "clientId": self.client_id,
                "playerId": self.player_id
            }
        })

        deadline = time.time() + EVENT_TIMEOUT_SECONDS
        while not self.welcomed and time.time() < deadline:
            time.sleep(0.05)

        return (time.perf_counter() - hello_started) * 1000

    def emit_message(self, message_type: str, payload: dict):
        self.socket.emit(message_type, {
            "type": message_type,
            "clientMsgId": random_id("msg"),
            "payload": payload
        })

    def latest_revision(self):
        if self.state_updates:
            return self.state_updates[-1].get("payload", {}).get("revision")

        if self.state_syncs:
            return self.state_syncs[-1].get("payload", {}).get("revision")

        return None

    def disconnect(self):
        if self.socket.connected:
            self.socket.disconnect()
        self.socket = None


def record_socket_result(name, response_time, exception=None):
    events.request.fire(
        request_type="socketio",
        name=name,
        response_time=response_time,
        response_length=0,
        exception=exception
    )


def record_socket_error(name, message):
    record_socket_result(name, 0, Exception(message))


def wait_for(predicate, timeout_seconds=EVENT_TIMEOUT_SECONDS):
    deadline = time.time() + timeout_seconds

    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.05)

    return False


class ChessGamePairUser(User):
    wait_time = between(1, 2)

    def on_start(self):
        self.player_a = GameSocketClient(self.environment.host, "locust-a")
        self.player_b = GameSocketClient(self.environment.host, "locust-b")

    def on_stop(self):
        self.player_a.disconnect()
        self.player_b.disconnect()

    @task
    def play_replay_game(self):
        game = next_replay_game()

        if not game:
            record_socket_error("REPLAY_DATA", "gamesReplay.json is missing or empty")
            return

        room_name = random_id("locust-room")
        room_password = random_id("locust-pass")

        hello_a_ms = self.player_a.connect_and_hello()
        record_socket_result(
            "HELLO_A",
            hello_a_ms,
            None if self.player_a.welcomed else Exception("WELCOME not received for player A")
        )

        hello_b_ms = self.player_b.connect_and_hello()
        record_socket_result(
            "HELLO_B",
            hello_b_ms,
            None if self.player_b.welcomed else Exception("WELCOME not received for player B")
        )

        create_started = time.perf_counter()
        self.player_a.emit_message("GAME_CREATE", {
            "roomName": room_name,
            "roomPassword": room_password
        })

        wait_for(lambda: self.player_a.game_created is not None)

        create_exception = None if self.player_a.game_created else Exception("GAME_CREATED not received")
        record_socket_result("GAME_CREATE", (time.perf_counter() - create_started) * 1000, create_exception)

        game_id = None
        if self.player_a.game_created:
            game_id = self.player_a.game_created.get("payload", {}).get("gameId")

        join_started = time.perf_counter()
        self.player_b.emit_message("GAME_JOIN", {
            "roomName": room_name,
            "roomPassword": room_password
        })

        wait_for(
            lambda: self.player_b.game_joined is not None
            and self.player_a.game_started is not None
            and len(self.player_b.state_syncs) > 0
        )

        join_exception = None
        if not self.player_b.game_joined:
            join_exception = Exception("GAME_JOINED not received")
        elif not self.player_a.game_started:
            join_exception = Exception("GAME_START not received")
        elif len(self.player_b.state_syncs) == 0:
            join_exception = Exception("STATE_SYNC not received after join")

        record_socket_result("GAME_JOIN_AND_START", (time.perf_counter() - join_started) * 1000, join_exception)

        if join_exception:
            self.player_a.disconnect()
            self.player_b.disconnect()
            return

        expected_revision = self.player_b.latest_revision()
        if expected_revision is None:
            expected_revision = 0

        if BENCHMARK_MODE == "fault" and FAULT_SCENARIO == "session":
            session_exception = self.run_session_fault(game_id, expected_revision)
            if session_exception:
                self.player_a.disconnect()
                self.player_b.disconnect()
                return

        for index, uci in enumerate(game.get("moves", [])):
            if (
                BENCHMARK_MODE == "fault"
                and FAULT_SCENARIO == "connection"
                and index == FAULT_INJECTION_MOVE_INDEX
            ):
                reconnect_exception = self.run_connection_fault(game_id, expected_revision)
                if reconnect_exception:
                    break

            if (
                BENCHMARK_MODE == "fault"
                and FAULT_SCENARIO == "move"
                and index == FAULT_INJECTION_MOVE_INDEX
            ):
                move_fault_exception = self.run_move_fault(game_id, expected_revision, uci)
                if move_fault_exception:
                    break
                expected_revision += 1
                if MOVE_DELAY_SECONDS > 0:
                    time.sleep(MOVE_DELAY_SECONDS)
                continue

            active_player = self.player_a if index % 2 == 0 else self.player_b
            accepted_count = len(active_player.move_accepteds)
            rejected_count = len(active_player.move_rejecteds)
            target_revision = expected_revision + 1
            move_started = time.perf_counter()

            active_player.emit_message("MOVE_SUBMIT", {
                "gameId": game_id,
                "expectedRevision": expected_revision,
                "uci": uci
            })

            move_completed = wait_for(
                lambda: len(active_player.move_accepteds) > accepted_count
                and (
                    self.player_a.latest_revision() == target_revision
                    or self.player_b.latest_revision() == target_revision
                )
            )

            move_exception = None
            if len(active_player.move_rejecteds) > rejected_count:
                rejection = active_player.move_rejecteds[-1].get("payload", {})
                move_exception = Exception(rejection.get("code", "MOVE_REJECTED"))
            elif not move_completed:
                move_exception = Exception(f"Move {index + 1} did not complete in time")

            record_socket_result("MOVE_SUBMIT", (time.perf_counter() - move_started) * 1000, move_exception)

            if move_exception:
                break

            expected_revision = target_revision

            if MOVE_DELAY_SECONDS > 0:
                time.sleep(MOVE_DELAY_SECONDS)

        conclusion_started = time.perf_counter()
        game_concluded = wait_for(
            lambda: len(self.player_a.game_concluded) > 0 or len(self.player_b.game_concluded) > 0,
            1.5
        )
        record_socket_result(
            "GAME_CONCLUDED",
            (time.perf_counter() - conclusion_started) * 1000,
            None if game_concluded else Exception("GAME_CONCLUDED not received")
        )
        self.player_a.disconnect()
        self.player_b.disconnect()

    def run_connection_fault(self, game_id, expected_revision):
        disconnect_started = time.perf_counter()
        self.player_b.disconnect()
        record_socket_result("FAULT_DISCONNECT", (time.perf_counter() - disconnect_started) * 1000, None)

        hello_ms = self.player_b.connect_and_hello()
        record_socket_result(
            "FAULT_RECONNECT_HELLO",
            hello_ms,
            None if self.player_b.welcomed else Exception("WELCOME not received after reconnect")
        )

        resume_started = time.perf_counter()
        self.player_b.emit_message("GAME_RESUME", {
            "gameId": game_id
        })

        resumed = wait_for(
            lambda: self.player_b.game_resumed is not None and len(self.player_b.state_syncs) > 0
        )

        resume_exception = None
        if not resumed:
            resume_exception = Exception("GAME_RESUMED or STATE_SYNC not received after reconnect")
        else:
            resumed_revision = self.player_b.latest_revision()
            if resumed_revision is not None and resumed_revision != expected_revision:
                resume_exception = Exception(
                    f"Resumed revision {resumed_revision} did not match expected revision {expected_revision}"
                )

        record_socket_result("FAULT_RESUME", (time.perf_counter() - resume_started) * 1000, resume_exception)
        return resume_exception

    def run_session_fault(self, game_id, expected_revision):
        assigned_colour = None
        if self.player_b.game_joined:
            assigned_colour = self.player_b.game_joined.get("payload", {}).get("assignedColour")

        disconnect_started = time.perf_counter()
        self.player_b.disconnect()
        record_socket_result(
            "FAULT_SESSION_DISCONNECT",
            (time.perf_counter() - disconnect_started) * 1000,
            None
        )

        hello_ms = self.player_b.connect_and_hello()
        record_socket_result(
            "FAULT_SESSION_RECONNECT_HELLO",
            hello_ms,
            None if self.player_b.welcomed else Exception("WELCOME not received after session reconnect")
        )

        resume_started = time.perf_counter()
        self.player_b.emit_message("GAME_RESUME", {
            "gameId": game_id
        })

        resumed = wait_for(
            lambda: self.player_b.game_resumed is not None and len(self.player_b.state_syncs) > 0
        )

        resume_exception = None
        if not resumed:
            resume_exception = Exception("GAME_RESUMED or STATE_SYNC not received in session fault")
        else:
            resumed_payload = self.player_b.game_resumed.get("payload", {})
            resumed_revision = self.player_b.latest_revision()
            if resumed_payload.get("gameId") != game_id:
                resume_exception = Exception("Session resume returned a different gameId")
            elif assigned_colour and resumed_payload.get("assignedColour") != assigned_colour:
                resume_exception = Exception("Assigned colour changed after session resume")
            elif resumed_revision is not None and resumed_revision != expected_revision:
                resume_exception = Exception(
                    f"Session resumed at revision {resumed_revision} instead of {expected_revision}"
                )

        record_socket_result(
            "FAULT_SESSION_RESUME",
            (time.perf_counter() - resume_started) * 1000,
            resume_exception
        )
        return resume_exception

    def run_move_fault(self, game_id, expected_revision, correct_uci):
        active_player = self.player_a if expected_revision % 2 == 0 else self.player_b
        rejected_count = len(active_player.move_rejecteds)

        stale_started = time.perf_counter()
        stale_revision = expected_revision - 1 if expected_revision > 0 else expected_revision + 1
        active_player.emit_message("MOVE_SUBMIT", {
            "gameId": game_id,
            "expectedRevision": stale_revision,
            "uci": correct_uci
        })

        rejected = wait_for(lambda: len(active_player.move_rejecteds) > rejected_count)
        stale_exception = None if rejected else Exception("Stale revision move was not rejected")
        record_socket_result(
            "FAULT_MOVE_REJECTED",
            (time.perf_counter() - stale_started) * 1000,
            stale_exception
        )

        if stale_exception:
            return stale_exception

        accepted_count = len(active_player.move_accepteds)
        recovery_started = time.perf_counter()
        target_revision = expected_revision + 1
        active_player.emit_message("MOVE_SUBMIT", {
            "gameId": game_id,
            "expectedRevision": expected_revision,
            "uci": correct_uci
        })

        recovered = wait_for(
            lambda: len(active_player.move_accepteds) > accepted_count
            and (
                self.player_a.latest_revision() == target_revision
                or self.player_b.latest_revision() == target_revision
            )
        )
        recovery_exception = None if recovered else Exception("Correct move did not recover after rejection")
        record_socket_result(
            "FAULT_MOVE_RECOVERY",
            (time.perf_counter() - recovery_started) * 1000,
            recovery_exception
        )
        return recovery_exception


if BENCHMARK_MODE == "stress":
    class IncrementalStressShape(LoadTestShape):
        # Built-in step stress profile.
        # This is only registered when BENCHMARK_MODE=stress. That keeps the
        # normal Locust UI editable for the standard and fault modes.

        def tick(self):
            run_time = self.get_run_time()
            current_step = int(run_time // STRESS_STEP_DURATION_SECONDS) + 1
            user_count = current_step * STRESS_STEP_USERS

            if STRESS_MAX_USERS > 0 and user_count > STRESS_MAX_USERS:
                return None

            return user_count, STRESS_SPAWN_RATE
