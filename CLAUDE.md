# CLAUDE.md — Qubino Homey app (local fork)

Local fork of the official Qubino app for Homey Pro (upstream: https://github.com/QubinoHelp/Qubino-Homey-app,
app id `com.qubino`, Homey Apps SDK v3, Node.js, `homey-zwavedriver`). The owner (Magnus) uses it on his own
Homey Pro. Current focus: making the **3-Phase Smart Meter (ZMNHXD, driver `drivers/ZMNHXD1`)** report reliably.

**Read `docs/HANDOFF-zmnhxd1-meter-fix.md` before touching anything in `drivers/ZMNHXD1` or
`lib/QubinoDevice.js`.** It documents what was wrong, what was fixed, what has been verified on real hardware,
and what is still open. Do not re-investigate things that are marked as verified there.

## Repo layout (what matters)

- `.homeycompose/app.json` — **source of truth** for the app manifest (version, id, …). `app.json` in the root
  is **generated** (`"_comment": "This file is generated…"`); keep both in sync when bumping the version, but
  never hand-edit anything else in `app.json`.
- `drivers/<ID>/driver.compose.json` — driver manifest. For Z-Wave multichannel devices the `zwave.multiChannelNodes`
  block defines the sub-devices (Total/ph1/ph2/ph3 for ZMNHXD1), **each with its own `settings` array**.
- `drivers/<ID>/driver.settings.compose.json` — settings for the *root* device only (see gotcha 1).
- `drivers/<ID>/device.js` — device class, extends `lib/QubinoDevice.js` (extends `ZwaveDevice` from
  `homey-zwavedriver`). Shared behaviour (settings migration, multichannel association, retry logic) lives in
  `lib/QubinoDevice.js`. Constants in `lib/constants.js`.
- `.homeychangelog.json` — changelog keyed by version; add an entry for every version bump.
- `build/` — old committed build artifact, not used by the Homey CLI (which builds into `.homeybuild/`). Ignore it.
- `node_modules/homey-zwavedriver/lib/ZwaveDevice.js` — read this when reasoning about polling / reports /
  settings; several findings in the handoff come straight from it.

## Tooling & workflow

- Windows 11, PowerShell. Node.js, Git, Homey CLI (`npm i -g homey`) and Docker Desktop are installed and working.
  Docker is only a CLI prerequisite (build/validate) — the app itself always executes **on the Homey Pro**,
  both with `homey app run` and `homey app install`.
- `homey app run` — live debug session with console output, **uninstalls when you Ctrl+C**. Occasionally shows
  "Disconnected from Homey Pro"; this was investigated and is *not* caused by the meter polling.
- `homey app install` — persistent install, **no console output**. Because the app id is `com.qubino` (same as the
  App Store version) this **replaces the store-installed Qubino app** on the owner's Homey. A future App Store update
  may overwrite it again. Bump the version before installing so the running build is identifiable in the Homey app.
- `homey app validate --level publish` before any install/publish. `homey app version patch` bumps
  `.homeycompose/app.json` (+ asks for changelog); if you bump by hand, update `.homeycompose/app.json`,
  `app.json` and `.homeychangelog.json` together (see 4.1.7 / 4.1.8 entries for the pattern).
- Claude cannot run `homey app run/install` itself (needs the owner's Athom login + LAN access to the Homey Pro).
  Prepare the code, then ask the owner to run the command and paste the console output back.
- Publishing to the App Store / a Test channel is **not** possible from this fork: `com.qubino` belongs to Qubino's
  Athom account. The path to a real release is a PR to upstream.
- Repo: `C:\Users\magnu\Documents\Claude Code\homey-qubino\Qubino-Homey-app`. Remotes: `origin` = the owner's fork
  https://github.com/magnuse87/Qubino-Homey-app (push here), `upstream` = QubinoHelp/Qubino-Homey-app (fetch only).
  Commit and push to `origin main`; never push to `upstream`.

## Gotchas — learned the hard way, do not relearn

1. **Sub-device settings do not inherit.** A `"settings": [...]` array on a `multiChannelNodes` entry fully
   *replaces* the driver-level settings for that sub-device (`[]` ⇒ the sub-device has no custom settings at
   all; only Homey's own `zw_*` keys). A setting a sub-device needs (e.g. `meterPollingInterval`) must be declared
   inside each `multiChannelNodes.<n>.settings`. The root device (`3-Phase Smart Meter (ZMNHXD)`) has **no**
   meter capabilities — don't put meter settings there.
2. **`getSetting()` returns `null` (not `undefined`) for a missing key**, and `homey-zwavedriver` computes
   `pollInterval = getSetting(key) * pollMultiplication` → `null*1000 = 0` → polling silently disabled. If a
   setting were ever `undefined` you'd get `NaN`, and the guard `if (pollInterval < 1) return` does *not* catch
   `NaN` (would loop with ~0 ms delay). Keep poll settings declared with a numeric default.
3. **Debug logging is off by default.** `ZwaveDevice._debug()` only prints after `this.enableDebug()`. Absence of
   "Polling …" / "_onReport …" lines proves nothing unless debug is on. Never leave `enableDebug()` in committed
   code (it logs every incoming Z-Wave report, from every device, forever).
4. **`customSaveMessage()` in `QubinoDevice.js` returns `undefined` for most settings** → the library logs
   `Save message's return value is not an object nor a string` when debug is on. Harmless, pre-existing.
5. **Multichannel association destination must be endpoint 0 (`1.0`), not endpoint 1 (`1.1`).** With `1.1`
   (the upstream code) Homey never received unsolicited METER_REPORTs from the phase endpoints — only forced GET
   polling worked. Fixed in `lib/QubinoDevice.js` (`_configureMultiChannelReporting`) with a versioned
   `multiChannelReportingConfigured` flag (`MULTI_CHANNEL_REPORTING_CONFIG_VERSION`) so already-paired devices are
   reconfigured once. Bump that constant if the association scheme ever changes again.
6. **Line endings.** Upstream stores LF; the owner has `core.autocrlf=true` and the repo now has a `.gitattributes`
   (`* text=auto`), so `git status` should be clean. If it ever fills up with CRLF noise, use
   `git diff --ignore-all-space --stat` to see real changes. The changes vs upstream v4.1.6 (3e485e6) are committed
   as five commits on `main` (polling fix, association fix, version/changelog, lockfile, docs).
7. Physical Z-Wave association state lives **in the meter**, not in Homey. It survives app reinstalls. It can be
   inspected/changed manually in the Homey Developer Tools (tools.developer.homey.app → Z-Wave → node →
   Associations) — useful for quick experiments before changing code.
8. The meter only sends unsolicited power reports when the change exceeds parameter 40 (`powerReportingThreshold`,
   default 50 %, min 5 W) and at most every parameter 42/43 seconds. "No update" while the load is flat is normal.

## Conventions

- Keep the existing code style (ESLint config in `.eslintrc.json`, 2-space indent, single quotes, `this.log` /
  `this.error`). Comments and changelog in English.
- Small, surgical changes; this is a fork of a published app and the goal is an upstream-able PR.
- Every behaviour change to `lib/QubinoDevice.js` affects **all** Qubino multichannel devices, not just the meter —
  call that out explicitly when proposing changes.
- Prefer verifying on the owner's real hardware over speculation: ask for a `homey app run` log excerpt.
