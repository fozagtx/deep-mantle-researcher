# Submission Notes

## Project

Deep Mantle Researcher

## Problem

Onchain finance research often collapses into narrative: a protocol announces an RWA integration, a dashboard shows a number, a thread claims momentum, and the final article treats all of it as equally reliable. Builders and writers need a repeatable workflow that turns a messy question into a source-backed thesis without hiding uncertainty.

## Who Uses It

- Hackathon researchers
- Onchain finance writers
- RWA analysts
- DeFi protocol teams
- AI research-agent builders
- Tokenized asset founders
- Market-structure researchers
- Community contributors writing protocol analysis

## Novelty

Most research workflows tell agents to "search and summarize." This skill forces the agent to decompose the question, assign source categories, triangulate the highest-stakes claim, score confidence, and preserve caveats before drafting. It is tuned for onchain finance, where token wrappers, legal rights, liquidity, execution quality, and dashboard definitions can differ sharply.

## Kit Fit

The repo follows a skill addon pattern:

- `skill/SKILL.md` entry point
- focused progressive-disclosure modules
- optional `agents/`
- optional `commands/`
- optional `rules/`
- installer scripts
- README
- MIT license
- local structure validator

## Safety

- No binaries
- No network calls in install scripts
- No opaque runtime behavior
- Installers copy local Markdown files only
- Clear boundaries for legal, financial, compliance, investment, security, and trading work
- Validator checks for forbidden attribution strings before submission

## Demo Prompts

```text
Research whether Mantle's RWA push is mostly an issuance story or whether distribution and market structure are the real shift.
```

```text
Build a findings grid for xStocks on Mantle using Mantle releases, xStocks docs, market-data sources, and regulator framing.
```

```text
Turn this research into a Track 1 article outline and a Track 2 research-agent walkthrough.
```

## Expected Outputs

- Original messy question
- Research decomposition
- Source map
- Triangulated highest-stakes claim
- Findings grid
- Confidence levels
- Article thesis and outline
- Caveats and contradiction log
- Live workflow demo

## Live Example

The bundled example researches this question:

> Is Mantle's recent RWA/tokenized-equity push mainly an issuance story, or is the real shift distribution and market structure?

The expected thesis:

> Mantle's strongest story is not that it can host tokenized assets. Its stronger story is that it is assembling the distribution, execution, liquidity, and agent infrastructure that tokenized assets need to become usable markets.
