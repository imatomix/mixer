# Architecture decision records

Each record explains one decision that shapes mixer: what problem it answers, what we tried, what we chose, and what it costs. Records are written from what we built and measured in this repository.

- Add a record when a decision changes how components, modules, or the public API fit together, or when it would be expensive to reverse.
- Do not rewrite an accepted record. When a later decision replaces it, mark it **Superseded by** the new record and link both ways.
- File names are `NNNN-short-title.md`, numbered in order.

| Record | Status |
| --- | --- |
| [0001. Compose components with next()](0001-compose-components-with-next.md) | Accepted |
| [0002. Give routes the signed-in user with a guard and requireUser()](0002-signed-in-user-in-routes.md) | Accepted |
| [0003. Validate client input with validateInput()](0003-validate-input.md) | Accepted |

## Template

```md
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context
What problem, and what we observed in this repository.

## Options
What we considered.

## What we tried
Experiments, measurements, and what they showed.

## Decision
What we chose, stated as rules.

## Consequences
What gets better, what we give up, and what we must now keep true.
```
