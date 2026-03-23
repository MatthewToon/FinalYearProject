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
