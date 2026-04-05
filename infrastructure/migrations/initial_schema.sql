CREATE TABLE games (
    game_id UUID PRIMARY KEY,

    -- Human-friendly join fields
    room_name TEXT UNIQUE NOT NULL,
    room_password TEXT NOT NULL,

    state TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    fen TEXT NOT NULL,
    turn_colour TEXT,

    white_player_id TEXT,
    black_player_id TEXT,

    white_client_id TEXT,
    black_client_id TEXT,

    white_rematch_requested BOOLEAN NOT NULL DEFAULT FALSE,
    black_rematch_requested BOOLEAN NOT NULL DEFAULT FALSE,

    result TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE moves (
    id BIGSERIAL PRIMARY KEY,
    game_id UUID NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    revision_applied INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    uci TEXT NOT NULL,
    san TEXT,
    fen_after TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (game_id, revision_applied)
);