# Counter Tablet — Silent Thermal Printing Setup

How to run a dedicated screen at a counter (Shisha, Bar, Kitchen, Main) so that
**new tickets print automatically on an 80mm thermal printer with no dialog**.

The app already supports this:
- Counter View groups tickets by table, beeps + flashes on new orders, refreshes
  every 5s, and has a **🖨 Chapisha** button per table plus an **🖨 Auto-chapisha**
  toggle.
- "Chapisha" calls the browser's print with a chit sized for 80mm paper.
- To make printing **silent** (no print dialog each time), the browser must be
  launched in kiosk-printing mode. That's what this guide sets up.

---

## 0. Prerequisite — the app must be reachable on the network

A counter device opens the app over the LAN, so the app has to run on a machine
the counter can reach (not just `localhost`).

On the server PC (the one running the app):

```bash
cd cashier-app
npm run build
npm start            # serves on port 3000
```

Find that PC's LAN IP (e.g. `192.168.1.50`):

```powershell
ipconfig    # look for IPv4 Address under your Wi-Fi/Ethernet adapter
```

Each counter device then opens:  `http://192.168.1.50:3000`

> Keep the server PC on the same Wi-Fi/router as the counter devices. If Windows
> Firewall prompts, allow Node.js on private networks.

---

## 1. Install the thermal printer (per counter device)

1. Plug in the 80mm thermal printer (USB) and install its driver (from the maker —
   Epson TM-T series, Xprinter, etc.).
2. Windows Settings → Bluetooth & devices → Printers & scanners → confirm it shows.
3. **Set it as the default printer** (Chrome kiosk-printing prints to the default).
4. Open the printer's Preferences and set the paper width to **80mm** (or 72mm
   printable). This matches the chit's `@page { size: 80mm auto }`.

Print a Windows test page to confirm it physically prints.

---

## 2. Launch Chrome in kiosk-printing mode (Windows)

This is the key step — `--kiosk-printing` makes `window.print()` send straight to
the default printer with **no dialog**.

Create a desktop shortcut:

1. Right-click desktop → New → Shortcut.
2. Location (one line — adjust the IP and counter code):

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --new-window "http://192.168.1.50:3000/pos/counter?code=SHISHA"
```

3. Name it e.g. **"Shisha Counter"**. Repeat with `?code=BAR`, `?code=KITCHEN`,
   `?code=MAIN` for the other counters.

Notes:
- `?code=SHISHA` opens the right counter tab automatically.
- Add `--kiosk` *before* `--kiosk-printing` for full-screen (hides tabs/address
  bar) once you've logged in. Exit full-screen kiosk with Alt+F4.
- Use a dedicated counter login (a user account) on that device.

---

## 3. In the app

1. Log in on the counter device and open the Counter View (the shortcut lands you
   there).
2. Turn on **🖨 Auto-chapisha** (top-right). New tables now print automatically.
3. Leave **🔔 Sauti** on so staff hear the beep when an order arrives.
4. As items are served, tap **✓ Tayari** (or **✓ Tayari zote** for the whole
   table) to clear them from the screen.

That's it — when a waiter sends shisha, within ~5s the ticket beeps, appears, and
a chit prints automatically.

---

## 4. Android tablet alternative

Chrome on Android has no `--kiosk-printing` flag, so true silent printing needs a
print-service app:

1. Install **RawBT** (Play Store) — an ESC/POS print service for USB/Bluetooth
   thermal printers.
2. Pair the thermal printer in RawBT and set it as the default print service.
3. In the app, use the manual **🖨 Chapisha** button — Android's print sheet
   appears; pick RawBT. (Fully automatic printing is unreliable on Android, so a
   Windows mini-PC per counter is the smoother option for hands-off printing.)

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| Print dialog still pops up | Chrome wasn't started with `--kiosk-printing`; relaunch via the shortcut. |
| Prints to the wrong/PDF printer | Set the thermal printer as **default** in Windows. |
| Chit too wide / cut off | Set printer paper width to 80mm in Preferences. |
| Nothing happens on a counter device | Can it open `http://<server-ip>:3000`? Check same network + firewall. |
| No beep | Tap anywhere once (browsers need a gesture to enable audio), or check 🔔 Sauti is on. |
| Auto-print prints twice | Each new *send* from a waiter prints once — that's expected (one chit per send). |

---

## 6. One device, multiple counters

If one screen serves more than one station, skip `?code=` and let staff tap the
counter tabs (Bar / Shisha / Kitchen / Main). Auto-chapisha applies to whichever
tab is open. For hands-off printing of several counters at once, use one device
(and one shortcut) per counter.
