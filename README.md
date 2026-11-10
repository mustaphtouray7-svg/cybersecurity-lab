# Cybersecurity Lab

A local-first, defensive security training app with three interactive simulations: phishing triage, password hygiene, and incident response. Exercises run in your browser and do not scan or contact external systems. Passwords are evaluated locally and never stored.

## Run

Requires Node.js 20 or newer. No third-party packages are needed.

```sh
npm start
```

Open `http://localhost:3000`. To use another port, set `PORT` before starting.

## Test

```sh
npm test
```

## Deploy

The included `render.yaml` defines a Node web service. It uses `npm ci` for the build and `npm start` to serve the app; the service is stateless except for static assets, and learner progress stays in browser local storage.

## Safety and privacy

- All scenarios and email artifacts are fictional.
- Password strength checks happen in the browser. The app does not send or persist the entered value.
- Progress is stored only in this browser using local storage.
- The server serves static files and applies baseline browser security headers.