Docker secrets for compose.yaml
===============================

1. Copy this folder (secrets/ is ignored by git and by the Docker build):
     Bash:        cp -r secrets.example secrets
     PowerShell:  Copy-Item -Recurse secrets.example secrets
   (README.txt may stay in secrets/ or be deleted.)

2. Fill the three files in secrets/ with real values – just the value, one line each:
     itsl_username   itslearning user name
     itsl_password   itslearning password
     mcp_api_key     random API key (at least 32 characters) that MCP clients send
                     as "Authorization: Bearer <key>"

   Generate an API key:
     openssl rand -hex 32
   or
     bun -e "console.log(crypto.randomUUID().replaceAll('-','') + crypto.randomUUID().replaceAll('-',''))"

   The placeholder in mcp_api_key is deliberately too short – the server refuses to start until it is replaced.

3. Start:
     ITSL_BASE_URL=https://yourschool.itslearning.com docker compose up -d
   (PowerShell: $env:ITSL_BASE_URL="https://yourschool.itslearning.com"; docker compose up -d)
   Add --build to build the image locally instead of pulling it from GHCR.

Linux hosts: Compose mounts the secret files with the host's permissions.
The server runs as user "bun" (UID 1000) inside the container – the files must be readable for it:
     chmod 600 secrets/* && sudo chown 1000:1000 secrets/*
(Nothing to do with Docker Desktop on Windows/macOS.)
