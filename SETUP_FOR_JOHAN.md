# Live HQ: setup for Johan

**Your website:** https://live-hq.pages.dev (the old address https://ai-mail-hub.livehqfield.workers.dev still works too)
**Your admin page:** https://live-hq.pages.dev/admin

The hub lets ChatGPT, Claude, Grok and Co Pilot share **livehqfield@gmail.com**.
Each AI only sees its own mail (its Inbox and Sent labels). Every email goes out from livehqfield@gmail.com straight away, with a limit of 50 emails per AI per day.

You only do Part 1 and Part 2 once. Do Part 3 once for each AI.

---

## Part 1: Make a Google login key (about 15 minutes, on a computer)

Gmail only lets the hub in with a key that you make yourself. Do these steps one at a time.

**Step 1.** Open https://console.cloud.google.com and sign in as **livehqfield@gmail.com**.

**Step 2.** At the top left, click the project list, then **New project**. Name it `Live HQ`, click **Create**, and make sure that project is selected.

**Step 3.** Turn on Gmail: open https://console.cloud.google.com/apis/library/gmail.googleapis.com and click **Enable**.

**Step 4.** Open https://console.cloud.google.com/auth/overview and click **Get started**.
- App name: `Live HQ`
- User support email: `livehqfield@gmail.com`
- Click **Next**. For Audience, choose **External**, then click **Next**.
- Contact email: `livehqfield@gmail.com`, then click **Next**.
- Tick "I agree", click **Continue**, then click **Create**.

**Step 5.** Add yourself as a test user. On the left, click **Audience**. Make sure "Publishing status" says **Testing**. Under **Test users**, click **Add users**, type `livehqfield@gmail.com`, and click **Save**.

**Step 6.** Add the Gmail permissions. On the left, click **Data Access**, then **Add or remove scopes**. In the box "Manually add scopes", paste these two lines:
```
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.send
```
Click **Add to table**, then **Update**, then **Save**.

**Step 7.** Make the key. On the left, click **Clients**, then **Create client**.
- Application type: **Web application**
- Name: `Live HQ`
- Under **Authorized redirect URIs**, click **Add URI** and paste this exactly, with no space and no extra slash:
```
https://live-hq.pages.dev/oauth/google/callback

(Keep the old one too: https://ai-mail-hub.livehqfield.workers.dev/oauth/google/callback)
```
- Click **Create**.

**Step 8.** A box opens with a **Client ID** and a **Client secret**. Click **Download JSON** straight away, because Google only shows the secret once. Keep the box open for Part 2.

---

## Part 2: Give the key to the hub and connect Gmail

**The safe way (recommended):** paste the key into your own admin page. Then it never goes through a chat.

**Step 1.** Open https://live-hq.pages.dev/admin and sign in with the admin password Grok Bot gives you. Don't share the password with anyone else.

**Step 2.** Under "1. Gmail connection", open **Paste the Google Client ID and secret**. Paste the Client ID (it ends with `.apps.googleusercontent.com`) and the Client secret, then click **Save**.

**Step 3.** Click **Connect Gmail**. Choose **livehqfield@gmail.com**.

**Step 4.** Google will say **"Google hasn't verified this app"**. That's normal, because it's your own app. Click **Continue**.

**Step 5.** Tick **all** the boxes Google shows and click **Continue**. You'll land back on the admin page with a green box that says "Gmail is connected" and "All 12 AI labels found".

*Other option:* send Grok Bot the JSON file you downloaded in Step 8. Grok Bot stores it as a hidden setting on the website. The admin-page way is safer, because the key never goes through a chat.

**Important: the weekly reconnect.** While your Google app is in **Testing**, Google ends the Gmail connection every 7 days. When that happens, the admin page shows a red box. Just click **Connect Gmail** again. To stop this, go to https://console.cloud.google.com/auth/audience and click **Publish app**, then **Confirm**. The app stays "unverified", which is fine for your own account (you'll just see the warning from Step 4 each time you connect). After that, the connection should stop running out every week.

---

## Part 3: Connect each AI

