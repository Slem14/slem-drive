# Slem Drive

Tacho, Tempolimit-Anzeige und Live-Lyrics fürs Auto — als Web-App fürs iPhone.

## Was die App kann

- **Tacho:** GPS-Geschwindigkeit in km/h mit animierter Anzeige und Gauge.
- **Tempolimit:** rundes Schild mit dem aktuellen Limit + Straßenname (Daten: OpenStreetMap).
- **Tempowarnung:** roter Rand und optional Ton, wenn du zu schnell bist (Toleranz einstellbar).
- **Spotify:** Cover, Titel, Steuerung und **live mitlaufende Lyrics** zum aktuellen Song.
- **Design:** alles anpassbar (Farben, Themes, Größen) — die Farben passen sich dem Album-Cover und der Musik an.
- **Demo-Modus:** zum Ausprobieren zu Hause, ohne GPS und ohne Spotify.

> ⚠️ **Schilder an der Straße haben immer Vorrang.** Baustellen, temporäre Limits und
> elektronische Autobahn-Anzeigen fehlen in den Kartendaten. Tempolimit-Daten:
> © OpenStreetMap-Mitwirkende. Lyrics: LRCLIB.

## Einrichtung auf dem iPhone (einmalig)

1. Die App-Adresse (GitHub-Pages-URL) in **Safari** öffnen.
2. **Teilen-Symbol → „Zum Home-Bildschirm"** tippen. Jetzt gibt es ein App-Icon,
   und die App startet im Vollbild.
3. Beim ersten „Losfahren" fragt das iPhone nach der **GPS-Berechtigung** → erlauben.

## Spotify verbinden (einmalig, ca. 5 Minuten)

1. Auf https://developer.spotify.com/dashboard einloggen (normales Spotify-Konto)
   und **„Create app"** wählen.
2. Beliebigen Namen eingeben. Bei **Redirect URI** genau die Adresse eintragen, die in der
   App unter **Einstellungen → Spotify → Redirect-URI → Kopieren** steht.
   Bei „Which API/SDKs are you planning to use?" **Web API** anhaken.
3. Nach dem Erstellen die **Client ID** kopieren und in der App unter
   **Einstellungen → Spotify → Client-ID** einfügen.
4. Im Spotify-Dashboard unter **Settings → User Management** die eigene
   Spotify-E-Mail-Adresse hinzufügen (die App läuft im „Development Mode" —
   nur eingetragene Nutzer dürfen sich anmelden).
5. In der App **„Mit Spotify verbinden"** tippen und anmelden.

**Falls der Login „hängt"** (Safari öffnet sich statt der App): Den Code von der
Safari-Seite kopieren und in der App unter **Einstellungen → Spotify →
„Login hängt?"** einfügen.

Hinweis: Die Wiedergabe-Steuerung (Play/Pause/Weiter) braucht **Spotify Premium**.
Anzeigen von Titel und Lyrics geht auch ohne.

## Tipps

- **Bildschirm bleibt an**, solange die App offen ist (Wake Lock). Falls das iPhone
  trotzdem sperrt: Einstellungen → Anzeige & Helligkeit → Automatische Sperre → Nie.
- **Wischen** nach links/rechts wechselt zwischen Tacho und Lyrics.
- **Lange aufs Display drücken** öffnet den schnellen Theme-Wechsler.
- GPS zeigt die **echte** Geschwindigkeit — der Auto-Tacho geht meist ein paar km/h vor.

## Für Entwickler

Vanilla JS (ES-Module), kein Build-Schritt. Lokal testen:

```
npx serve -l 5173 .     # dann http://localhost:5173 öffnen, Demo-Modus nutzen
npm test                # Unit-Tests (Limit-Parser, Road-Matching, LRC-Parser …)
python3 tools/make_icons.py   # Icons neu generieren
```

Deployment: GitHub Pages (Branch `main`, Root). Bei jedem Deploy die
Cache-Version in `sw.js` erhöhen (`VERSION`).
