# Rails

A playbook written in prose is a request. A rail is something the agent cannot get past by forgetting, skimming or rationalizing. Every generated skill carries a runtime, `scripts/flow.mjs`, that turns the graph into rails. It depends on no particular agent.

## How it lines up with common practice

Graph engineering, as agent frameworks practice it, models a workflow as a state machine. The transitions between states are deterministic and owned by code; the work inside a state is left to the model. State is checkpointed, and the run is interrupted for a human and resumed with their answer. The runtime implements the same model on top of files and standard agent interfaces:

| Concept | In agent graph frameworks | Here |
|---|---|---|
| Node | A function, LLM call or sub-agent | A playbook |
| Edge, conditional edge | A transition chosen by code from state or a result | An exit; `on: pass` / `on: fail` chosen by the playbook's checks |
| Graph definition | Code or a declarative spec | Playbook frontmatter, checked by `validate.mjs` |
| State and checkpoint | A checkpointer saving state per thread | `.flow/<skill>/state.json` per run, with an append-only `log.jsonl` |
| Interrupt and resume | Pause for human input, resume with a command | A `[human-gate]` step waits; only the human's answer resumes it |
| Guard node, approval step | A node that blocks until conditions hold | Promotion gates (`promotes`), guarded `irreversible` commands |

The interfaces are standards current coding agents share:

| Layer | Standard | What it is used for |
|---|---|---|
| Packaging | Agent Skills (`SKILL.md` with spec-only frontmatter, `scripts/`, `references/`) | Any agent that loads skills can load the generated skill |
| Driving the run | A plain CLI (`node scripts/flow.mjs …`) | Every agent can run it; it costs no context until used |
| Enforcement | Lifecycle hooks: JSON on stdin, `hookSpecificOutput.permissionDecision: deny` blocks, `hookSpecificOutput.additionalContext` for context | Block guarded commands and out-of-bounds edits, capture approvals, inject state, bounce premature stops |
| Optional | MCP server with elicitation | A human gate answered in a dialog the model cannot fill, for clients that support elicitation |

## Layers

| Layer | When | Enforces |
|---|---|---|
| Validator (`validate.mjs`) | Generation and Evolve | The graph itself: exits exist, no trap cycles, lifecycles rise only through gates that declare it, irreversible steps sit behind human gates |
| Runtime (`flow.mjs`, with the rest in `lib/`) | Every run | The agent's moves: one active playbook, steps recorded with evidence, human gates passed only by the human, checks run before exits open, only declared exits taken |
| Hooks | Every tool call, prompt and stop | Work outside the runtime: guarded commands blocked until their gate is approved, edits limited to the active playbook's paths, approvals only from the human's own message, state protected, run state injected into context |

## The run

State lives in `.flow/<skill>/` at the project root: `state.json` (the active run), `log.jsonl` (every event, append-only) and `runs/` (finished and abandoned runs). Commit it for an audit trail, or ignore it.

