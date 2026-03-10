CREATE TABLE games (
    game_id UUID PRIMARY KEY,
    state TEXT NOT NULL,
    revision INTEGER NOT NULL,
    fen TEXT NOT NULL,
    turn_colour TEXT,
    white_player_id TEXT,
    black_player_id TEXT,
    result TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE moves (
    id SERIAL PRIMARY KEY,
    game_id UUID REFERENCES games(game_id),
    revision_applied INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    uci TEXT NOT NULL,
    san TEXT,
    fen_after TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);