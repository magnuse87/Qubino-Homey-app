# Handoff: 3-Phase Smart Meter (ZMNHXD1) reliability fix

Status as of 2026-09-22. Update the same evening: all changes below are now committed and pushed to
https://github.com/magnuse87/Qubino-Homey-app (`main`, on top of upstream 3e485e6). The owner reports stable
operation since July 2026, **but the last build in the original `.homeybuild/` is 4.1.7** (built 2026-07-01 23:14:
polling fix + association retry logic, association payload still `1.1`). The 4.1.8 source edits (endpoint `1.0` +
versioned flag) are dated 2026-07-02 08:59 and were never built or installed. So what runs on the owner's Homey is
4.1.7 plus the manual `1.0` association from Developer Tools; open item 1 below is still genuinely open.
Written for whoever (human or Claude Code) continues this work.
Companion to `CLAUDE.md` in the repo root — read that first for tooling and gotchas.

## 1. The problem

The Qubino 3-Phase Smart Meter (ZMNHXD, driver `drivers/ZMNHXD1`) is a Z-Wave multichannel node. In Homey it
appears as **five devices**: the root device `3-Phase Smart Meter (ZMNHXD)` (only capability `button.reset_meter`)
plus four sub-devices generated from `multiChannelNodes` in `driver.compose.json`: `1` = Total (renamed by the
owner to "Strømmåler bergvarmepumpe"), `2` = ph1, `3` = ph2, `4` = ph3. All meter capabilities
(`measure_power`, `measure_voltage`, `measure_current`, `meter_power.import/export`, `powerReactive`,
`powerTotalReactive`, `powerTotalApparent`, `powerFactor`) live on the sub-devices.

Two related symptoms, both long-standing in the upstream app:

- **A. Values get stuck** and stop updating until the app is restarted. The owner worked around this for a long
  time with a Flow that restarts the app every 5 minutes.
- **B. Unsolicited (spontaneous) reports from the meter never reached Homey.** Verified on 2026-07-01: a load step
  from 10 W to 1600 W, clearly visible on the meter's own display, produced no report in Homey. Only explicit
  GET requests initiated by Homey got answers.

## 2. What has been changed (committed on `main`, on top of upstream 3e485e6 "Bump version to v4.1.6")

| # | File | Change | Verified on hardware? |
|---|------|--------|-----------------------|
| 1 | `lib/QubinoDevice.js` | Retry logic around multichannel association configuration (`_configureMultiChannelReportingWithRetry`, 3 attempts, 2 s apart). The "configured" flag is only persisted on success. Pre-dates this session. | Runs without error. Retry path itself not exercised. |
| 2 | `drivers/ZMNHXD1/device.js` | All meter capabilities registered with `getOpts: { pollInterval: 'meterPollingInterval', pollMultiplication: 1000 }` → periodic forced METER_GET per capability. | **Yes** — "Polling commandClassId 'METER' …" lines every N s per device, values returned, no disconnects (tested at 60 s for ~15 min, then 900 s). |
| 3 | `drivers/ZMNHXD1/driver.compose.json` | `meterPollingInterval` setting (number, seconds, default 900, 0 = off, min 0, max 86400) added to **each of the four** `multiChannelNodes.<n>.settings` arrays (previously `[]`). | **Yes** — `[DIAG]` log showed the sub-devices had `meterPollingInterval=null` before and 900/60 after. |
| 4 | `drivers/ZMNHXD1/driver.settings.compose.json` | `meterPollingInterval` was briefly added here (root device) and then **removed again** — net zero diff. The root has no meter capabilities, so a poll setting there does nothing. | n/a |
| 5 | `lib/QubinoDevice.js` | `_configureMultiChannelReporting()`: `MULTI_CHANNEL_ASSOCIATION_SET` payload changed from `[1, 0x00, 1, 1]` (node 1, endpoint 1 → `1.1`) to `[1, 0x00, 1, 0]` (node 1, endpoint 0 → `1.0`); `zw_group_1` display value updated accordingly. | **Yes, manually**: the owner changed the association from 1.1 to 1.0 in Homey Developer Tools and spontaneous reports started arriving immediately. **The code path itself has not yet been run on hardware** (see §5). |
| 6 | `lib/QubinoDevice.js` | `multiChannelReportingConfigured` now stores a scheme version (`MULTI_CHANNEL_REPORTING_CONFIG_VERSION = 2`) instead of `true`; `_configureReporting()` reconfigures when the stored value `!== 2`. Legacy `true` therefore triggers a one-time reconfiguration to `1.0` on next `onNodeInit`. | **No** — needs the next `homey app install` (§5). |
| 7 | `.homeycompose/app.json`, `app.json`, `.homeychangelog.json` | Version 4.1.6 → 4.1.7 (polling fix) → **4.1.8** (association fix), with changelog entries. | n/a |

