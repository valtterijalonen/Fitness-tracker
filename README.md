# Gym & Food Tracker

A simple mobile web app (PWA) for tracking gym progression and food. Data is stored on your phone (export backups in Settings).

- **Workout**: add exercises, log sets (kg × reps), see what you did last time, rest timer, templates.
- **Food**: calories, macros and micros. Add food by AI photo/description, Open Food Facts search, barcode, or manually.
- **Progress**: estimated 1RM / top-set charts per exercise and a 30-day calorie chart.

## Setup
1. Repo Settings → Pages → Source: **GitHub Actions**. The workflow deploys on every push to `main`.
2. Open `https://<user>.github.io/<repo>/` on your phone → Add to Home Screen.
3. For Photo AI, paste an Anthropic API key in the app's Settings.
