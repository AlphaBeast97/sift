# Security Policy

## Supported versions

Sift 1.x is supported. Security fixes are made on `main` and included in the
next release.

| Version | Supported |
| --- | --- |
| `main` / latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting:

<https://github.com/AlphaBeast97/sift/security/advisories/new>

If that is unavailable, email **ksaad5272@gmail.com** with the subject
`Sift security`.

Include:

- the affected version or commit;
- the distribution and GNOME Shell version;
- a description of the impact and the steps to reproduce;
- any proof-of-concept files or logs, with secrets removed.

You will get an acknowledgement within 7 days. Please give a reasonable window
to investigate and ship a fix before disclosing the issue publicly.

## Scope

Sift runs as the current user and talks to a Rust daemon over the session bus.
The security boundary is the user account, not a multi-user system. Reports are
especially useful for:

- the extension, daemon, or installer writing outside the intended user paths;
- file index traversal or symlink handling that exposes files outside the
  configured roots;
- command or D-Bus injection through search queries, settings, or config files;
- release artifacts that do not match `SHA256SUMS`.

The extension deliberately does not read file contents, does not contact the
network unless web search is enabled, and never asks for root.

## Safe harbor

Good-faith research that follows this policy will not be treated as abuse. Do
not access other users' data, disrupt a running session, or publish details
before a fix is available.