`package-lock.json` also differs (from `npm install`); not a deliberate change.

Temporary diagnostic code (`enableDebug()` + a `[DIAG]` log line in `registerCapabilities()`) was added during the
investigation and **has been removed again**. `git diff -w drivers/ZMNHXD1/device.js` should show only the
`meterPollOpts` change.

## 3. Root causes found (with evidence)

### 3.1 Symptom A — the forced refresh never ran on the devices that needed it

The upstream `driver.compose.json` has `"settings": []` on every `multiChannelNodes` entry. Homey treats that
array as a full *override*: the sub-devices get **no** driver-level settings. Diagnostic output on 2026-07-01:

```
[DIAG] device='3-Phase Smart Meter (ZMNHXD)' isRootNode=true  meterPollingInterval=300 allSettings={…, "relayPowerOnDelay":0, …, "multiChannelReportingConfigured":true, "meterPollingInterval":300}
[DIAG] device='Strømmåler bergvarmepumpe'   isRootNode=false meterPollingInterval=null allSettings={"zw_group_1":"1","zw_application_version_1":"2","zw_application_sub_version_1":"2"}
[DIAG] device='3-Phase Smart Meter (ZMNHXD) - ph3' isRootNode=false meterPollingInterval=null allSettings={…same three zw_ keys…}
```

So the setting existed only on the root (which polls nothing), and on the sub-devices
`homey-zwavedriver` computed `null * 1000 = 0` and disabled polling (`if (pollInterval < 1) return`). Changing the
root's value between 900/0/30 therefore had **no effect at all** — the earlier "polling causes `homey app run` to
disconnect" theory was a coincidence and is **disproven**. Fix = change #3 above.

Relevant library code: `node_modules/homey-zwavedriver/lib/ZwaveDevice.js`, `_setPollInterval()` and the
`pollInterval` handling around line 383–425, `onSettings()` around line 166–233.

### 3.2 Symptom B — wrong multichannel association destination endpoint

Upstream sets association group 1 to node 1 **endpoint 1** (`1.1`). The controller (Homey, node 1) has no
endpoint 1, so the meter's unsolicited MULTI_CHANNEL-encapsulated reports were never delivered/handled. Direct
GET/REPORT round-trips are unaffected by the association table, which is exactly why polling worked and
spontaneous reports did not. Changing the association to node 1 **endpoint 0** (`1.0`, the root/lifeline
endpoint) via Homey Developer Tools made the phase devices update spontaneously right away.

Same device, same problem class, documented for other hubs:
- Home Assistant thread (both the 2020 OpenZWave fix using instance 1 and the 2023 zwave-js fix using the root
  endpoint): https://community.home-assistant.io/t/qubino-3-phase-meter-zmnhxdx-not-receiving-data-for-all-endpoints-single-multi-channel-lifeline-fix/248123
- Qubino support article (OpenZWave era): https://support.qubino.com/support/solutions/articles/44002125819-home-assistant-setting-mc-multi-channel-lifeline

Note: `_configureReporting()` only runs on the device instance where `numberOfMultiChannelNodes > 0`, i.e. the
**root**, and only when `multiChannelConfigurationDisabled` is false. The association is device-wide.

## 4. Dead ends (don't repeat)

- "Polling floods the Z-Wave queue and kills the `homey app run` bridge" — no; polling wasn't running. The
  bridge occasionally disconnects on its own (community reports of the dev tools going "offline" when Homey is busy).
- "`undefined * 1000 = NaN` bypasses the `< 1` guard and creates a tight loop" — real code hazard, but not what
  happened here; `getSetting()` returns `null`, not `undefined`.