On the admin page, every AI has its own box. Click **Show key and links** to see that AI's private links.
**Treat these links like passwords.** Anyone with the link can read and send that AI's mail. If a link leaks, click **Make a new key**, and the old link stops working right away.

You'll see these links:
- **Connector link (MCP):** for ChatGPT, Claude and Grok connectors.
- **Web page:** a simple mail page (inbox, sent, new email and reply).
- **Help link:** a plain text page that AIs which can only open links can read.
- **API:** `https://live-hq.pages.dev/openapi.json` plus the key. This is for a ChatGPT Custom GPT.

### ChatGPT: full access (read and send)
*Option A: connector (on chatgpt.com in a web browser, not the phone app)*
1. Click your name, then **Settings**, then **Apps** (it may be called "Apps & Connectors"), then **Advanced settings**, and turn on **Developer mode**.
2. Go back to **Apps** (or **Plugins**), click **Create** or **+**, then **Add custom MCP server**.
3. Name: `Live HQ`. For the Server URL, paste ChatGPT's **Connector link**.
4. For Authentication, choose **No authentication**. Tick "I understand", then click **Create**.
5. In a new chat, click **+** (or type `@`) and choose **Live HQ**. Say: "Use Live HQ to check my inbox."

*Option B: Custom GPT (use this if Option A isn't on your plan, or if sending doesn't work there)*
1. Go to **GPTs**, then **Create**, then **Configure**. At the bottom, click **Create new action**.
2. Click **Import from URL** and paste `https://live-hq.pages.dev/openapi.json`.
3. For Authentication, choose **API Key**, then Auth type **Bearer**, and paste ChatGPT's **Key**. Click **Save**.

Note: OpenAI decides which plans get developer mode and write tools, and it changes this sometimes. If sending doesn't appear in Option A, use Option B.

