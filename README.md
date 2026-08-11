# RevApex AI — AI App Bootcamp Landing Page

Marketing landing page for the free live **"Build a Real Mobile App With AI in 90 Minutes"** bootcamp
(Fri, June 20, 2026 · 10:30 AM IST), hosted by Mahabahu Behera (Bahu), founder of RevApex AI.

## Contents

- `marketing/AI App Bootcamp Landing.html` — the full landing page (self-contained: inline CSS + JS).
- `marketing/assets/bahu.png` — instructor photo.

## Registration flow

Every "Reserve your free spot" CTA opens a Russell Brunson–style two-step opt-in modal that
captures: **first name, last name, email, phone, city, profession** (student / job / businessman /
entrepreneur).

On submit, the form `POST`s the lead as JSON to an **n8n webhook**, which registers the attendee
to a **Zoom meeting** (registration enabled) and returns a personal `join_url` shown on the success
screen.

Config lives at the top of the registration script in the HTML (`REG_CONFIG`):

| Key | Value |
| --- | --- |
| `endpoint` | `https://api.trustsolar.in/webhook/ai-bootcamp` (n8n webhook) |
| `meetingId` | `84987553921` (Zoom Meeting ID) |
| `fallbackJoinUrl` | shown until n8n returns a real `join_url` |

### n8n workflow (low-stack)

1. **Webhook** (POST) — Response mode "Using Respond to Webhook node"; set Allowed Origins (CORS).
2. **Zoom → Meeting → Create Registrant** on the meeting ID; map phone / city / profession to Zoom
   custom registration questions.
3. **Respond to Webhook** — return `{ "join_url": "{{ $json.join_url }}" }`.

## Local preview

Open `marketing/AI App Bootcamp Landing.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000/marketing/AI%20App%20Bootcamp%20Landing.html
```
