# M6: second framework, workflow graph, desktop wrapper

The roadmap made M6 conditional: "only if a real need exists". This is the check, with numbers measured on this machine.

## Second framework adapter (n8n, OpenClaw/Hermes as a gateway)

**Not built.** No workflow in use needs a graph engine, and the reconciler's adapter boundary (`packages/adapter-paperclip`) has exactly one implementation, so a second one today would be designing an interface from a sample of one. The trigger to revisit: a concrete workflow that agents cannot do as a routine plus a tool (for example a multi-step flow with branching and human wait states that you want to see and edit as a diagram). At that point write the second adapter against that workflow and finalise the interface from the two.

## Desktop wrapper (Tauri vs Electron vs nothing)

Measured today:

| | Measured |
|---|---|
| Control app server process (Node) | 52 MB working set |
| UI payload (HTML, JS, CSS, fonts) | 216 KB on disk |
| Rust toolchain (needed for Tauri) | not installed (`rustc`, `cargo` missing) |
| WebView2 / Edge | present (Edge 154 and 155 installed) |
| Electron | would bundle its own Chromium: roughly 100 MB or more on disk and a second browser in memory (typical figure, not measured here) |

**Decision: no wrapper.** The app is a loopback web server plus a page. A wrapper would add a build chain (Rust for Tauri, a bundled Chromium for Electron), code signing and update plumbing, and nothing the app needs: it has no native menus, tray, file access or notifications of its own.

If it should feel like an app without any of that, use Edge's app mode, which is free and needs no code: `msedge --app=http://127.0.0.1:4790/?t=<token>` gives a window with no tabs or address bar. I have not changed `app.cmd` to do this (it would change how it opens for everyone); say if you want it.

Reasons to reopen: a tray icon that starts the services at logon, or native notifications when an agent needs you. Both are small enough to do with a Windows scheduled task and a toast from the existing server before reaching for a wrapper; Tauri would be the choice then (small, uses the Edge already present), after installing Rust.
