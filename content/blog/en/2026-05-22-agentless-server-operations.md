---
title: "Agentless server operations: controlling production over SSH from Telegram"
date: "2026-05-22"
excerpt: "A practical model for running Hermes locally as the control plane, operating servers over SSH, and making production changes through diffs, validation, backups, and rollback paths instead of installing extra agents on every host."
tags: ["Hermes", "SSH", "DevOps", "production", "agents"]
---

# Agentless server operations: controlling production over SSH from Telegram

I have been building a practical way to use AI agents for production server operations. Not by installing a new agent, daemon, control panel, and tiny digital goblin on every server. More simply:

```text
Telegram → local Hermes → SSH → server
```

Hermes runs on my own machine in WSL. When I ask it to inspect a server or prepare a change, it connects over SSH the same way I would. The remote host does not need a separate Hermes installation.

That sounds like a small architecture choice. In practice, it changes a lot.

## Why not install a remote agent everywhere?

Installing a dedicated agent on every production machine quickly creates new questions:

- how is the agent updated?
- what permissions does it have?
- who watches its logs?
- what happens if it crashes?
- what happens if it does not crash, but becomes too enthusiastic?

The last one is often the dangerous one. Broken automation is easy to notice. Overconfident automation sometimes gets work done before anyone asks why.

So the model is agentless: production servers need SSH, normal Unix tools, and optionally `tmux` for long-running sessions.

## Read-only first

The first rule is simple: look before touching.

When a server has a problem, Hermes does not start by fixing. It starts by reading:

```bash
hostname
uptime
df -h
free -h
systemctl --failed
docker ps
docker service ls
journalctl --since '1 hour ago' -p warning
```

This creates a situation picture: which server is involved, what runs there, what looks unusual, and what is probably normal noise.

The same model powers the daily morning infrastructure check. Deterministic health checks run first. Only if something is `WARN` or `CRITICAL` do we run a deeper SSH diagnosis on the affected host.

## Editing files: diff before drama

When a server needs a change, live-editing production is the last option, not the first reflex.

A safe change flow looks like this:

1. read the current file
2. create a local copy
3. edit the copy
4. show the diff
5. validate the change
6. create a remote backup
7. write the change atomically
8. reload or restart only after approval
9. verify the result
10. keep the rollback path ready

For example, a Caddy config change could start like this:

```bash
ssh teppo-server 'sudo cat /etc/caddy/Caddyfile' > Caddyfile.original
cp Caddyfile.original Caddyfile.edited
# edit Caddyfile.edited locally
diff -u Caddyfile.original Caddyfile.edited
```

Then validate it:

```bash
caddy validate --config Caddyfile.edited
```

Only after that do we write to production:

```bash
scp Caddyfile.edited teppo-server:/tmp/Caddyfile.new
ssh teppo-server 'sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.20260522-120000'
ssh teppo-server 'sudo install -o root -g root -m 0644 /tmp/Caddyfile.new /etc/caddy/Caddyfile'
ssh teppo-server 'sudo systemctl reload caddy'
```

If something goes wrong, rollback is not a mood. It is a command:

```bash
ssh teppo-server 'sudo install -o root -g root -m 0644 /etc/caddy/Caddyfile.bak.20260522-120000 /etc/caddy/Caddyfile && sudo systemctl reload caddy'
```

## The AI agent is not a root-powered marching band

In this model, the AI agent is not a magical superuser that gets to do whatever it wants. Its role is to:

- collect facts
- propose a change
- prepare a diff
- list risks
- define validation
- write the rollback command
- ask for approval before production impact

This is a less flashy vision of AI agents than most demos. That is exactly why it is more useful. In production, boring is often a compliment.

## Bringing the dev team into the gates

I have also built separate Hermes dev profiles. With them, a production change can be split into clear roles:

- `dev-devops` performs read-only discovery and prepares the change plan
- `dev-reviewer` reviews the diff, risk, and rollback path
- the main agent applies the approved change only after permission

That turns agent work from “one bot did something” into a small team process:

```text
observe → plan → review → approve → apply → verify → rollback-ready
```

## Why Telegram?

Telegram is not the shell here. It is the control surface.

I can write:

```text
Check hostinger and run a read-only deep dive if anything looks odd.
```

Or:

```text
Prepare the Caddy change and show me the diff before touching production.
```

Hermes interprets the request, runs the necessary SSH commands from the local machine, and returns the summary to the conversation.

The important distinction is this: natural language does not remove the production process. It makes the process easier to start.

## Good automation slows down in the right place

The goal of this setup is not to make production changes recklessly fast. The goal is to make them repeatable.

Observation should be fast:

- what is broken?
- where is it broken?
- what changed?
- what is the next safe step?

Impact should be slower:

- are we writing a file?
- are we reloading a service?
- are we restarting a container?
- are we running a migration?

An agent should help a lot with the first category. In the second, it should know how to stop.

## Summary

The model is deliberately simple:

- no extra agent on production servers
- SSH is enough
- read-only first
- diff before change
- backup before write
- validation before reload
- rollback before bravery
- dev team review gates for larger changes

It is not the flashiest possible agent architecture. But it is one I can live with on a Monday morning.

That is often a better test than a Friday demo.