- "It works under Docker but not on Homey" — for Homey Pro both `homey app run` and `homey app install` execute
  on the Homey itself; the difference was only that `install` hides the console.
- Adding `meterPollingInterval` to `driver.settings.compose.json` (root) — pointless, see §3.1.

## 5. Open items / next steps (in order)

1. **Verify change #5/#6 end-to-end.** ✅ DONE 2026-09-26 with `homey app run --remote` (4.1.9): root logged
   `configure multi channel reporting` → `multi channel association configured`, `multiChannelReportingConfigured` went
   `true` → `2`, `zw_group_1` = `1.0`, no errors. Original text kept below for reference.
   Original: `homey app validate --level publish`, then `homey app install` (version
   4.1.8). Expected on first start: root device logs `configure multi channel reporting` → `multi channel
   association configured`; afterwards Developer Tools should show group 1 = `1.0` **without** the owner setting it
   manually, and `multiChannelReportingConfigured` should read `2`. Ideally test on a device whose association is
   still `1.1` (the owner already fixed his meter by hand, so on his Homey the visible effect is only the flag/log).
   If there is no such device, temporarily set the association back to `1.1` in Developer Tools, reinstall, and
   confirm the app corrects it.
2. **Blast radius check.** `_configureMultiChannelReporting()` is shared by every Qubino device that exposes
   multichannel endpoints (manifest `multiChannelNodes` in ZMNHBA2, ZMNHBD1, ZMNHXD1, ZMNKAD; at runtime any node
   with `MultiChannelNodes`, unless the driver sets `multiChannelConfigurationDisabled`). All of them will be
   re-associated from `1.1` to `1.0` once. Endpoint 0 is the spec-correct lifeline destination, but confirm other
   multichannel Qubino devices on the owner's Homey still report after the update. If anything regresses, scope
   the new payload to ZMNHXD1 (e.g. an overridable getter on `QubinoDevice`).
3. **Soak test.** Owner reports stable operation with `meterPollingInterval` at 900 s since July 2026 (2026-09-22),
   on the 4.1.7 build (see status note at the top). The 4.1.8 association code has not been soak-tested. Confirm the "restart
   the app every 5 minutes" Flow can be disabled/deleted. Watch for stuck values.
4. **Commit.** Done 2026-09-22: commits on `main` for polling fix + settings, association fix + versioned flag,
   version/changelog, package-lock and docs, plus `.gitattributes`. Pushed to the owner's fork (see §7).
5. **Upstream PR** to https://github.com/QubinoHelp/Qubino-Homey-app once 1–3 are green. The changelog entries for
   4.1.7 and 4.1.8 are a reasonable PR description; link the Home Assistant thread as prior art. Only Qubino can
   publish `com.qubino` to the App Store.
6. Nice-to-haves, not started: hide `meterPollingInterval` on the root device entirely (already removed from
   `driver.settings.compose.json`, so nothing to do unless it reappears); consider a small random start offset for
   the poll timers (currently they are naturally staggered by ~12 s per device because `onNodeInit` timing differs,
   which has been sufficient); `customSaveMessage()` could return `undefined` explicitly or a default message to
   silence the harmless debug warning.

## 6. How to debug this device quickly

- Temporarily add to `registerCapabilities()` in `drivers/ZMNHXD1/device.js` (and remove before committing):
  ```js
  this.enableDebug();
  this.log(`[DIAG] device='${this.getName()}' isRootNode=${this._isRootNode()} `
    + `meterPollingInterval=${this.getSetting('meterPollingInterval')} allSettings=${JSON.stringify(this.getSettings())}`);
  ```
- Then `homey app run` and watch for `[DIAG]`, `Polling commandClassId 'METER' for capabilityId '…'`,
  `_onReport() -> <capability>, METER -> parsed payload: …`. A report line **without** a preceding `Polling` line
  for the same device/capability is an unsolicited report — but the pasted log may simply be missing the
  `Polling` line, so only trust a load step you triggered yourself.
- Force a spontaneous report: change the load on one phase by well over 50 % (parameter 40) and more than 5 W.
- Association state: tools.developer.homey.app → Z-Wave → node → Associations (group 1 should read `1.0`).
- Device parameters seen on the owner's meter: `powerReportingThreshold` 50 (%), `powerReportingInterval` 600 s,
  `powerReportingIntervalQ2` 0, inputs disabled, relays disabled.

