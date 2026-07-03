# Deep Mantle Researcher

An AI agent skill for Mantle and onchain finance researchers who need to turn a messy RWA, DeFi, tokenized asset, or market-structure question into a source-backed article, memo, X thread, or hackathon research submission.

This skill is designed for research work where being early is not enough. It forces decomposition, source-category assignment, triangulation, confidence scoring, counterargument handling, and article-ready synthesis.

## What It Helps With

| Area | Outcome |
|---|---|
| Research decomposition | Turn a messy onchain question into 5-8 answerable sub-questions |
| Source mapping | Assign primary docs, market data, regulator sources, reporting, and user/community signal |
| Evidence integrity | Separate reported facts, inferred claims, interested-party claims, and unresolved gaps |
| RWA market analysis | Compare tokenized equities, RWAs, stablecoins, DeFi liquidity, execution, and distribution |
| Mantle-specific research | Analyze Mantle, xStocks, Bybit, Fluxion, Merchant Moe, InsightX, ERC-8004, and x402 |
| Article synthesis | Convert findings into a thesis, outline, caveats, and "what would change my mind" section |
| Hackathon workflow | Produce a live research-agent demo showing the research method working on a real prompt |

## What Makes This Different

- It is evidence-first. It does not let a market narrative become a claim until the source category and confidence level are explicit.
- It is designed for onchain finance, where protocol announcements, dashboards, token mechanics, legal status, and liquidity data often disagree.
- It is progressive and token-efficient. `skill/SKILL.md` routes to focused files only when needed.
- It is safe to install. The scripts only copy local Markdown files into a selected skills directory.
- It is submission-ready. The repo includes agents, commands, rules, validation, and a demo prompt for the Mantle Research Challenge.

## Installation

### Recommended

```bash
git clone https://github.com/fozagtx/deep-mantle-researcher.git
cd deep-mantle-researcher
./install-custom.sh
```

The custom installer lets you choose personal or project skill locations, including `.agents/skills`, `.claude/skills`, and a local project `skills/` folder.

### Standard

```bash
./install.sh
./install.sh -y
```

Standard defaults:

- Skill location: `~/.agents/skills/deep-mantle-researcher`
- Optional config copied to: `~/.agents/AGENTS.md`

## Usage Examples

```text
Research whether Mantle's tokenized-equity push is mostly issuance, or whether distribution and execution are the real shift.
```

```text
Turn this RWA announcement into a defensible article thesis with sources, caveats, and a findings grid.
```

```text
Compare xStocks, Ondo, Robinhood stock tokens, and Dinari. Where is the real market-structure difference?
```

```text
Build me a research-agent demo for a hackathon submission using ERC-8004, x402, and Mantle's RWA stack as the live example.
```

## Repository Structure

```text
deep-mantle-researcher/
|-- .gitignore
|-- ARTICLE.md
|-- README.md
|-- LICENSE
|-- CLAUDE.md
|-- SUBMISSION.md
|-- install.sh
|-- install-custom.sh
|-- skill/
|   |-- SKILL.md
|   |-- research-workflow.md
|   |-- source-map.md
|   |-- evidence-grid.md
|   |-- article-synthesis.md
|   |-- hackathon-submission.md
|   `-- resources.md
|-- agents/
|   |-- research-analyst.md
|   |-- source-verifier.md
|   |-- article-synthesizer.md
|   `-- skill-demo-coach.md
|-- commands/
|   |-- research-sprint.md
|   |-- verify-claim.md
|   |-- article-brief.md
|   `-- skill-demo.md
|-- rules/
|   `-- evidence-integrity.md
`-- tests/
    `-- validate_structure.sh
```

## Skill Routing

`skill/SKILL.md` is the entry point. It classifies the task and routes to the smallest relevant module:

- `research-workflow.md` for intake, decomposition, triangulation, and synthesis
- `source-map.md` for source categories, source-quality checks, and search planning
- `evidence-grid.md` for confidence scoring and contradiction handling
- `article-synthesis.md` for article outlines, thesis writing, and X-ready framing
- `hackathon-submission.md` for Track 1/Track 2 packaging and demo scripts
- `resources.md` for source-of-truth links and the Mantle live example

## Quality Bar

The skill should make an agent:

- Preserve the messy original question before cleaning it up
- Use at least three source categories for non-trivial research
- Triangulate the highest-stakes claim before recommending a thesis
- Label interested-party claims instead of laundering them as neutral facts
- Include caveats, contradictions, and "what would change my mind"
- Produce outputs that can become an article, memo, thread, or research-agent demo

## Validation

Run the structure validator:

```bash
./tests/validate_structure.sh
```

It checks required files, frontmatter, relative skill links, shell syntax, and attribution hygiene.

## License

MIT. See [LICENSE](LICENSE).
