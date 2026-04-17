# Final Year Project
Repository for **COMP3932 - Synoptic Project**

This project investigates the behaviour of two architectural approaches for a small-scale real-time distributed system using a two-player chess application as the case study.

The system is being implemented in two versions:

- **Monolithic architecture:** a single Node.js server process with centralised in-memory game state
- **Hybrid service-oriented / event-driven architecture:** a split design using separate services and Redis Pub/Sub

# Prerequisites
1. Install Node.js (version 24.14.0 (LTS) recommended)
    To verify installation, open a terminal and run the following commands to check version numbers:
    node -v
    npm -v
2. Install Docker Desktop - used for PostgreSQL and Redis
    To verify installation, open a temrinal and run the following commands to check version numbers:
    docker --version
    docker compose verison

# Project Setup (using Windows PowerShell)
1. Run these terminal commands:
    git clone https://github.com/MatthewToon/FinalYearProject
    cd FinalYearProject
2. Start infrastructrue services using terminal command:
    docker compose up -d
    And confirm instantiation using terminal command:
        docker ps
    Two container names should be returned:
        chess_postgres and chess_redis
3. Initialise SQL schema using terminal command:
    Get-Content infrastructure/migrations/initial_schema.sql | docker exec -i chess_postgres psql -U chess -d chess_db
    If successful, output should read:
        CREATE TABLE
        CREATE TABLE
4. Verify database tables by running terminal command:
    docker exec -it chess_postgres psql -U chess -d chess_db
    Then run:
        \dt
    Two tables should be returned:
        games
        moves
    Exit PostgreSQL with:
        \q
5. Install monolith backend dependencies:
    Navigate to correct folder:
        cd server/monolith
    Install dependencies:
        npm install
6. Configure environment variables
    Create a file named:
        server/monolith/.env
7. Configure envrionment variables (not required if gitignore omits .env):
    Create a file in server/monolith named '.env'
    Add the following content:
        PORT=3001
        =development
        CLIENT_ORIGIN=*

        DATABASE_URL=postgres://chess:chess@localhost:5433/chess_db

        PGHOST=localhost
        PGPORT=5433
        PGDATABASE=chess_db
        PGUSER=chess
        PGPASSWORD=chess

        REDIS_URL=redis://localhost:6379
7. Start the monolith backend (from /server/monolith):
    npm run dev
    If successful, terminal should return:
        'Monolith server listening on port 3001

# Verification
1. Health endpoint
    Once the server is running, test the health endpoint in a web browser:
        http://localhost:3001/health
    or in PowerShell:
        Invoke-WebRequest http://localhost:3001/health
    Exptected response (timetamp/uptime relative to user):
        {"status":"ok","service":"monolith","timestamp":"2026-03-10T15:55:22.265Z","uptime":<126.3503599>,"environment":"development"}

# Infrastructure Details:
1. PostgreSQL service runs in Docker and is exposed on:
    localhost:5433
    Connections details:
        Database: chess_db
        User: chess
        Password: chess
2. Redis also started through Docker and is exposed on:
    localhost:6379

# Render Deployment
The monolith is set up for manual Render deployment using:

- a Render Postgres database
- a Render Node web service for the monolith backend
- a Render static site for the React client

## Render Steps
1. Create a Render Postgres database.
2. Create a Render web service from this repo using:
   - branch: `feature/monolith-evaluation`
   - root directory: `server/monolith`
   - build command: `npm install`
   - start command: `npm start`
3. Add these backend environment variables:
   - `NODE_ENV=production`
   - `CLIENT_ORIGIN=*`
   - `DATABASE_URL=<Render internal Postgres URL>`
4. Apply [initial_schema.sql](/C:/Users/epixt/OneDrive%20-%20University%20of%20Leeds/Documents/GitHub/FinalYearProject/infrastructure/migrations/initial_schema.sql) to the Render Postgres database.
5. Create a Render static site from this repo using:
   - branch: `feature/monolith-evaluation`
   - root directory: `client`
   - build command: `npm install && npm run build`
   - publish directory: `dist`
6. Add the frontend environment variable:
   - `VITE_SERVER_URL=<public Render URL of the monolith service>`

## Decomposed Local Run
The service-oriented refactor lives in [server/decomposed](/C:/Users/epixt/OneDrive%20-%20University%20of%20Leeds/Documents/GitHub/FinalYearProject/server/decomposed) and currently runs as three local Node services plus Docker-hosted PostgreSQL and Redis.

1. Start infrastructure from the project root:
   - `npm run infra:up`
2. Install decomposed service dependencies:
   - `cd server/decomposed`
   - `npm install`
3. Open three PowerShell tabs from the project root and run:
   - Tab 1: `npm run decomposed:session`
   - Tab 2: `npm run decomposed:game`
   - Tab 3: `npm run decomposed:gateway`
4. Verify health endpoints:
   - [http://localhost:3001/health](http://localhost:3001/health)
   - [http://localhost:3002/health](http://localhost:3002/health)
   - [http://localhost:3003/health](http://localhost:3003/health)

### Decomposed Validation
The current phase six validation commands are:

- `npm run validate:decomposed:e2e`
- `npm run validate:decomposed:reconnect`

## Decomposed Render Start Point
The decomposed Render blueprint is stored in [render.decomposed.yaml](/C:/Users/epixt/OneDrive%20-%20University%20of%20Leeds/Documents/GitHub/FinalYearProject/render.decomposed.yaml).

It defines:

- a public gateway service
- a private session service
- a private game service
- a Key Value instance for Redis-compatible pub/sub
- a Postgres database
- a separate static client site for the decomposed deployment

The database schema still needs to be applied manually using [initial_schema.sql](/C:/Users/epixt/OneDrive%20-%20University%20of%20Leeds/Documents/GitHub/FinalYearProject/infrastructure/migrations/initial_schema.sql), just as with the monolith deployment.

## Important Notes
- The client uses `VITE_SERVER_URL`, so the browser must be pointed at the monolith's public Render URL.
- `CLIENT_ORIGIN` is currently set to `*` to keep deployment simple.
- `/health` and `/metrics` should both respond once the backend is live.
- The current Render setup is for the monolith only. The decomposed version can be added later.

## Hosted Benchmark Start Point
The hosted benchmarking notes are documented in [benchmark/README.md](/C:/Users/epixt/OneDrive%20-%20University%20of%20Leeds/Documents/GitHub/FinalYearProject/benchmark/README.md).

The repo also includes [prepareReplayGames.js](/C:/Users/epixt/OneDrive%20-%20University%20of%20Leeds/Documents/GitHub/FinalYearProject/scripts/phaseFive/prepareReplayGames.js), which converts [gamesCleaned.csv](/C:/Users/epixt/OneDrive%20-%20University%20of%20Leeds/Documents/GitHub/FinalYearProject/data/gamesCleaned.csv) into [gamesReplay.json](/C:/Users/epixt/OneDrive%20-%20University%20of%20Leeds/Documents/GitHub/FinalYearProject/data/gamesReplay.json) for replay-based testing.