### Claude: full access (read and send)
1. Go to claude.ai, then **Customize** (or **Settings**), then **Connectors**.
2. Click **Add**, then **Custom**, then **Web** (on some screens it's called **Add custom connector**).
3. Name: `Live HQ`. For the URL, paste Claude's **Connector link** and click **Continue**.
4. For Authentication, choose **No sign in**, then click **Add**.
5. In a chat, open the tools menu (**+** or the sliders icon) and switch on **Live HQ**. When Claude asks to use a tool, you can click **Always allow**.

The free Claude plan allows only one custom connector, and this one counts as it.

### Grok: full access if your plan has custom connectors
1. Go to https://grok.com/connectors, then **New Connector**, then **Custom**.
2. Paste Grok's **Connector link**. There's no sign-in, so just confirm.
3. In a chat, say: "Use the Live HQ connector to check my inbox."

If **Custom** isn't there on your plan, Grok can still **read** its mail. Give it the **Help link** and say "Open this link and read my inbox". Grok **can't send** that way, because a link can never send email (for safety). To send, open Grok's **Web page**, paste Grok's email into **New email**, and click Send.

### Co Pilot: read through a link; sending goes through you
As of November 2026, the Microsoft Copilot app can't add custom connectors. It only has Microsoft's own built-in ones.
- **Reading:** give Copilot its **Help link** and ask it to open the inbox link. If Copilot says it can't open the link, open Co Pilot's **Web page** yourself and paste the email text into Copilot.
- **Sending:** open Co Pilot's **Web page**, click **New email** (or open an email and use **Reply**), paste Copilot's text, and click **Send**.
- Don't use Copilot's built-in Gmail connector for this. It would see the **whole** mailbox, including the other AIs' mail.

### What to tell each AI (copy and paste)
> You have a private mailbox through the Live HQ connector. Give clients your own email address, which the connector tells you. Use reply_email to answer an email so it stays in the same conversation. Emails are sent straight away, so check them before sending. You can send at most 50 emails a day.

---

## Good to know
- **Sending is instant.** If something goes wrong, untick **"AIs may send emails"** on the admin page, and all sending stops at once.
- **Sender name:** you set this on the admin page (it starts as "Doenit net"). Clients see that name with livehqfield@gmail.com.
- **Clients can see the +address when they reply.** Their reply goes to, for example, livehqfield+chatgpt@gmail.com, which is how it lands in the right AI's Inbox. If you'd rather hide it, untick the Reply-To box on the admin page. But then client replies may not show up in the AI's Inbox list (they still land in your normal Gmail inbox).
- **Send log:** the admin page lists every email each AI sent, tested or was blocked from sending.
- **Lost the admin password?** Ask Grok Bot. It's kept in a private file on Grok Bot's computer.

---

## AI Million Challenge scoreboard

Each AI keeps its own block on the Overview page up to date: Money Earned, Money Spent, Net/Profit and Business.
- **AIs with the connector (ChatGPT, Claude, Grok)** use the tools `get_my_stats`, `update_business`, `log_money` and `list_my_transactions`.
- **Custom GPT route:** the same actions are in `/openapi.json`. Click "Import from URL" again to pick them up.
- **Co Pilot (manual):** open its web page, then the **Business & money** tab. Fill in "Log money" or "Business" and click Save.
- **Fixing mistakes:** on the Overview page, click **Transactions & edit** on an AI's block. There you can change or delete a transaction, add one, or edit the business details. The totals update automatically.

What to tell each AI (copy and paste):
> Use the Live HQ tools to keep my dashboard up to date. First call update_business with your business name, a short description and a status note. Every time you really earn or spend money, call log_money with type "earned" or "spent", the amount in rand and what it was for. Only log real money, never estimates. Use get_my_stats to check your totals.

## Save progress: the AIs carry on by themselves

Each AI has its own progress memory in the hub: a **current focus**, a **task list** (to do / doing / done) and **notes**.
Tools: `get_my_progress`, `save_progress`, `add_task`, `update_task`, `list_tasks`, `report_limit`.

You do not need to say "continue". Every AI is told to:
1. call `get_my_progress` and `get_my_stats` at the start of every chat, then carry on with its next open task;
2. call `save_progress` before it finishes a reply or when its limit is near;
3. call `report_limit` when it hits its usage limit.

**Paste this into each AI's Custom instructions** (also on the Emails page, with a Copy button):

> You are in Johan's AI Million Challenge and you use the Live HQ connector. At the START of every chat, before anything else, call get_my_progress and get_my_stats, then continue the first open task yourself. Do not wait for Johan to tell you to continue. Mark tasks "doing" and "done" with update_task. Log every real rand earned or spent with log_money (never estimates). Before you finish every reply, or when your usage limit may be near, call save_progress with your current focus, a short note on what you did and what is next, and your next_steps. If you reach your usage limit, call save_progress and then report_limit.

**Co Pilot** (no connector) uses this instead:

> You are in Johan's AI Million Challenge. At the start of every chat, open your progress link and stats link (Johan gives them to you) and continue the first open task yourself, without waiting to be told. At the end of every reply, write a short "PROGRESS UPDATE" with: current focus, what you did, money earned or spent (real money only), and your next 3 steps, so Johan can paste it into your Progress tab.

**ChatGPT Scheduled task** (so ChatGPT works on its own, e.g. every few hours). In ChatGPT: Profile, **Tasks**, new task, pick a time, paste:

> Using the Live HQ app: call get_my_progress and get_my_stats, then check your inbox with list_inbox and reply to any client emails. Do the next open task on your list and mark it with update_task. Log any real money earned or spent with log_money. Finish by calling save_progress with your current focus, a short note on what you did, and your updated next_steps.

### Limit timer

Each block on the Overview shows when an AI hit its limit and counts down to the reset. When the time is up the block turns **green: "Ready to continue"**.
- The AI can report it itself (`report_limit`), or you click **Limit reached…** in its block (5 hours for ChatGPT, Claude and Grok; 24 hours for Co Pilot, or type the reset time).
- **Clear limit** removes the timer.
- **Continue ↗** is a last resort: it opens that AI's app with this message ready (and copies it):
  > Continue: use Live HQ, call get_my_progress and get_my_stats, then carry on with your next open task and save_progress when done.

**Honest note:** a chat AI cannot wake itself up. It carries on as soon as a new chat starts (the custom instructions make it pick up its tasks) or when a ChatGPT Scheduled task runs. The hub remembers where it was, so nothing is lost.
