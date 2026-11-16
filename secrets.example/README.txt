Docker-Secrets für compose.yaml
===============================

1. Ordner kopieren (secrets/ ist von Git ausgeschlossen):
     PowerShell:  Copy-Item -Recurse secrets.example secrets
     Bash:        cp -r secrets.example secrets
   (README.txt in secrets/ darf liegen bleiben oder gelöscht werden.)

2. In secrets/ die drei Dateien mit echten Werten füllen – jeweils nur der Wert, eine Zeile:
     itsl_username   itslearning-Benutzername
     itsl_password   itslearning-Passwort
     mcp_api_key     zufälliger API-Key (mind. 32 Zeichen), den MCP-Clients als
                     "Authorization: Bearer <key>" senden

   API-Key erzeugen:
     bun -e "console.log(crypto.randomUUID().replaceAll('-','') + crypto.randomUUID().replaceAll('-',''))"

3. Starten:
     ITSL_BASE_URL=https://meineschule.itslearning.com docker compose up -d --build
   (PowerShell: $env:ITSL_BASE_URL="https://meineschule.itslearning.com"; docker compose up -d --build)

Hinweis Linux-Host: Compose bindet die Secret-Dateien mit den Rechten des Hosts ein.
Der Server läuft im Container als User "bun" (UID 1000) – die Dateien müssen für ihn lesbar sein:
     chmod 600 secrets/* && sudo chown 1000:1000 secrets/*
(Unter Docker Desktop für Windows/macOS ist nichts zu tun.)
