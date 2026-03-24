# Termux Setup

This project runs on Termux with Node.js 18+.

## 1. Install packages

```bash
pkg update && pkg upgrade -y
pkg install git nodejs nano -y
pkg install python make clang -y
termux-setup-storage
```

## 2. Put the project in your home folder

Do not run the bot directly from `/sdcard`.

```bash
cd ~
git clone YOUR_REPO_URL McBot
cd McBot
```

Or copy it from shared storage:

```bash
cd ~
cp -r /sdcard/Download/McBot .
cd McBot
```

If you run `npm install` from `/sdcard`, `/storage/emulated/0`, or `Download`, Android storage permissions can block package installs. Keep the project under `~/McBot` before installing.

## 3. Edit the config in `index.js`

Open the config block at the top of `index.js` and set:

- `MC_HOST`
- `MC_PORT`
- `MC_USERNAME`

Recommended for Android / Termux:

- `MC_CONNECT_TIMEOUT_MS: 60000`
- `MC_AUTH_INPUT_PROFILE: 'touch_minimal'`

If the server requires Microsoft / Xbox login, set:

```js
MC_OFFLINE: false
```

## 4. Install dependencies

```bash
npm install
```

## 5. Start the bot

```bash
npm start
```

The bot stores Microsoft auth files in a Termux-safe folder automatically:

```text
/data/data/com.termux/files/home/.mcbot-bedrock-auth-cache
```

## 6. Common fixes

Timed out before join:

- Check `MC_HOST` and `MC_PORT`
- Do not use `127.0.0.1` unless the server is on the same Android device
- Increase `MC_CONNECT_TIMEOUT_MS`
- If the server is online-mode, set `MC_OFFLINE=false`

`not_authenticated`:

- Set `MC_OFFLINE: false` in `index.js`
- Restart and complete the Microsoft login code flow

Permission errors:

- Run `termux-setup-storage`
- Keep the project under `~`, not `/sdcard`

Missing module errors:

```bash
npm install
```

This project forces `bedrock-protocol` to use the pure-JS `jsp-raknet` backend and overrides `raknet-native`, so Termux should not need to build that native module during install.
