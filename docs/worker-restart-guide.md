# Worker Restart Guide

> Complete reference for the **FFmpeg worker restart system** — what graceful
> means, how the restart-and-respawn cycle works, what happens when you change
> settings mid-encoding, and how the safety checks protect your in-progress
> videos.

This guide is the canonical reference for the **Restart Worker** button in
**Settings → Encoding** and the entire restart flow it triggers. Use it
whenever something about the worker lifecycle is confusing.

---

## Table of contents

1. [Why the worker needs to restart at all](#why-the-worker-needs-to-restart-at-all)
2. [Settings that DON'T need a restart](#settings-that-dont-need-a-restart)
3. [Settings that DO need a restart](#settings-that-do-need-a-restart)
4. [What "graceful" means](#what-graceful-means)
5. [What "exits → respawns" means](#what-exits--respawns-means)
6. [Process managers (PM2 / systemd / Docker / K8s)](#process-managers-pm2--systemd--docker--k8s)
7. [The full restart flow, step by step](#the-full-restart-flow-step-by-step)
8. [What happens when you restart mid-encoding](#what-happens-when-you-restart-mid-encoding)
9. [Real-world scenario: 20 videos in queue](#real-world-scenario-20-videos-in-queue)
10. [Safety guarantees](#safety-guarantees)
11. [Manual restart (if no process manager)](#manual-restart-if-no-process-manager)
12. [Forceful restart vs graceful restart comparison](#forceful-restart-vs-graceful-restart-comparison)
13. [Architecture deep-dive](#architecture-deep-dive)
14. [Common questions](#common-questions)
15. [Troubleshooting](#troubleshooting)

---

## Why the worker needs to restart at all

Most encoding settings (bitrates, FFmpeg preset, audio bitrate, quality
concurrency) are read **fresh by the worker on every job**, so changes apply
immediately to the next video.

But **`videos_in_parallel`** (how many separate videos the worker processes
simultaneously) is locked when the Bull queue is created at worker startup.
Bull's library doesn't support changing concurrency mid-flight without risking
data loss. So to apply a new value, the worker process itself has to
restart — boot up with the new concurrency.

---

## Settings that DON'T need a restart

These all read from the database on every job. Save → next video uses the new value.

| Setting | Effect on next video |
|---------|----------------------|
| `bitrate_1080p` | New 1080p encode uses the new bitrate |
| `bitrate_720p` | New 720p encode uses the new bitrate |
| `bitrate_480p` | New 480p encode uses the new bitrate |
| `bitrate_360p` | New 360p encode uses the new bitrate |
| `audio_bitrate` | All quality variants get new audio bitrate |
| `quality_concurrency` | Number of parallel quality variants per video |
| `ffmpeg_preset` | `ultrafast`/`veryfast`/etc. preset |
| `preset_tier` | Bundle of all the above (premium/balanced/optimized/custom) |

The 10-second cache in `server/services/encoding-config.js` means there can be
up to a 10-second delay before changes propagate, but no restart is needed.

---

## Settings that DO need a restart

| Setting | Why a restart is needed |
|---------|------------------------|
| `video_concurrency` | Locked into Bull's `queue.process(N, fn)` call at worker startup. Cannot be changed mid-flight. |

That's it — only this one setting. Everything else is hot-reloadable.

---

## What "graceful" means

> **Graceful = polite shutdown that finishes current work first, then exits.**

The opposite is **forceful** / **hard kill** — kicking the worker out
immediately, mid-job, losing whatever it was doing.

### Real-world analogy

Imagine a chef in a kitchen halfway through cooking 3 dishes:

```
GRACEFUL                                FORCEFUL
────────                                ────────
"Hey chef, please wrap up               "STOP. Drop the pan. Walk out NOW."
 the dishes you're cooking,                   │
 then take a break."                          ▼
       │                              💥 3 burnt dishes thrown away
       ▼                              💥 customers angry
✓ Finishes 3 dishes                   💥 ingredients wasted
✓ Serves customers                    💥 have to start over
✓ Then leaves cleanly
```

### In our worker context

```
GRACEFUL RESTART                       FORCEFUL RESTART (NOT what we do)
────────────────                       ─────────────────
1. Restart flag set                    1. SIGKILL sent to worker
2. Worker checks flag (every 10s)      2. Process dies INSTANTLY
3. Worker calls queue.close()             ├─ FFmpeg processes orphaned
4. Bull stops accepting NEW jobs          ├─ Half-encoded videos left
5. Active FFmpeg jobs keep going          ├─ Status stuck on 'processing'
6. When all active jobs finish:           └─ Manual cleanup needed
   ├─ All segments uploaded
   ├─ Status set to 'ready'
   └─ Worker exits
7. Process manager respawns it
```

### What `videoQueue.close()` does (Bull's graceful shutdown primitive)

```js
await videoQueue.close();
```

Under the hood:

```
1. Stop polling Redis for new jobs   ◄── no new work picked up
2. Wait for active jobs to complete  ◄── current FFmpeg processes finish
3. Disconnect Redis cleanly          ◄── flushes pending DB updates
4. Resolves the promise              ◄── now safe to exit
```

The whole point: **no half-encoded videos, no lost work, no orphan files**.

---

## What "exits → respawns" means

This is about **two separate processes** working together:

```
Layer 1: WORKER PROCESS                    Layer 2: PROCESS MANAGER
(your code: server/worker.js)              (PM2, systemd, Docker, K8s)

   Running...                                  Watching worker
       │                                       │
       ▼                                       │
   Restart flag detected                       │
       │                                       │
       ▼                                       │
   queue.close() ✓                             │
       │                                       │
       ▼                                       │
   process.exit(0)  ──────────────────────►  Worker died!
                                              "Was it a clean exit (0)?"
                                              "Yes — it crashed politely"
                                              "Restart policy says: respawn"
                                                        │
                                                        ▼
                                              Spawns new node process
                                                        │
                                                        ▼
                                               New worker starts
                                               Reads new settings
                                               Begins processing again
```

### Why the worker can't restart itself

Node.js can't relaunch its own process from inside itself. When `process.exit(0)`
is called, the JavaScript runtime is done. Something **outside** the worker
has to start a new instance. That "something outside" is the **process manager**.

---

## Process managers (PM2 / systemd / Docker / K8s)

| Manager | What it does | Restart command |
|---------|--------------|-----------------|
| **PM2** | The standard for Node.js apps. `pm2 start --name worker app.js` and PM2 watches it forever | `pm2 restart videoplayer-worker` |
| **systemd** | Linux's built-in service manager. `[Service] Restart=always` does the trick | `sudo systemctl restart videoplayer-worker` |
| **Docker** | `docker run --restart=always ...` keeps containers alive | `docker restart videoplayer-worker` |
| **Kubernetes** | Pods automatically respawn if a container exits — that's k8s's whole job | `kubectl rollout restart deployment/videoplayer-worker` |

### PM2 setup (recommended for production)

```bash
# Initial setup (one time)
pm2 start server/worker.js --name videoplayer-worker
pm2 startup       # auto-start on server boot
pm2 save          # persist the process list

# After this, the dashboard's [Restart Worker] button works one-click.
```

### Concrete example with PM2

```bash
# T+0:    Worker is running (PID 12345)
# T+10s:  Worker sees restart flag, calls queue.close()
# T+15s:  Active jobs finish, worker calls process.exit(0)
# T+15s:  PM2 sees PID 12345 disappeared
# T+15s:  PM2 thinks: "exit code 0, my restart policy says auto-restart"
# T+16s:  PM2 starts new worker (PID 12346)
# T+16s:  New worker reads new settings, starts processing

$ pm2 list
┌─────┬────────────────────┬─────────┬─────────┬──────┐
│ id  │ name               │ pid     │ status  │ ↺    │
├─────┼────────────────────┼─────────┼─────────┼──────┤
│ 0   │ videoplayer-worker │ 12346   │ online  │ 1    │  ← restarted once
└─────┴────────────────────┴─────────┴─────────┴──────┘
```

---

## The full restart flow, step by step

```
1. User changes "Videos in parallel" 1 → 2
   └─► Click [Save Settings]
       └─► PUT /api/settings/encoding writes to DB
           Worker hasn't picked it up yet — still running with old value

2. User clicks [Restart Worker] button
   └─► Dashboard calls GET /api/settings/encoding/worker-status
       Returns: { activeJobs: N, waitingJobs: M, ... }

3. Dashboard shows safety modal:
   ├─ If activeJobs == 0:
   │    "No active encoding jobs. Restart the worker now?"
   └─ If activeJobs > 0:
        "⚠️ Currently encoding N videos. Restart will WAIT for them
         to finish, then restart automatically."

4. User confirms
   └─► POST /api/settings/encoding/restart-worker  (with force=true if active jobs)
       └─► Backend writes settings.worker_restart_requested_at = NOW()

5. Worker (running on a different process) polls every 10 seconds
   └─► reads worker_restart_requested_at
       └─► If timestamp > worker's own boot time:
           └─► Triggers graceful shutdown:
               ├─► videoQueue.close() — wait for active jobs
               ├─► Active FFmpeg processes finish naturally
               ├─► Final files uploaded, status set to 'ready'
               └─► process.exit(0)

6. Process manager (PM2 etc.) detects worker died with exit code 0
   └─► Restart policy says: respawn
       └─► New worker process spawned

7. New worker boots
   ├─► Records new worker_started_at timestamp in DB
   ├─► loadEncodingConfig() reads the latest video_concurrency setting
   └─► videoQueue.process(NEW_VALUE, ...) — picks up where old worker left off

8. Dashboard polls /worker-status every 4 seconds
   └─► When workerStartedAt changes (new boot time > old):
       └─► Shows "✅ Worker restarted successfully — new settings active"
```

---

## What happens when you restart mid-encoding

The restart **always waits for the currently-encoding video to finish**.
Nothing in progress is killed.

```
Scenario: Worker is 60% done encoding Video #5

  T+0:00  You click [Restart Worker]
  T+0:05  Modal: "1 video encoding, restart will wait for it" → Confirm
  T+0:06  Backend writes restart timestamp
  T+0:16  Worker poll #1 sees restart flag
  T+0:16  Worker calls queue.close() — STOPS taking new jobs
          ├─ Video #5 keeps encoding (FFmpeg already running)
          └─ Videos #6-#20 stay in Redis queue
  T+3:00  Video #5 finishes
          ├─ HLS files uploaded
          ├─ DB status = 'ready'  ✓
          └─ Bull marks job complete
  T+3:01  queue.close() promise resolves
          └─ Worker calls process.exit(0)
  T+3:02  PM2 respawns worker with new settings
  T+3:03  New worker pulls Video #6 (and #7 if parallel=2)
```

**Nothing is lost.** Video #5 ends up fully encoded with `ready` status.

---

## Real-world scenario: 20 videos in queue

You have 20 videos uploaded. Worker is processing them sequentially
(`videos_in_parallel = 1`).

### Initial state

```
Video 1   ── currently encoding (started 2 min ago)
Video 2   ── waiting in Redis queue
Video 3   ── waiting in Redis queue
...
Video 20  ── waiting in Redis queue

Worker concurrency: 1
```

### What happens when you change parallel=2 and click Restart

```
T+0:00   Change "Videos in parallel" 1 → 2 in dashboard
T+0:05   Click [Save Settings]   → DB updated, but worker still uses 1
T+0:10   Click [Restart Worker]
                │
                ▼
         Dashboard checks /worker-status
                │
                ▼
         activeJobs = 1  (Video 1 is encoding)
                │
                ▼
         Modal: "⚠️ Currently encoding 1 video. Restart will WAIT
                 for it to finish, then restart automatically."
                │
                ▼
         You click [Confirm graceful]

T+0:11   Backend writes:
         settings.worker_restart_requested_at = '2026-04-17T...'
         API returns: "Worker will drain 1 active job then restart"

T+0:21   Worker poll #1: sees restart flag
         queue.close() called — blocks new pickups
         Video 1 keeps encoding...

T+5:00   Video 1 finishes encoding
         ├─ HLS files uploaded to storage
         ├─ DB status = 'ready'
         └─ Job marked complete in Bull

T+5:00   Worker finishes its in-flight job
         queue.close() promise finally resolves
         process.exit(0)
                │
                ▼
T+5:01   PM2 detects worker died with exit 0
T+5:02   New worker boots
         loadEncodingConfig() reads DB
         videos_in_parallel = 2  ◄── new setting!
         videoQueue.process(2, ...)  ◄── now picks 2 jobs at once

T+5:03   Worker pulls Video 2 AND Video 3 from queue simultaneously
         Both start encoding in parallel
         (Bull doesn't lose Videos 2-20 — they're sitting in Redis)

T+5:03   Status:
         Video 2  ── encoding (parallel)
         Video 3  ── encoding (parallel)
         Video 4  ── waiting
         ...
         Video 20 ── waiting

Onwards: Worker plows through 2 videos at a time until queue is empty
```

### Visual diagram

```
   Video 1                   Video 2 + Video 3
   ─────────                 ───────────────────
   ← still encoding →        ← parallel encoding →
   uses OLD setting          uses NEW setting (2)
        │                              ▲
        │                              │
        ▼                              │
   ─────RESTART HAPPENS HERE──────────┘
   (worker exits & respawns)
```

The setting takes effect **at the gap between Video 1 finishing and Video 2 starting** — typically 1-2 seconds after the in-flight video completes.

### Settings effective timeline

| Time | Worker | Active jobs | Setting active |
|------|--------|-------------|----------------|
| 0:00 | Encoding V1 | V1 | parallel=1 |
| 0:10 | Encoding V1 | V1 (you click save) | parallel=1 |
| 0:11 | Encoding V1 | V1 (restart req'd) | parallel=1 |
| 0:21 | Encoding V1 | V1 (drain mode) | parallel=1 ← still |
| ... | ... | ... | ... |
| 5:00 | V1 done! | empty | parallel=1 (about to die) |
| 5:01 | Worker exits | empty | — |
| 5:02 | PM2 respawns | empty | — |
| 5:03 | Worker boots | V2 + V3 | **parallel=2** ← NOW! |
| 5:03 | Encoding 2x | V2, V3 | parallel=2 |

---

## Safety guarantees

When the dashboard says **"Worker will drain active jobs then restart"**, you get:

1. ✅ Whatever's currently encoding **will finish properly**
2. ✅ Files **will land** in storage
3. ✅ DB status **will be updated** to `ready`
4. ✅ Then the worker exits cleanly
5. ✅ Process manager **respawns** a fresh worker
6. ✅ New worker reads the latest settings
7. ✅ Continues with the next videos in the queue

Nothing gets lost. Nothing breaks. Just a brief gap (10s + however long the active jobs take) where new uploads sit in the queue waiting.

### Why this is safe

```
Bull queue lives in Redis, not in the worker.

When worker dies:
  ✓ Queue stays intact in Redis
  ✓ All N waiting videos still there
  ✓ Job state preserved

When new worker boots:
  ✓ Reconnects to Redis queue
  ✓ Picks up where the old worker left off
  ✓ No videos lost
```

This is why the restart is safe even with hundreds of videos in the pipeline — Redis holds the queue, the worker is just "the thing that processes it."

---

## Manual restart (if no process manager)

If you don't have PM2/systemd/Docker, you'll need to start the worker manually after it exits.

### Local development

You have these scripts in `package.json`:

```json
"scripts": {
  "dev":              "concurrently 'node server/index.js' 'npm run dev:dashboard' 'node server/worker.js' 'node server/migration-worker.js'",
  "worker":           "node server/worker.js",
  "migration-worker": "node server/migration-worker.js"
}
```

#### To restart just the worker

1. Find the terminal/process running `node server/worker.js`
2. Press `Ctrl+C` to stop it (it'll exit gracefully if you press once, or forcefully if you press twice)
3. Run `npm run worker` to start it again

#### Or if you started everything with `npm run dev`

1. `Ctrl+C` to stop everything
2. Run `npm run dev` again

---

## Forceful restart vs graceful restart comparison

| | GRACEFUL (our default) | FORCEFUL (NOT what we do) |
|---|---|---|
| **Trigger** | Dashboard button (our flow) | `kill -9 PID` / Server crash / Out of memory |
| **Active FFmpeg jobs** | ✓ Finishes encoding | ✗ Killed mid-encode |
| **Final storage files** | ✓ All files uploaded | ✗ Half-uploaded files left (cleaned by auto-cleanup later) |
| **DB status** | ✓ Set to 'ready' | ✗ Stuck on 'processing' (cleaned by auto-cleanup after N days) |
| **Bull queue** | ✓ Closed cleanly, no orphan locks | ✗ Connection dropped, Redis still thinks job is active |
| **Process exit** | `process.exit(0)` | `SIGKILL` or crash |
| **Time to restart** | 10s + active job duration | Instant |
| **User impact** | ✓ No videos lost, no manual cleanup | ✗ In-progress videos need re-upload, auto-cleanup catches it eventually |

---

## Architecture deep-dive

### Components involved in a restart

```
┌──────────────────────────────────────────────────────────────────┐
│  DASHBOARD (browser)                                             │
│   1. User clicks [Restart Worker]                                │
│   2. GETs worker-status to check active jobs                     │
│   3. Shows confirmation modal                                    │
│   4. POSTs restart-worker endpoint                               │
│   5. Polls worker-status every 4s to detect new boot             │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼ HTTPS
┌──────────────────────────────────────────────────────────────────┐
│  API SERVER (server/index.js → server/routes/settings.js)        │
│   1. /worker-status: queries Bull for active count               │
│   2. /restart-worker: writes timestamp to settings table         │
│   3. Returns immediately — actual restart is async               │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼ DB
┌──────────────────────────────────────────────────────────────────┐
│  POSTGRES (settings table)                                       │
│   - worker_restart_requested_at  (set by API)                    │
│   - worker_started_at            (set by worker on boot)         │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼ poll every 10s
┌──────────────────────────────────────────────────────────────────┐
│  WORKER PROCESS (server/worker.js)                               │
│   1. setInterval(_checkRestartRequest, 10000)                    │
│   2. Reads worker_restart_requested_at from DB                   │
│   3. If newer than own boot time → drain & exit                  │
│   4. videoQueue.close() waits for active FFmpeg jobs             │
│   5. process.exit(0)                                             │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼ exit 0
┌──────────────────────────────────────────────────────────────────┐
│  PROCESS MANAGER (PM2 / systemd / Docker / K8s)                  │
│   1. Detects worker process exited                               │
│   2. Restart policy = always / on-failure                        │
│   3. Spawns new node process for server/worker.js                │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                          [back to top — new worker]
```

### Database keys reference

| Key | Set by | When | Purpose |
|-----|--------|------|---------|
| `worker_restart_requested_at` | API (POST /restart-worker) | When user clicks button | Signal to worker that it should restart |
| `worker_started_at` | Worker (on boot) | Every time worker boots | Allows comparing "is restart pending?" |

### Restart pending logic

```js
const restartRequestedAt = settings.worker_restart_requested_at;
const workerStartedAt    = settings.worker_started_at;

const restartPending = restartRequestedAt
  && (!workerStartedAt
      || new Date(restartRequestedAt) > new Date(workerStartedAt));
```

If `restartRequestedAt > workerStartedAt`, the request hasn't been honored yet.
If `workerStartedAt > restartRequestedAt`, the worker has already restarted since the request — done.

---

## Common questions

### Will my settings change get lost if I forget to click Restart Worker?

No. The setting is saved to the database when you click **Save Settings**.
If you don't click Restart Worker:

- Bitrates, audio bitrate, FFmpeg preset, quality concurrency: **take effect within 10 seconds** (cache TTL) — no restart needed.
- `videos_in_parallel`: **stays inactive until next worker restart** (manual or otherwise). The setting is preserved in the DB and applies as soon as the worker restarts for any reason (e.g., server reboot, manual restart, crash).

### What if I restart twice quickly?

The second restart waits for the first one to complete. The worker only respawns
once per restart request — back-to-back requests don't cause cascading restarts.

### What if the worker is crashed/dead when I click Restart?

The button still works — it sets the restart flag in the DB. As soon as a
worker process boots (even after a manual `npm run worker`), it sees the flag
is from before its boot time and ignores it. Safe.

### Can multiple workers coexist?

Yes — Bull supports multiple worker processes pointing at the same Redis queue.
Each worker would independently poll for restart requests. The current dashboard
UI assumes a single worker; multi-worker monitoring would need a future
enhancement (worker self-registration table).

### What about the migration worker?

The Restart Worker button only restarts the **video-processing** worker. The
migration worker (storage migration jobs) is a separate process and is not
affected.

### Does restarting the API server affect encoding?

No. The API server (Express) and the worker are separate processes. Restarting
the API has no effect on currently-encoding videos.

---

## Troubleshooting

### "Worker hasn't reported back yet" after clicking Restart

**Likely cause**: No process manager configured. The worker exited but nothing
respawned it.

**Fix**: Either install PM2 (`npm i -g pm2`) and configure it, or manually run
`npm run worker` in a terminal.

### Worker keeps restarting in a loop

**Likely cause**: An old `worker_restart_requested_at` value is being read on
every boot.

**Fix**: This shouldn't happen because the worker compares the flag's timestamp
with its own boot time. If it does, manually clear the setting:

```sql
DELETE FROM settings WHERE key = 'worker_restart_requested_at';
```

### Restart is "stuck" — never completes

**Likely cause**: The active FFmpeg job is taking a very long time to finish.

**Fix**: This is expected — the graceful drain waits for the in-flight video.
For large 4K videos, this can take 30+ minutes. If you genuinely need to kill
it now (and accept losing the in-progress video), use the process manager:

```bash
# PM2
pm2 stop videoplayer-worker
pm2 start videoplayer-worker
```

The cleanup system will catch the stuck `processing` video on the next auto-cleanup pass and delete it.

### "Failed to get worker status" error

**Likely cause**: Redis is unreachable from the API server.

**Fix**: Check `REDIS_URL` in `.env` and that the Redis container is running
(`docker ps | grep redis`).

---

## Related files

| File | Role |
|------|------|
| `server/worker.js` | The worker process — polls for restart, handles graceful shutdown |
| `server/services/encoding-config.js` | Reads/writes encoding settings (bitrates, concurrency, etc.) |
| `server/routes/settings.js` | API endpoints `/encoding/worker-status` and `/encoding/restart-worker` |
| `dashboard/index.html` | UI for the Restart Worker button + status polling |
| `README.md` | Top-level docs about the Encoding tab and individual settings |
