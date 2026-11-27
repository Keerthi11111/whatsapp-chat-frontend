# whatsapp-chat-frontend

WhatsApp-style chat client built with Next.js, React, Tailwind CSS and Socket.IO.
It talks to the backend at `http://localhost:5000` (see `services/auth.ts`).

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Phases

1. **Accounts** – registration, login/logout, JWT auth, permanent user ID, profile with name and photo.
2. **Find people** – search by username or phone number, view a user's profile, start a private conversation.
3. **Messages** – history stored in PostgreSQL, pagination, real-time send/receive, offline message history.
4. **Message status** – sent / delivered / read ticks, timestamps, retry and duplicate-message protection.
5. **Presence** – online indicator, last seen, typing indicator, multiple-device handling.
