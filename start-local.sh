#!/usr/bin/env bash
# Landkreis Heilbronn - Fahrplan KI-Analyse Start-Script
echo "========================================================="
echo "  Landkreis Heilbronn - Fahrplan KI-Analyse"
echo "  Startet lokalen Webserver auf http://localhost:3000..."
echo "========================================================="

if [ ! -d "node_modules" ]; then
  echo "Node-Module werden installiert..."
  npm install
fi

# Browser nach kurzer Verzögerung öffnen
open_browser() {
  sleep 2
  URL="http://localhost:3000"
  echo "Öffne $URL im Browser..."
  if command -v xdg-open &> /dev/null; then
    xdg-open "$URL"
  elif command -v open &> /dev/null; then
    open "$URL"
  elif command -v start &> /dev/null; then
    start "$URL"
  else
    echo "Server läuft! Bitte öffnen Sie im Browser: $URL"
  fi
}

open_browser &

# Dev Server starten
npm run dev
