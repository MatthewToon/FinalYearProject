# COMP3932 Remote Chess Application

This repository contains the software artefact for the COMP3932 Synoptic Project. The project compares two backend architectures for the same real-time two-player chess application:

- Monolithic architecture: one Node.js backend handles Socket.IO connections, session lifecycle, move validation, persistence, and state broadcasts.
- Service-oriented architecture: a gateway service, session service, and game service communicate through Redis while preserving the same external client protocol.

The React client is shared by both architectures. The backend remains authoritative for chess rules, turn order, revision checks, persistence, reconnection, resignation, rematch handling, and game completion.

## Repository Structure

```text
client/                           React/Vite browser client
server/monolith/                  Monolithic backend
server/decomposed/                Service-oriented backend
infrastructure/migrations/        PostgreSQL schema
scripts/                          Development and validation scripts
benchmark/locust/                 Benchmark harness used during evaluation
data/                             Cleaned chess replay dataset
docs/                             Software Requirements Specification
docker-compose.yml                Local PostgreSQL and Redis
render.yaml                       Render blueprint for monolith deployment
render.decomposed.yaml            Render blueprint for service-oriented deployment
```

## Assessor Access

The simplest way to inspect the application is through the public Render client deployments:

- Monolith: <https://fyp-client-n4z8.onrender.com/>
- Service-oriented ("decomposed") alternative: <https://fyp-chess-client-decomposed.onrender.com/>

1. Open either client URL in two browser tabs or on two separate machines.
2. In the first tab, create a room with a room name and password.
3. In the second tab, join using the same room name and password.
4. Play a short game, resign, or request a rematch to verify the main behaviours.

For the service-oriented deployment, only the gateway is public. The session and game services are private Render services.

## Windows Command Disclaimer

All development, deployment preparation, and local testing for this project were conducted on Windows machines. 
The local build instructions therefore use Windows PowerShell commands only.

## Local Build Prerequisites

- Git
- Node.js 24.x. The repository includes `.node-version` with `24.14.0`.
- npm
- Docker Desktop with Docker Compose

Check the main tools:

```powershell
node -v
npm -v
docker --version
docker compose version
```

Clone the repository:

```powershell
git clone https://github.com/MatthewToon/FinalYearProject.git
cd FinalYearProject
git checkout feature/architectural-refactor
```

## Local Infrastructure

Start PostgreSQL and Redis from the repository root:

```powershell
docker compose up -d
```

Apply the PostgreSQL schema:

```powershell
Get-Content infrastructure/migrations/initial_schema.sql | docker exec -i chess_postgres psql -U chess -d chess_db
```

If the tables already exist and a clean local database is needed:

```powershell
docker exec -i chess_postgres psql -U chess -d chess_db -c "DROP TABLE IF EXISTS moves; DROP TABLE IF EXISTS games;"
Get-Content infrastructure/migrations/initial_schema.sql | docker exec -i chess_postgres psql -U chess -d chess_db
```

Local connection details:

```text
PostgreSQL: postgres://chess:chess@localhost:5433/chess_db
Redis:      redis://localhost:6379
```

## Run the Monolithic Version Locally

A local `server/monolith/.env` file is included for assessor convenience. It contains only local Docker defaults and should be changed if different local ports or credentials are used.

Start the backend:

```powershell
cd server/monolith
npm install
npm run dev
```

Health check:

```text
http://localhost:3001/health
```

## Run the Service-Oriented Version Locally

A local `server/decomposed/.env` file is included for assessor convenience. It contains only local Docker defaults and assigns ports `3001`, `3002`, and `3003` to the gateway, session, and game services.

Install dependencies:

```powershell
cd server/decomposed
npm install
```

Open three PowerShell terminals from the repository root:

```powershell
npm run decomposed:session
```

```powershell
npm run decomposed:game
```

```powershell
npm run decomposed:gateway
```

Health checks:

```text
Gateway: http://localhost:3001/health
Session: http://localhost:3002/health
Game:    http://localhost:3003/health
```

## Run the React Client Locally

Start either backend first. Then open a new PowerShell terminal:

```powershell
cd client
npm install
npm run dev
```

Open the Vite URL shown in the terminal, normally:

```text
http://localhost:5173
```

For local runs, `VITE_SERVER_URL` is optional because the client defaults to `http://localhost:3001`.

A local `client/.env` file is included and points to `http://localhost:3001`. To point the client at a hosted backend, change `VITE_SERVER_URL` to the hosted monolith or gateway URL.

## Notes

- In a production project, `.env` files would normally be ignored and real secrets would be managed outside Git.
- The monolith and service-oriented versions expose the same external protocol, so the same client can be used with either backend.
- Benchmarking assets remain in the repository as evidence of the evaluation process, but setup focuses on hosted access and local application build only.
