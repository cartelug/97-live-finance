# Repo workflow

- This repo has no CI/deploy pipeline checked in. Whatever serves the live site
  reads from the `main` branch, so `main` is production.
- Always commit and push directly to `main`. Do not create feature branches or
  open pull requests unless the user explicitly asks for one.
