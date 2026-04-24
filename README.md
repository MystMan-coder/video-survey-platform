# Video Survey Platform

A video survey platform where users answer 5 Yes/No questions while their face is detected and video is recorded. No personal info (name, email, phone) is collected — only system data like IP, browser, and device.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, TypeScript, Tailwind CSS |
| Face Detection | MediaPipe Tasks Vision (runs in browser) |
| Video Recording | Browser `MediaRecorder` API |
| Backend | FastAPI, SQLAlchemy, Pydantic v2 |
| Database | MySQL 8.0 |
| Storage | Docker volume (files on disk, paths in DB) |
| Containers | Docker + Docker Compose |

---

## Setup

**Prerequisites:** Docker and Docker Compose installed.

```bash
git clone <your-repo-url>
cd video-survey-platform
docker-compose up -d --build
```

| Service | URL |
|---|---|
| Admin Portal | http://localhost:3000/admin |
| Survey (public) | http://localhost:3000/survey/{id} |
| Backend API | http://localhost:8000 |
| Swagger Docs | http://localhost:8000/docs |

**Default admin credentials:** username `admin`, password `Admin@765**`

---

## Admin Flow

1. Log in at `/admin`
2. Enter a survey title → **Create & Edit Questions**
3. Add exactly 5 Yes/No questions (enforced by the UI and API)
4. Click **Publish** → copy the public survey link
5. View responses per survey → **Download ZIP** for any submission

## User (Survey Taker) Flow

1. Open the public survey link
2. Grant camera permission
3. Complete 5 screens — each shows:
   - Live camera feed with real-time face detection overlay
   - Yes/No buttons (enabled **only** when exactly one face is detected and stable)
   - Progress bar (20 % per question)
4. After the 5th answer, the session video is uploaded and a **Thank You** screen appears

---

## Architecture Overview

```
Browser
│
├── Face Detection  ← MediaPipe (runs in browser, no server needed)
├── Video Recording ← MediaRecorder (320x240, 200 kbps, saved every 1s)
│
└── HTTP (Axios)
        │
        ├── POST /api/surveys/{id}/start      ← creates submission, captures metadata
        ├── POST /api/submissions/{id}/answers ← saves answer + face score
        ├── POST /api/submissions/{id}/media   ← uploads face snapshot (image) or full video
        ├── POST /api/submissions/{id}/complete ← calculates overall score, marks done
        └── GET  /api/submissions/{id}/export  ← streams ZIP archive

Backend (FastAPI)
│
├── IP → metadata  (User-Agent parsed server-side via user-agents library)
├── IP → location  (ip-api.com lookup, 3 s timeout)
└── File writes    → /app/media/{submission_id}/ (Docker volume)

MySQL 8.0
├── surveys
├── survey_questions
├── survey_submissions  (metadata: IP, browser, OS, device, location, score)
├── survey_answers      (answer, face_detected, face_score, face_image_path)
└── media_files         (path reference for video + images)
```

---

## Export ZIP Structure

`GET /api/submissions/{id}/export`

```
submission_{id}_export.zip
├── metadata.json
├── images/
│   ├── q1_face.png  …  q5_face.png
└── videos/
    └── full_session.mp4
```

`metadata.json` includes submission ID, survey ID, timestamps (UTC), IP, device, browser, OS, location, per-question responses, and overall face score.

---

## Design Decisions & Trade-offs

| Decision | Reasoning |
|---|---|
| **Single `<Webcam>` component** | Two separate webcam instances (one per step) killed the `MediaRecorder` stream when the component unmounted, producing corrupt/empty video. One always-mounted webcam solved this cleanly. |
| **MediaPipe over face-api.js** | Runs fully in WebAssembly with GPU acceleration. No server round-trips for detection. ~6 MB initial WASM download is acceptable for a survey context. |
| **Timesliced recording (`start(1000)`)** | Collects video chunks every 1 s instead of only on stop. Prevents data loss if the browser delays the final `onstop` event. |
| **SQLAlchemy `passive_deletes=True`** | MySQL's `ON DELETE CASCADE` on FKs needs `passive_deletes=True` on ORM relationships, otherwise SQLAlchemy attempts `SET NULL` before deletion, violating `NOT NULL` constraints. |
| **Video first, then complete** | `completeSubmission` is called only after the video uploads successfully — ensuring the export ZIP always contains the video. A 60 s timeout shows a visible error instead of an infinite spinner. |
| **File paths in DB, not blobs** | Binary data in the database would bloat it and make backups painful. Only relative paths are stored; files live on the volume-mounted filesystem. |
| **Unpublish-before-delete guard** | Prevents accidental deletion of surveys that have live responses. The UI enforces this — delete is blocked while a survey is published. |

---

## Assumptions

- Each survey has **exactly 5 questions** — the assignment specifies this, so it's enforced at both the API and UI level, not left flexible.
- The admin is **trusted** — mock authentication is used (localStorage flag + 1 hr session). A production system would need proper auth.
- Users have a **working webcam** — no fallback UI for webcam-less devices; the survey simply cannot proceed without camera access.
- The browser supports `MediaRecorder` with WebM/VP8 — true for all modern browsers (Chrome, Firefox, Edge). Safari is a known exception.
- Face detection model is loaded from **CDN on first use** — acceptable for an assignment; self-hosting the WASM bundle would be needed for production.
- Submission metadata (IP, UA) is captured **server-side** — the frontend never touches privacy-sensitive parsing; all metadata extraction is in `utils.py`.

---

## Known Limitations

- **Location shows "Unknown" on Docker/local networks** — `172.18.x.x` is a private Docker IP; ip-api.com cannot resolve it. Works correctly with a real public IP in production.
- **Video stored as WebM, served as `.mp4`** — the export renames the file for convention. VLC and modern browsers play it without issues.
- **Face score is fixed at 95 when a single face is detected** — MediaPipe landmark confidence is high by design; a production system would compute a richer score from blendshapes or bounding-box stability.
- **No rate limiting or auth on submission endpoints** — suitable for the assignment scope; production would need API keys or session tokens.
- **Dev-mode error badge (Next.js Turbopack)** — MediaPipe's internal TF XNNPACK info log triggers the Next.js dev overlay. It does not appear in production builds.

---

## AI Usage Policy

I used Copilot for:
- Looking up the exact SQLAlchemy `passive_deletes=True` syntax (I knew what I needed, just not the exact kwarg name)
- Checking the MediaPipe `FaceLandmarker` option names (`runningMode`, `numFaces`, etc.)
- A quick reference on Python's `zipfile.ZipFile` API while building the export endpoint

The bugs I actually had to think through — the two-webcam stream-death issue, the MySQL FK cascade misfire, the MediaRecorder timeslice decision — were debugged and designed by me. I can walk through any part of this codebase and explain why it was done that way.
