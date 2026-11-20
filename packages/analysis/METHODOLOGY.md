# How Tracer finds and scores your workflows

This is the method behind every number in your report. It is written to be read by you, not only by engineers. All of it is ordinary code: no AI model decides any number. A language model may only write the prose around the numbers, and a checker rejects prose that mentions a number the code did not produce.

## 1. What we start from

Your computer sends only: which app or website was in front, the window title, a redacted summary of on-screen text, *that* the clipboard changed (never what was copied), and when you went idle or paused capture. No screenshots, no keystrokes, no full web addresses.

## 2. Turning events into time (sessions)

- Time in a window runs from the moment it comes to the front until the next window does.
- **Idle**: after 2 minutes without keyboard or mouse input, the clock stops. The agent notices idleness only after those 2 minutes, so we also take those 2 minutes back off.
- **Silence**: if nothing at all arrives for more than 30 minutes and no idle signal was sent (computer asleep, agent not running), we count at most 2 minutes of it.
- **Paused / excluded**: while you paused capture, or while an app you excluded was in front, nothing is counted. Those minutes are reported separately, never folded into a workflow.
- **Alt-tab flicker**: a window that was in front for under 3 seconds is folded into the window around it. Consecutive stretches in the same window are merged.
- **Action**: each session gets a coarse action (read, write, edit, search, export, import, copy, paste, upload, download, review, approve, schedule, reconcile, open). It comes from words in the window title (e.g. "Export", "Reply", "Approve"), then from clipboard activity (a copy here; a paste right after a copy elsewhere), then from on-screen text, then from what the app is usually used for. This is a guess and can be wrong.

## 3. Grouping sessions into tasks

A task is a run of sessions that belong together. A new task starts when:

- there is a break of more than 10 minutes, a new day starts, or the task would exceed 2 hours;
- you go back to the app where the task started and open a different item (the next invoice, the next ticket): that is the next repetition;
- you move to a different document in the same app with unrelated words in its title; or
- you move to another app and nothing ties it to the task.

What ties a new app to the running task: its title/on-screen words are similar to the task's; you copied something in the task in the last 5 minutes; or the hand-off between those two apps is a habit (seen at least 3 times on at least 2 days, makes up at least a quarter of your moves out of the first app, and is at least twice as likely as moving to that app in general, so chat and email do not count as a "habit" just because you visit them all the time).

**Interruptions**: a short detour (at most 3 windows and 5 minutes in total, without copying anything) after which you clearly carry on with the task, like answering a chat ping, is cut out of the task. Its time is not counted as part of the workflow.

Tasks with less than 90 seconds of active time are dropped.

## 4. Finding recurring workflows

Every pair of tasks gets a similarity score between 0 and 1:

- 30% **step order**: how much of the sequence of (app, action) steps the two tasks share, in order (a weighted longest-common-subsequence; same app but different action counts 0.6). A skipped or extra step lowers this only a little.
- 20% **apps used**: overlap of the apps each task used.
- 50% **words**: similarity of the window titles and on-screen text (a local, offline "fingerprint" of the words; numbers and redacted parts are ignored, as are app names and words that appear in nearly every task).

Tasks are merged into groups bottom-up (average linkage) while the average similarity between two groups is at least 0.55. A group becomes a reported workflow only if:

- it happened at least **3 times**;
- its typical path has at least **2 different steps** (a single activity, like reading chat, is not a workflow);
- it is not purely reading;
- the tasks in it share their vocabulary (average word similarity at least 0.4). Doing the same thing repeatedly repeats its words; the same apps used for unrelated things do not.

The **typical path** shown is that of the most representative occurrence, keeping only steps that appear in at least half of the occurrences. The workflow's **id** is derived from the ordered list of apps in that path, so the same workflow keeps the same id when you rerun or repeat the audit.

## 5. Scoring

All formulas live in one shared file (`packages/schema/src/scoring.ts`) so the report, the checker and the "how we got this number" panel use identical code.

- **Weekly hours** = total minutes / 60 / (days observed / 7). *Days observed* runs from the first to the last day with any activity; quiet days in between (a weekend) count, because you were measured and did not do the work. Days that were almost entirely paused do not count.
- **Repeatability** (0-1): average step-order similarity of each occurrence to the typical path.
- **Rule-based share** (0-1): average over the typical path's steps, where copy, paste, export, import, upload, download and open count 1; write, review, approve and edit count 0; read, search, schedule and reconcile count 0.5.
- **Integration feasibility** (0-1): for each app, API 0.4 + no-code connectors 0.3 + file import/export 0.1 + desktop scripting 0.1 + built-in rules 0.1 (unknown websites: 0.2). The workflow gets the average of its apps blended 50/50 with its weakest app, because a chain breaks at its weakest link.
- **Risk** (0-1): sum of flags from the apps involved and the actions, capped at 1: money 0.4, irreversible 0.3, credentials 0.3, health data 0.3, personal data 0.15. Approving something adds "irreversible".
- **Automation potential** (0-100) = 100 × (0.3 × repeatability + 0.35 × rule-based share + 0.35 × integration feasibility) × (1 − 0.5 × risk).
- **Reclaimable hours per week** = weekly hours × automation potential / 100 × 0.7. The 0.7 is a deliberate haircut: automation never removes all of the time; someone still checks results and handles exceptions.
- **Confidence** (0-1) = 0.4 × min(1, occurrences / 10) + 0.3 × min(1, days seen / min(days observed, 5)) + 0.3 × cohesion, where cohesion is the average similarity between occurrences. High ≥ 0.75, medium ≥ 0.5.
- The one-sentence **why** under each score is filled in from these inputs by a template.

Findings are ranked by reclaimable hours per week (ties: weekly hours). At most 10 are shown. The headline total is the sum of the shown findings' reclaimable hours, and the report lists each term.

## 6. Limits we know about

- Actions are inferred from words on screen and can be wrong; a page that always shows an "Export" button can look like exporting.
- Work that happens away from this computer (phone, paper, in-person meetings) is invisible.
- Excluded apps, excluded websites, private windows and paused time are not counted, so a workflow that passes through them looks shorter, or is split.
- Two different workflows that interleave in the same apps (for example two kinds of email follow-up) can be merged or split wrongly.
- Workflows done only 3 times in the window are near the reporting threshold; if one of those occurrences is split or merged with something else, the workflow may not be reported.
- Weekly figures from fewer than 5 observed days are rough.
- Durations are measured in front-window time; a long background process (an export that takes 10 minutes while you do something else) is not attributed to the workflow.

## 7. How we test this

We generate synthetic weeks with planted workflows plus realistic noise (chat pings and email checks mid-task, alt-tab flicker, idle breaks, skipped, swapped and extra steps, one-off tasks, meetings, pauses) and check that the planted workflows are found (recall) and that reported workflows are real (precision). See `EVAL.md` for the latest numbers.