## 7. Owner's environment

Windows 11, PowerShell; Node 22, Homey CLI, Docker Desktop installed; Homey Pro on the LAN; Athom account
logged in via `homey login`. GitHub CLI (`gh`) installed and logged in as magnuse87.
Repo at `C:\Users\magnu\Documents\Claude Code\homey-qubino\Qubino-Homey-app` (the earlier `C:\WORKSPACE\Homey\...`
copy no longer exists; history was rebuilt from upstream 3e485e6 + the handoff zip). Branch `main`, remotes
`origin` = https://github.com/magnuse87/Qubino-Homey-app (fork, push target), `upstream` = QubinoHelp/Qubino-Homey-app.
Language: the owner writes Norwegian; code, comments and changelog are in English.

## 8. 4.1.9 (2026-09-26): Homey Energy role and grid type — VERIFIED on hardware, installed

Two owner requests, implemented in `drivers/ZMNHXD1/device.js` + `driver.compose.json`, validated with
`homey app validate --level publish`, not yet installed.

**Homey Energy.** Root cause: `"energy": { "cumulative": true }` in the driver manifest applied to all five devices,
so Homey Energy treated the meter as the home's main meter ("whole_house_meter") and never as a consumer; the three
phase devices were main meters too. Fix: manifest block removed; the Total device gets a `meterRole` dropdown
(`home` = cumulative main meter, the upstream default; `appliance` = regular consumer) and the energy object is set
at runtime with `Device.setEnergy()` (Homey ≥ 12.6.1, owner has 13.5). Root and phase devices get `{}`.
Homey has no API to exclude a device from Energy, so ph1–ph3 (class `socket`, `measure_power`) still show up as
consumers; the owner can toggle "Exclude from Energy" on each of them manually.

**Grid type.** The owner's meter is wired L1/L2/L3 with the N terminal unused (Norwegian 230 V IT). All three phase
devices show ~135 V, i.e. 230/√3 against the meter's artificial neutral point. By Blondel's theorem the sums on
the Total device (W, kWh import/export, kvar) are correct; per-phase voltage, power, reactive power and power factor
are reference-dependent artefacts (even a purely resistive load shows PF ≤ 0.87 per phase). Per-phase current is
correct (CTs are in the lines). With Qubino's official no-neutral wiring (one phase on the N terminal, one L input
unused; support article 44001707366) per-phase current is wrong as well. Hence `gridType` on each phase device:
`tn` (hide nothing), `it_3wire` (hide voltage, power, reactive, PF), `it_aron` (hide all five). Hiding uses
`setCapabilityOptions(cap, { uiComponent: null, preventInsights: true })`, so Flows/Insights keep working; `tn`
restores `uiComponent: 'sensor'`.

**Verification 2026-09-26 (all passed, `homey app run --remote` then `homey app install`, app 4.1.9 running):**
- Init: Total logged `energy object set to {"cumulative":true,…}` (default role), root and phases got `{}`
  (they were all `cumulative: true` before, confirmed via `GET /api/manager/devices/device/` → `energyObj`).
- Settings changed through the API (`PUT /api/manager/devices/device/<id>/settings`, body = the settings object
  itself, e.g. `{"gridType":"it_3wire"}`): Total `meterRole=appliance` → energy object became
  `{meterPowerImportedCapability, meterPowerExportedCapability}`; phases `gridType=it_3wire` → log
  `capability measure_voltage is now hidden (grid type it_3wire)` ×4 per device and `ui.components` of the device
  shrank to `['measure_current']`. Switching ph3 back to `tn` restored all five, and back to `it_3wire` hid them again.
  So `uiComponent: null` via `setCapabilityOptions()` IS honoured at runtime.
- Owner's devices are now: Total = `appliance`, ph1–ph3 = `it_3wire`; ph1–ph3 already had "Exclude from Energy"
  (`energy_exclude: true`) set by the owner. A stray, harmless settings key `settings: null` exists on the four
  sub-devices from a mistaken API call (the CLI passes `--body` as the settings object directly, not wrapped).

