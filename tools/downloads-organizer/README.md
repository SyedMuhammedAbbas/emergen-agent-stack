# Downloads Organizer

A background watcher for `C:\Users\<you>\Downloads`. Whatever app saves a file there (browser, torrent client, Telegram), it is moved into a topic subfolder once the download has finished.

- `rules.js` is the one place that decides the folder (first match wins). Edit it to change where things go; the topic rules come before the generic file-type ones.
- `watcher.mjs` does the watching. Browser temp names (`.crdownload`, `.part`, ...) are ignored, a file is moved only after its size stops changing, a name clash gets `name (1).ext`, folders you create are left alone.
- Qualifi files (PlusVibe, GHL, n8n) go to `C:\Abbas\Qualifi\inbox`; change `DEST` in `watcher.mjs` for other topics outside Downloads.
- Log: `logs\watcher.log`, one line per move.

```
node watcher.mjs                 run it now (Ctrl+C stops it)
.\install-startup.ps1            start it at every logon, hidden
.\install-startup.ps1 -Remove    stop and remove it
npm test                         rules and a real watcher run against a temp folder
```

`_retired-extension\` holds the earlier browser-extension version, which the watcher replaces. Delete the folder when you are sure.