The same directory holds `project.md`, this repository's values for the skill's bindings (see [graph-model.md](graph-model.md#bindings)). The skill names no repository; the runtime reads `project.md` and fills the values into checks, guarded commands, write limits and the step text `flow status` shows. Commit it. A run cannot start while a binding has no value, so a copied skill never runs with another project's commands.

```
start <entry> --request "…"      only router entries; one run at a time (--abandon "<reason>" to replace it)
step <n> --evidence "…"          or --skip "<reason>"; steps behind an unapproved human gate are refused
step <n>                         on a [human-gate] step: interrupts the run and tells the agent to stop and ask
finish --evidence "…"            needs every step recorded; runs the playbook's checks
exit <to> --because "…"          only exits open for the check result (on: pass | on: fail); the next playbook starts
pause --note "…" / resume        a clean stop mid-playbook; while paused, edits are free for other work (except under strict rails) and guarded commands stay blocked
status / log                     where the run is, and what happened
```

## Human gates

When the agent reaches a `[human-gate]` step, `flow step <n>` interrupts the run, exits with code 3 and prints a STOP message. The gate resumes only when the human:

- answers the agent's question. The agent puts Approve / Reject to them in its choice dialog or buttons where it has them (Claude Code's AskUserQuestion, a host's decision card), in plain words only where it has none, and ends its turn. The human taps a choice or replies as they would to anyone (`ok, ship it`, `明日にして`). The agent reads what they meant and records it with `flow answer approve` or `flow answer reject --note "<why>"`. The rails do not read the words, so no phrase, number or host format is required, and the agent's wording of the record cannot fail to match. They check that the human has spoken: while a question waits, `flow.mjs` keeps every message the user sends (the prompt hook runs only on the user's own prompts) and every pick from a choice dialog the agent could not pre-fill (see `scripts/lib/ask.mjs`), and accepts an answer only once one has come since the question was asked, so the agent cannot answer before the user has. What the user sent is logged with the decision. Every hint the rails give while a question waits (on each prompt, in `flow status`) says to record an answer that has come rather than ask again; or
- answers the elicitation dialog, when the optional MCP server is installed and the client supports elicitation; or
- runs `node <skill>/scripts/flow.mjs approve` (or `reject --reason …`) in their own terminal.

Answering in the chat is the main route: it works in every supported agent, including a cloud session followed from a phone, where the human has no terminal. A rejected gate skips the steps behind it; the agent finishes the playbook and takes the exit that fits.

## Suspending the rails

The skill's own files (playbooks, profile, scripts), the project bindings in `project.md` and the hook settings that enforce them change only while the rails are suspended, so the agent cannot switch its rails off. Suspending turns every hook off, so only the human does it, again from the chat:

1. The agent runs `flow request suspend --reason "<what it will change>"`. Like a gate, this exits with code 3 and tells the agent to say what it will change and end its turn. The hooks point the agent to this command whenever they refuse such a change.
2. The human answers, in the agent's choice dialog or in their own words, and the agent records it with `flow answer suspend` or `flow answer decline`, held to the same check as a gate. With the MCP server, `flow_request_suspend` asks in an elicitation dialog instead.
3. The agent makes the change and runs `flow unsuspend`, which only tightens the rails, so the agent may run it.

Each answer is recorded for its own question: `answer approve|reject` for the gate, `answer suspend|decline` for the request, and neither works unless that question waits. The agent may withdraw its request with `flow request cancel`. The human can still run `flow suspend` and `flow unsuspend` in a terminal.

Asking, answering and unsuspending live in `flow.mjs` itself rather than in `lib/`, so they work even when the workflow graph is invalid or the runtime is broken: there is always a way out, and it needs no terminal.

## What the agent cannot do

The tool hook blocks the agent from running `approve`, `reject` or `suspend`, and `flow.mjs hook` or `mcp` (which a forged prompt, dialog answer or elicitation answer could use to approve), and from loading the runtime's code into an interpreter (`node -e "import('…/flow.mjs')"`, a module of the skill's `scripts/lib/`), which could call the same functions. It blocks changing `.flow/` directly, which covers the project bindings in `project.md`: loosening a `writes` glob or emptying a guarded command there would loosen the rails. Reading `.flow/` with `cat`, `jq`, `grep`, `Get-Content` and the like is allowed. Other edits to the settings files are allowed as long as they keep the `flow.mjs` hooks and do not set `disableAllHooks`.

A permission prompt (a hook answering `ask`) is deliberately not used for any of this. Whether `ask` reaches the human depends on the agent and its mode: Copilot's cloud agent treats it as a deny, Codex documents only deny, and Claude Code users have reported `ask` going through unasked in bypass-permissions mode. A decision that some setups answer for the human would let the agent approve itself there. A reply in the chat is written by the human in every agent.

## Rails levels

| | advisory | standard | strict |
|---|---|---|---|
| Runtime enforces transitions, gates and checks when used | ✓ | ✓ | ✓ |
| Run state injected at session start and on every prompt during a run | ✓ | ✓ | ✓ |
| Approvals only from the human; `.flow/` protected | ✓ (chat approvals) | ✓ | ✓ |
| Guarded `irreversible` commands blocked outside their approved step | | ✓ | ✓ |
| Edits limited to the active playbook's `writes` | | ✓ | ✓ |
| Stopping mid-playbook bounced once per state of progress | | ✓ | ✓ |
| Edits blocked when no playbook is active | | | ✓ |

## Installing

```bash
node <skill>/scripts/flow.mjs install --harness claude,codex,copilot,antigravity   # any subset
node <skill>/scripts/flow.mjs install --harness claude --scope local   # personal settings (.claude/settings.local.json)
node <skill>/scripts/flow.mjs install --harness claude --mcp           # also register the optional MCP server
node <skill>/scripts/flow.mjs install --harness codex --dry-run               # print the files instead of writing them
```

Four agents are supported: Claude Code, Codex, GitHub Copilot and Antigravity. The hook command and its behavior are the same for all four; only the configuration file and event/payload fields differ:

| `--harness` | Hooks file | MCP file (with `--mcp`) |
|---|---|---|
| `claude` | `.claude/settings.json` (or `settings.local.json`) | `.mcp.json` |
| `codex` | `.codex/hooks.json` (runs once the project is trusted and the hooks are reviewed with `/hooks`) | `.codex/config.toml` |
| `copilot` | `.github/hooks/<skill>.json` (read by Copilot CLI, cloud agent and VS Code) | by hand |
| `antigravity` | `.agents/hooks.json` (nested under the skill name) | by hand |

Claude Code, Codex and Copilot use the events SessionStart, UserPromptSubmit, PreToolUse and Stop; Antigravity maps `user-prompt` to `PreInvocation` instead of `UserPromptSubmit`. Installing merges entries without touching anything else, replaces the entries an earlier install wrote, and is idempotent. When the project has no `.flow/<skill>/project.md` yet, it also writes a skeleton listing each binding with its description; fill in every value before the first run. It never overwrites an existing project file. The hook reads the payload fields the agents use (`cwd`, `tool_name`, `tool_input`, `prompt`, `hook_event_name`, plus Antigravity's `toolCall`, `lastUserInput`, `conversationId` and `workspacePaths`). It recognizes their shell tools (`Bash`, `shell`, `exec_command`, `powershell`, `run_in_terminal`, `run_command`) and edit tools (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `apply_patch`, Copilot's `create` and `edit`, VS Code's `create_file`, `replace_string_in_file` and the like, Antigravity's `write_file`, `edit_file`, `write_to_file`, `replace_file_content` and `multi_replace_file_content`); any other tool is read by its input (see Limits).

### Several agents in one repository

The four can share a repository, installed in any order, because no hook command depends on one agent:

- **The settings files are not private.** Copilot CLI (and VS Code's Copilot) also runs the hooks in `.claude/settings.json` and `.claude/settings.local.json`, without setting `CLAUDE_PROJECT_DIR`. VS Code's own agent reads them too when `chat.useClaudeHooks` is on. Claude Code, Codex and Antigravity read only their own files.
- **The command finds the skill the same way everywhere.** Agents run hooks through different shells (sh, Git Bash or PowerShell) and from wherever the agent is, which may be a subfolder. So the Claude, Codex and Antigravity commands take the project root from `node` itself: `CLAUDE_PROJECT_DIR` when Claude Code set it, else `git rev-parse --show-toplevel`, else the current folder. That `$(node -p "...")` reads the same in sh, bash and PowerShell. Copilot's own file sets `cwd: "."`, which Copilot resolves from the repository root.
- **Each event runs once per agent.** Every hook says which agent it was written for (`--agent claude|codex|copilot|antigravity`). Claude Code always sets `CLAUDE_PROJECT_DIR` and sends no `timestamp`; Copilot and VS Code do the opposite. A Claude hook run without the variable and with a timestamp was run by Copilot: when Copilot's own file has this skill's hook for the event, the Claude hook steps aside, and otherwise it stands in for it, answering in the fields Copilot reads. If either sign is missing, the Claude hook runs anyway, so a vendor change can make an event run twice but never skip it. Codex and Antigravity read no other agent's file and no other agent reads theirs, so neither overlaps.
- **A block is a JSON decision**, which all four read (exit code 2 is not used, because PowerShell reports any failed native command as exit 1). Claude Code, Codex and Copilot use `hookSpecificOutput.permissionDecision: "deny"` (`decision: "block"` on Stop); Antigravity uses `{ "decision": "deny" }` on PreToolUse, `{ "decision": "allow" }` when allowing PreToolUse, `{ "decision": "continue" }` to keep Stop going, and `injectSteps` for injected context.

Another agent that reads that JSON can still be pointed at `node <skill>/scripts/flow.mjs hook <session-start|user-prompt|pre-tool-use|stop>`. Without hooks, the runtime still enforces everything in the run section when the agent drives runs through the CLI, as the router tells it to.

The human can turn the hooks off for a change to the workflow itself (for example while running vajra Evolve on the skill) by saying yes to the agent's request; see [Suspending the rails](#suspending-the-rails).

## Why MCP is optional

MCP tool schemas sit in the context of every session, and an agent may still choose not to call them, which is the weakness rails exist to remove. The CLI costs nothing until used, and hooks fire whatever the agent chooses. The one thing MCP adds is elicitation: a dialog shown by the client that the model cannot answer. Install it with `--mcp` when the client supports elicitation and you want that dialog, to tap instead of type, for human gates and suspend requests; otherwise leave it out.

## Limits

Be honest with the user about what is enforced and what is not:

- **Choices stay with the agent.** Which entry matches a request and which open exit fits are judgments. The runtime limits them to legal options, and checks with `on: pass | fail` route the most important branch mechanically.
- **Evidence text is self-reported** unless a check backs it. Put everything that can be checked mechanically into `checks`.
- **Command guards match command text** (substring or `/regex/`) where a command starts. The line is read in the shell it runs in: PowerShell for a PowerShell tool, a POSIX shell for Claude Code's Bash and for any shell tool off Windows, and both for any other shell tool on Windows (Codex and Copilot report their Windows shell, PowerShell, as Bash). Reading it in one shell only matters: a Bash line read as PowerShell found deletions that were not there. So a pattern that only appears in a quoted argument, a comment or a heredoc body (a commit message, a grep pattern, notes), or as the file a program only reads, edits or moves (`cat scripts/release.sh`, `git diff scripts/release.sh`, `vim`, `chmod`), does not trigger, while `$(...)`, `sh -c`, `eval`, `ssh`, `pwsh -Command`, `pwsh -EncodedCommand`, `cmd /c`, `Invoke-Expression` and `Start-Process`, and heredocs or pipes that feed a shell (`bash <<EOF`, `echo ... | sh`, `... | pwsh -Command -`), are checked. A line the reader cannot parse is matched as plain text. A line nested deeper than the reader follows, or built to multiply its work, is refused outright.
- **Which gate a guarded command needs** comes from the `[irreversible]` step it belongs to. When the same command runs in steps behind different gates (a ramp to 1%, then to 50%), the command is matched against each step's own command in backticks, with `<...>` standing for any value and extra flags allowed; of the steps it fits, the one behind the most gates decides, so a later stage never passes on an earlier stage's approval. A command that fits none of them, or that no step names, is refused with the forms to use. Steps behind the same gates need no matching.
- **`.flow/` and the rails are protected by the paths a command names**, in any case and with either slash, including globs that could expand to them (`.fl*`), deleting a directory that holds them (`rm -rf .`, `rm -rf .claude`), pipes into a deleting command (`gci .flow | Remove-Item`), a redirection from any program (`cat x > .claude/settings.json`), relative paths after a `cd`, `pushd` or `Set-Location` (`cd .claude && rm settings.json`), links made to them (`New-Item -ItemType SymbolicLink -Target .flow`), and any mention inside interpreter code (`python -c`, `node -e`) or PowerShell that calls .NET (`[IO.File]::WriteAllText(...)`). Naming them is not enough to block, so ordinary work around them runs: reading (`rg`, `sed -n`, `jq . < .flow/...`, `cd .flow && ls`), copying out of them (`cp`, `rsync`, `Copy-Item` check only the destination), text that mentions them (`echo ".flow/*/state.json" >> .gitignore`, `Add-Content .gitignore ...`), options that leave them out (`--exclude=.flow`, `--exclude-dir=.flow`, `--ignore-pattern .flow`), and PowerShell's bare `*` below the project root (`Remove-Item build\* -Recurse`). Not caught: a path built at run time (`$D`, string concatenation, Windows short names like `FLOW~1`), a script written to a file and run later (`cat > x.sh <<EOF`, then `bash x.sh`), commands that rewrite the whole tree without naming it (`git stash -u`, `git checkout .`, `tar x`, `rsync --delete`), patches applied over them (`git apply`, `patch`), and aliases and shell functions. Together these stop drift and mistakes, not a determined adversary: an equivalent command written differently is not caught. Guard the commands people actually use, and prefer wrapper scripts (`npm run deploy`) that are easy to match.
- **`writes` covers the agent's edit tools.** Files changed through shell commands are not checked. `writes: []` makes a playbook read-only; a playbook without `writes` may edit anything, so a file no playbook may edit must be left out of every playbook's `writes`.
- **Copilot's hooks reach less.** Copilot CLI runs repository hooks only in a folder the user has trusted, and drops the output of prompt hooks, so run state is injected only at session start (the Copilot hooks pass `--agent copilot`, which puts the session context in the top-level field Copilot CLI reads). The user's answer is still recorded; the agent sees the result with `flow status`. Copilot's cloud agent has no human in the loop mid-run, so a run that reaches a human gate or a suspend request stops there.
- **Unbound guards are off, not blocking.** While `.flow/<skill>/project.md` leaves a guarded command's binding empty, that command cannot be recognized. No run can start until the project binds every name, and the session is told the guards are off; other commands are not blocked in the meantime.
- **An invalid graph turns the graph's rails off** (guarded commands, write limits, strict mode) rather than blocking the agent; the injected context says so until the graph validates again. The rails' own protections stay on: the run state, the project bindings, the skill, the hook settings and the human-only commands.
- **A broken hook never stops all work, and never opens the rails.** When the hook cannot read a call (a runtime file missing or outdated, a payload of a shape it does not expect, an error while checking), it falls back to a plain text search: a call that names `.flow`, `flow.mjs`, the skill or a hook settings file is refused, and every other call goes through. The session is told the rails are degraded and how to repair them. A payload it does not understand is never a reason to block. What remains open is a hook that cannot start at all (`flow.mjs` missing or unparseable, `node` not on the PATH): Claude Code and Codex then let the call through, and Copilot refuses it. Only the user can cause this, since the agent cannot change the skill.
- **Hooks can be switched off in each agent's settings**, so those files are protected like the rails: an edit that adds `disableAllHooks` (Claude Code, Copilot's `.github/copilot/settings*.json`), `hooks = false` (Codex's `config.toml`), `"chat.useHooks": false` (VS Code's `.vscode/settings.json`) or `"enabled": false` (Antigravity's `.agents/hooks.json`), or that removes a `flow.mjs` hook, is refused. So is an edit that adds a command to them (a hook, or an MCP server in `config.toml`), a new file in `.github/hooks/`, which Copilot runs as a whole, and VS Code's `chat.hookFilesLocations`: a command the agent adds would run at the next lifecycle event, outside the tool hook. Other edits of these files go through. Settings outside the repository that the user controls (VS Code's user settings, a `--settings` flag) are out of reach, and so is code the agent writes for something else to run later (a script, a git hook, a hook in a plugin or in a subagent's or skill's frontmatter).
- **Only the human's own words answer.** While a question waits, every prompt the user sends is kept as a possible answer, so the agent may not send one where an agent would submit it as a prompt: as the prompt of an agent session it starts from the shell (`claude -p`, `codex exec`, `copilot -p`, through `npx`, `Start-Process` or `pwsh -c` too, whose hooks are this skill's), or in a prompt it schedules or sends (a cron or wakeup prompt, a message to another session). With no question waiting these run as usual. What remains: the agent interprets the reply, so it could misread one or record an answer to a message that was about something else; and a host that delivers other sessions' messages as the user's prompts, or a prompt scheduled before the question that fires after it, counts as a reply. What the user sent is logged with every decision, and the agent tells the user what it recorded.
- **Tools the hook does not know** (MCP tools) are read by their input. A tool whose name says it only reads (`read_file`, `list_directory`, `search`) passes. For any other, values under command keys (`command`, `cmd`, `args`) are checked as shell lines, guards included; values under code keys (`code`, `script`) may not mention `.flow`, `flow.mjs` or the rails; and every value is checked as a path, so writing or deleting the run state, the skill or a hook settings file is refused. A tool that hides its effect behind other names (a read-sounding name that writes, a path assembled from several fields) is not caught.