The original checklist, for re-testing:
1. Total device → advanced settings → "Role in Homey Energy" = "Single appliance"; log should show
   `energy object set to {"meterPowerImportedCapability":…}` and the device should appear as a consumer in Energy.
2. Each phase device → "Grid type" = "3 phases without neutral …, N terminal unused"; log should show
   `capability measure_voltage is now hidden (grid type it_3wire)` etc., and the device card should only show
   current (plus the reset button). If the card still shows the values, `uiComponent: null` via
   `setCapabilityOptions` is not honoured at runtime and the fallback is `removeCapability`/`addCapability`.
3. Switch back to TN once to confirm the readings reappear.
4. Existing devices may have `meterRole`/`gridType` = `null` until the settings are saved once; the code treats
   `null` as `home` / `tn` (upstream behaviour).

## 9. 4.1.10 (2026-09-26): per-phase current was stale — polling only what is visible

Observation with the heat pump running: Total `measure_power` followed the load within seconds (threshold reports,
parameter 40), but the phase devices' `measure_current` stayed at the standby values (2.95 / 0.26 / 0 A) while the
meter's own display showed 6.9 A on L1 and L2. The Z-Wave log (`PUT /api/manager/zwave/log {"enabled":true}`, then
`GET /api/manager/zwave/log`, a 100-entry ring buffer — poll it every 3–5 s, faster triggers "Too many requests"
for many minutes) showed why: the meter only sends unsolicited V/A reports for a phase endpoint now and then
(endpoint 2 sent 134.6 V and 6.955 A at 07:17:00, endpoints 3/4 nothing in the window), and Homey polled the phase
devices only every 900 s. So per-phase current lags by up to 15 min and can miss a whole compressor cycle.

Fix in 4.1.10: `_applyGridType()` now also manages polling — hidden readings get their poll timer cleared
(`_setPollInterval(cap, 'METER', 0)`), visible ones are (re)started with `meterPollingInterval`. With `it_3wire`
that is one GET per phase device per interval, so the owner's phase devices can run at 60 s (set via API after
install). Library quirk found on the way: `homey-zwavedriver` stores only one capability per poll-interval setting
key (`_pollIntervalSettingKeys`), so a change of `meterPollingInterval` used to re-time only `powerFactor` until
the next restart; `onSettings` now re-applies the interval to every meter capability itself.

Also seen in the log: the Total endpoint answered a `METER_GET` for scale 6 (power factor) with a scale 1 (kVAh)
report, so `powerFactor` on Total updates only from unsolicited reports. Not fixed, cosmetic.

**Open question about the installation (not software):** with the pump running the meter display shows 6.9 A on
L1 and L2 and 0 A on L3. A running 3-phase compressor cannot have zero current on one line, so either the L3 current
transformer is missing/not clamped, or the pump is effectively a single-phase (L1–L2) load. If the L3 CT is
missing, the Total W/kWh are ~2/3 of the truth for a balanced 3-phase load (the artificial-neutral sum is exact
only with all three currents). Distinguish by reading the per-phase power factor while the compressor runs
(`GET /api/manager/devices/device/` → `capabilitiesObj.powerFactor`, still updated although hidden): equal PF on
ph1 and ph2 ⇒ balanced 3-phase load with a missing L3 CT; clearly different PF (cos(φ±30°)) ⇒ single-phase load.

**Root cause found 2026-09-26 08:08 (supersedes the polling theory above):** meter parameter 43 ("Other values –
reporting on time interval": V and A per phase, total PF, total var; device default 600 s) was set to **0** on the
owner's meter (driver setting `powerReportingIntervalQ2` on the root device, mislabelled upstream as "output 2").
With 0 the meter never refreshes those values, and a METER_GET for them returns the last *reported* value, so
polling every 60 s dutifully returned 6.955 A for an hour while the display showed the truth. Setting parameter 43
to 60 made every phase endpoint send V/A/var/PF each minute (log: `REPORT src2 V=135.4, A=0.259, scale2=-32.1,
PF=0.3391`, then src3, src4), and ph1 current dropped to the correct idle value within a minute. Phase polling was
put back to 300 s as a safety net. Parameter 42 refreshes only the energy counters; W is reported on change
(parameter 40, valid for total and each phase). Source: openHAB device database entry for ZMNHXD.
